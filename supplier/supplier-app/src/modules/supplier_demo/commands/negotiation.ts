import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SupplyCase, SupplyMessage } from '../data/entities'
import { emitSupplierDemoEvent } from '../events'
import { counterPayloadSchema } from '../lib/envelope'
import { evaluateCounter } from '../lib/counter-evaluation'
import { buildNegotiationRecommendation, createNegotiationRecord, parseNegotiationRecord } from '../lib/negotiation-record'
import { parseSupplierAgentConfig } from '../lib/agent/config'
import { SupplierProductionSlot } from '../data/entities'
import { isAutoNegotiationEnabled, isFreeformAutoNegotiationEnabled, isFreeformAutoShadowEnabled } from '../lib/toggles'
import { readWmsSnapshot, type WmsStockSnapshot } from '../lib/wms-snapshot'
import { parseInterpretationRecord } from '../lib/interpretation/record'
import { deterministicCrossCheck } from '../lib/interpretation/cross-check'
import { sanitizeReplyText } from '../lib/interpretation/sanitize'

type Scope = { tenantId: string; organizationId: string }

function scopeFrom(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  return { tenantId, organizationId }
}

function commandContext(ctx: CommandRuntimeContext, scope: Scope): CommandRuntimeContext {
  return { ...ctx, auth: { tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'], selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], tenantId: scope.tenantId }, systemActor: true }
}

function ruleStatusReason(failed: string | null): string {
  return failed === 'C6' ? 'counter_equals_proposal' : failed === 'T1' ? 'negotiation_turn_limit_reached' : `counter_invalid_${failed}`
}

const evaluateCounterCommand: CommandHandler<Record<string, unknown>, { status: string; reason: string; evaluationId?: string }> = {
  id: 'supplier_demo.supply_case.evaluate_counter',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const caseId = typeof rawInput.caseId === 'string' ? rawInput.caseId : null
    const supplyMessageId = typeof rawInput.supplyMessageId === 'string' ? rawInput.supplyMessageId : null
    if (!caseId || !supplyMessageId) throw new CrudHttpError(422, { error: 'Case and counter are required' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const autoNegotiationEnabled = await isAutoNegotiationEnabled(ctx.container, scope.tenantId)
    const freeformAutoNegotiationEnabled = await isFreeformAutoNegotiationEnabled(ctx.container, scope.tenantId)
    const freeformAutoShadowEnabled = await isFreeformAutoShadowEnabled(ctx.container, scope.tenantId)
    const outcome = await em.transactional(async (tx) => {
      const supplyCase = await findOneWithDecryption(tx, SupplyCase, { ...scope, id: caseId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      const counter = await findOneWithDecryption(tx, SupplyMessage, { ...scope, id: supplyMessageId, supplyCaseId: caseId, direction: 'inbound', messageType: 'SUPPLY_COUNTER_PROPOSAL', validationStatus: { $in: ['valid', 'interpreted'] }, deletedAt: null }, undefined, scope)
      if (!supplyCase || !counter) throw new CrudHttpError(404, { error: 'Counter not found' })
      const existing = counter.negotiationRecord ? parseNegotiationRecord(counter.negotiationRecord) : createNegotiationRecord()
      const interpreted = counter.validationStatus === 'interpreted'
      existing.origin = interpreted ? 'interpretation' : 'envelope'
      // A late or redelivered event for a counter the case no longer waits on must not pull the case back.
      if (!existing.evaluation && (supplyCase.status !== 'counter_received' || existing.verdict)) {
        return { changed: false, dispatchAgent: false, status: supplyCase.status, reason: supplyCase.statusReason ?? 'counter_not_in_flight', evaluationId: undefined }
      }
      if (existing.evaluation) {
        return {
          changed: false,
          // Replay: re-emit a lost dispatch only while the case is still waiting for this counter's analysis.
          dispatchAgent: autoNegotiationEnabled && supplyCase.status === 'counter_received' && !existing.recommendation
            && !existing.verdict && existing.agent.state === 'not_started',
          status: supplyCase.status,
          reason: supplyCase.statusReason ?? 'counter_evaluated_manual',
          evaluationId: existing.evaluation.id,
        }
      }
      const parsed = counterPayloadSchema.safeParse(counter.envelopePayload?.payload)
      if (!parsed.success) throw new CrudHttpError(422, { error: 'Counter payload is not valid v2', code: 'counter_invalid_schema' })
      // One source for the turn limit: the bounded agent configuration, never a raw env read that skips its bounds.
      const config = parseSupplierAgentConfig()
      const maxTurns = config.ok ? config.config.maxNegotiationTurns : 3
      const slots = await tx.find(SupplierProductionSlot, { ...scope, catalogVariantId: supplyCase.catalogVariantId, deletedAt: null }, { orderBy: { startsAt: 'asc' } })
      // The stock reserved in the warehouse for the original date (the baseline's first tranche).
      const warehouseReserved = supplyCase.baselineCommitment.find((entry) => entry.date === supplyCase.originalCommitment[0]?.date)?.quantity ?? 0
      let stock: WmsStockSnapshot | null = null
      if (interpreted) {
        try {
          stock = await readWmsSnapshot(tx, { ...scope, catalogVariantId: supplyCase.catalogVariantId, salesOrderId: supplyCase.salesOrderId })
        } catch {
          stock = null
        }
      }
      const evaluation = evaluateCounter({ requested: parsed.data.requestedCommitments, current: supplyCase.currentCommitment, originalDate: supplyCase.originalCommitment[0]?.date ?? null, warehouseReserved, slots, caseOrderNumber: supplyCase.orderNumber, negotiationTurn: supplyCase.negotiationTurn, maxTurns, cumulativeCost: Number(supplyCase.additionalCost ?? 0) })
      let autoGates: Record<string, 'pass' | 'fail' | 'n/a'> | undefined
      if (interpreted) {
        const sourceId = typeof counter.envelopePayload.sourceSupplyMessageId === 'string' ? counter.envelopePayload.sourceSupplyMessageId : null
        const source = sourceId ? await findOneWithDecryption(tx, SupplyMessage, { ...scope, id: sourceId, supplyCaseId: caseId, direction: 'inbound', deletedAt: null }, undefined, scope) : null
        const interpretation = source?.interpretationRecord ? parseInterpretationRecord(source.interpretationRecord) : null
        const latestInbound = await findWithDecryption(tx, SupplyMessage, { ...scope, supplyCaseId: caseId, direction: 'inbound', deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope)
        const interpretedCount = latestInbound.filter((message) => message.validationStatus === 'interpreted').length
        const intent = interpretation?.intent
        const explicitDates = intent?.tranches.filter((tranche) => !tranche.quantityIsRemainder).every((tranche) => ['iso', 'weekday', 'original_date'].includes(tranche.date.type)) ?? false
        const conditionsSafe = intent?.conditions.every((condition) => condition === 'when_restocked') ?? false
        const sanitizedSource = source ? sanitizeReplyText(source.bodyExcerpt ?? '', { ownOrderNumber: supplyCase.orderNumber }) : null
        const crossCheck = source && intent && sanitizedSource?.ok
          ? deterministicCrossCheck({ text: sanitizedSource.text, intent, currentCommitment: supplyCase.currentCommitment, originalCommitment: supplyCase.originalCommitment, today: new Date().toISOString().slice(0, 10) })
          : null
        const requested = evaluation.options.find((option) => option.id === 'requested')
        const stockOk = Boolean(stock && stock.reservedForOrder >= warehouseReserved)
        autoGates = {
          I1: freeformAutoNegotiationEnabled && autoNegotiationEnabled && !freeformAutoShadowEnabled ? 'pass' : 'fail',
          I2: interpretation?.sanitizer.prescan.hit === false && intent?.instructionsDetected === false && ['pl', 'en'].includes(intent?.language ?? '') && interpretation?.checks.schema === 'pass' && interpretation?.checks.consistency === 'pass' && interpretation?.checks.grounding === 'pass' && interpretation.checks.confidenceOk ? 'pass' : 'fail',
          I3: Boolean(intent && ['counter_split', 'partial_with_remainder'].includes(intent.kind) && conditionsSafe) ? 'pass' : 'fail',
          I4: Boolean(intent && intent.tranches.every((tranche) => !tranche.quantityIsRemainder && ['iso', 'weekday', 'original_date'].includes(tranche.date.type))) && explicitDates ? 'pass' : 'fail',
          I5: (intent?.confidence ?? 0) >= 0.9 ? 'pass' : 'fail',
          I6: crossCheck?.ok === true ? 'pass' : 'fail',
          I7: Boolean(requested?.feasible && requested.policyDecision === 'auto_approved') ? 'pass' : 'fail',
          I8: interpretedCount <= 1 && latestInbound[0]?.id === counter.id ? 'pass' : 'fail',
          I9: stockOk ? 'pass' : 'fail',
        }
      }
      existing.counterRule = evaluation.rule
      existing.evaluation = evaluation.rule.ok
        ? {
          id: evaluation.evaluationId,
          evaluatedAt: new Date().toISOString(),
          turnAtEvaluation: supplyCase.negotiationTurn,
          maxTurns,
          reasonCodes: [
            ...evaluation.reasonCodes,
            ...(interpreted && stock && stock.reservedForOrder < warehouseReserved ? ['stock_below_assumption'] : []),
            ...(interpreted && !stock ? ['stock_snapshot_unavailable'] : []),
          ],
          options: interpreted
            ? evaluation.options.map((option) => ({ ...option, stockStatus: stock ? stock.reservedForOrder < warehouseReserved ? 'diverged' as const : 'ok' as const : 'unavailable' as const }))
            : evaluation.options,
          context: {
            originalCommitment: supplyCase.originalCommitment,
            currentCommitment: supplyCase.currentCommitment,
            requestedCommitments: parsed.data.requestedCommitments,
            originalDate: supplyCase.originalCommitment[0]?.date ?? null,
            stockOnOriginalDate: warehouseReserved,
            shortfallQuantity: Math.max(0, (supplyCase.originalCommitment[0]?.quantity ?? 0) - warehouseReserved),
          },
          ...(interpreted ? { stock: stock ?? undefined, stockGate: { w1: stock ? stock.reservedForOrder < warehouseReserved ? 'diverged' as const : 'ok' as const : 'unavailable' as const, snapshotReserved: stock?.reservedForOrder ?? 0 }, autoGates, shadowMode: freeformAutoShadowEnabled } : {}),
        }
        : null
      if (evaluation.rule.ok && !autoNegotiationEnabled) {
        // Deterministic fallback: the buyer's own split, only when it is feasible (never an alternative we chose).
        const requested = evaluation.options.find((candidate) => candidate.id === 'requested' && candidate.feasible)
        if (requested) {
          existing.recommendation = buildNegotiationRecommendation({
            record: existing,
            source: 'deterministic',
            optionId: requested.id,
            decision: 'accept_requested',
            reasonCodes: [
              ...(interpreted ? ['interpretation_requires_human'] : []),
              ...(interpreted && !stock ? ['stock_unavailable'] : []),
              ...(interpreted && stock && stock.reservedForOrder < warehouseReserved ? ['stock_below_assumption'] : []),
              ...evaluation.reasonCodes,
            ],
            origin: interpreted ? 'interpretation' : 'envelope',
          })
        }
        existing.agent.state = 'skipped'
        existing.agent.skipReason = interpreted ? 'interpretation_requires_human' : 'auto_negotiation_disabled'
      }
      counter.negotiationRecord = existing
      const dispatchAgent = autoNegotiationEnabled && evaluation.rule.ok
      if (dispatchAgent) {
        // The case stays in flight while the agent analyses the counter; it is not a human task yet.
        supplyCase.statusReason = 'counter_evaluated'
      } else {
        supplyCase.status = 'needs_human'
        supplyCase.statusReason = evaluation.rule.ok
          ? interpreted ? 'recommendation_requires_human' : 'auto_negotiation_disabled'
          : ruleStatusReason(evaluation.rule.failed)
      }
      supplyCase.updatedAt = new Date()
      await tx.flush()
      return {
        changed: !dispatchAgent,
        dispatchAgent,
        status: supplyCase.status,
        reason: supplyCase.statusReason,
        evaluationId: evaluation.rule.ok ? evaluation.evaluationId : undefined,
      }
    })
    if (outcome.changed) await emitSupplierDemoEvent('supplier_demo.supply_case.attention_required', { ...scope, caseId, reason: outcome.reason, status: outcome.status }, { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) })
    if (outcome.dispatchAgent) await emitSupplierDemoEvent('supplier_demo.supply_case.counter_evaluated', { ...scope, caseId, supplyMessageId, evaluationId: outcome.evaluationId }, { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) })
    return { status: outcome.status, reason: outcome.reason, ...(outcome.evaluationId ? { evaluationId: outcome.evaluationId } : {}) }
  },
}

registerCommand(evaluateCounterCommand)

export function buildSupplierNegotiationCommandContext(ctx: CommandRuntimeContext, scope: Scope): CommandRuntimeContext {
  return commandContext(ctx, scope)
}
