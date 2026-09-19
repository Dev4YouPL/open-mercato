import { randomUUID } from 'node:crypto'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type {
  InboundMessage,
  InboundMessageTriageInput,
  ProductionPlan,
  SupplyCase,
  TriageDisposition,
} from '../../data/types'
import type { InboundSignal } from '../../data/inbound-signal'
import { AppendOnlyViolationError, DuplicateRecordKeyError, RecordNotFoundError } from '../../data/errors'
import { assembleTriageContext } from '../inbound/triageContext'
import { decideTriage, type TriageDecision } from './applyTriage'
import { runInboundTriage, type InboundTriageInvoker } from './runInboundTriage'
import { resolveTriageConfig } from './triageConfig'
import { emitSupplyCasesEvent } from '../../events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('supply_cases').child({ component: 'inbound-triage-activity' })

/**
 * Turns one agent answer into persisted facts — the whole of
 * `supply_cases.inbound.apply_triage`, minus the command envelope.
 *
 * The bar lives INSIDE this step rather than at its caller. A caller that could
 * hand in a finished decision could hand in one that never cleared the bar, so
 * what it hands in is the agent's raw answer; the candidate list, the schema
 * bound and the auto-apply rules are all rebuilt here from scoped records.
 *
 * What it writes is deliberately small. An auto-applied message is LINKED to
 * its case; the case's own business fields (proposals, plans, commitments)
 * belong to the later phases and are not touched here, because triage knows
 * which case a message is about, not what the case should now do about it.
 */

export type ApplyTriageOutcome =
  | {
      status: 'applied'
      decision: TriageDecision
      message: InboundMessage
      /** The case the message was linked to, created or existing. Null unless auto-applied. */
      supplyCase: SupplyCase | null
      /** True only when this invocation appended the case record. */
      caseCreated: boolean
    }
  | {
      /** The message already carried a disposition; nothing was re-decided or rewritten. */
      status: 'already_settled'
      disposition: TriageDisposition | null
      message: InboundMessage
      supplyCase: SupplyCase | null
    }

export type ApplyTriageDeps = {
  store: SupplyCasesStore
  scope: StoreScope
  invoke: InboundTriageInvoker
  confidenceThreshold?: number
}

export async function applyTriageOutcome(
  deps: ApplyTriageDeps,
  inboundMessageId: string,
): Promise<ApplyTriageOutcome> {
  const { store, scope } = deps
  const message = await store.inboundMessages.findById(scope, inboundMessageId)
  if (!message) throw new RecordNotFoundError('InboundMessage', inboundMessageId)

  // At-least-once delivery means this step runs again on messages it already
  // settled. A message with a persisted outcome but no final case link is a
  // durable claim left by a previous attempt; resume it from the stored signal
  // rather than invoking the agent again.
  if (isSettled(message)) {
    return {
      status: 'already_settled',
      disposition: message.triageDisposition,
      message,
      supplyCase: message.caseId ? await store.supplyCases.findById(scope, message.caseId) : null,
    }
  }
  if (isPendingClaim(message)) return resumeClaim(deps, message)

  const context = await assembleTriageContext(store, scope, message)
  const operationId = randomUUID()
  if (!context.ok) {
    await emitAnalysisFailed(scope, operationId, 'inbound_triage', message.id, 'EMPTY_BODY', false, new Date().toISOString())
    return settle(deps, message, {
      outcome: 'QUARANTINE',
      disposition: 'QUARANTINED',
      reason: 'EMPTY_BODY',
      needsAttention: false,
    })
  }

  const startedAt = new Date().toISOString()
  await emitAnalysisStarted(scope, operationId, 'inbound_triage', message.id, startedAt)

  const result = await runInboundTriage({
    sanitizedBody: context.input.sanitizedBody,
    senderEmail: context.input.senderEmail,
    candidates: context.input.candidates,
    invoke: deps.invoke,
  })

  const decision = decideTriage({
    result,
    candidates: context.input.candidates,
    confidenceThreshold: deps.confidenceThreshold ?? resolveTriageConfig().confidenceThreshold,
  })

  if (!result.ok) {
    await emitAnalysisFailed(scope, operationId, 'inbound_triage', message.id, result.reason, result.reason === 'AGENT_UNAVAILABLE', new Date().toISOString())
    return settle(deps, message, decision)
  }

  if (decision.outcome !== 'AUTO_APPLY') {
    if (decision.outcome === 'NEEDS_ATTENTION') {
      const attentionPlan = await findAttentionPlan(deps, decision, context.input.candidates)
      if (attentionPlan) {
        await claim(deps, message, decision, { productionPlanId: attentionPlan.id })
        const created = await createCaseFromPlan(deps, message, attentionPlan, decision.signal, true)
        const settled = await settle(deps, message, decision, created.supplyCase, created.created)
        await emitAnalysisCompleted(scope, operationId, 'inbound_triage', message.id, decision, created.supplyCase.id, new Date().toISOString())
        return settled
      }
    }
    await emitAnalysisCompleted(scope, operationId, 'inbound_triage', message.id, decision, undefined, new Date().toISOString())
    return settle(deps, message, decision)
  }

  if (decision.target.kind === 'EXISTING_CASE') {
    const supplyCase = await store.supplyCases.requireById(scope, decision.target.caseId)
    await claim(deps, message, decision, { caseId: supplyCase.id })
    const settled = await settle(deps, message, decision, supplyCase, false)
    await emitAnalysisCompleted(scope, operationId, 'inbound_triage', message.id, decision, supplyCase.id, new Date().toISOString())
    return settled
  }

  // A new case needs LOCAL demand, which a supplier e-mail does not carry. The
  // production plan for the extracted SKU supplies it; without one there is
  // nothing this message is an exception TO, so a human decides rather than the
  // module inventing a quantity and a date to keep the flow moving.
  const plan = await findPlanForSku(deps, decision.signal.sku)
  if (!plan) {
    const settled = await settle(deps, message, {
      outcome: 'NEEDS_ATTENTION',
      disposition: null,
      reason: 'NO_LOCAL_DEMAND',
      signal: decision.signal,
      candidateIndexes: context.input.candidates.map((candidate) => candidate.index),
    })
    await emitAnalysisCompleted(scope, operationId, 'inbound_triage', message.id, decision, undefined, new Date().toISOString())
    return settled
  }

  await claim(deps, message, decision, { productionPlanId: plan.id })
  const created = await createCaseFromPlan(deps, message, plan, decision.signal)
  const settled = await settle(deps, message, decision, created.supplyCase, created.created)
  await emitAnalysisCompleted(scope, operationId, 'inbound_triage', message.id, decision, created.supplyCase.id, new Date().toISOString())
  return settled
}

async function emitAnalysisStarted(scope: StoreScope, operationId: string, kind: string, inboundMessageId: string, occurredAt: string): Promise<void> {
  await emitActivityEvent('supply_cases.analysis.started', {
    operationId,
    kind,
    inboundMessageId,
    occurredAt,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, scope)
}

async function emitAnalysisCompleted(scope: StoreScope, operationId: string, kind: string, inboundMessageId: string, decision: TriageDecision, caseId: string | undefined, occurredAt: string): Promise<void> {
  await emitActivityEvent('supply_cases.analysis.completed', {
    operationId,
    kind,
    inboundMessageId,
    caseId,
    classification: decision.outcome === 'QUARANTINE' ? decision.reason === 'UNRELATED' ? 'NON_SUPPLIER' : 'UNKNOWN' : decision.signal.intent === 'SUPPLY_PROPOSAL' || decision.signal.intent === 'ALTERNATIVE_SUPPLY_OFFER' || decision.signal.intent === 'SUPPLY_ACCEPTANCE' || decision.signal.intent === 'SUPPLY_COMMITMENT_CONFIRMED' ? 'SUPPLIER' : 'NON_SUPPLIER',
    triageOutcome: decision.outcome === 'QUARANTINE' ? 'QUARANTINED' : decision.outcome,
    occurredAt,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, scope)
}

async function emitAnalysisFailed(scope: StoreScope, operationId: string, kind: string, inboundMessageId: string, reasonCode: string, retryable: boolean, occurredAt: string): Promise<void> {
  await emitActivityEvent('supply_cases.analysis.failed', {
    operationId,
    kind,
    inboundMessageId,
    reasonCode,
    retryable,
    occurredAt,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, scope)
}

async function emitActivityEvent(event: Parameters<typeof emitSupplyCasesEvent>[0], payload: Record<string, unknown>, scope: StoreScope): Promise<void> {
  try {
    await emitSupplyCasesEvent(event, payload, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
  } catch (error) {
    logger.error('Durable activity event enqueue failed', { event, tenantId: scope.tenantId, organizationId: scope.organizationId })
    getTelemetryRuntime()?.reportError(new Error('[internal] durable activity event enqueue failed'), {
      module: 'supply_cases',
      code: 'activity.event_enqueue_failed',
      attributes: { event, tenantId: scope.tenantId, organizationId: scope.organizationId },
    })
    throw error
  }
}

async function findPlanForSku(deps: ApplyTriageDeps, sku: string | null): Promise<ProductionPlan | null> {
  if (!sku) return null
  const plans = await deps.store.productionPlans.list(deps.scope)
  return plans.find((plan) => plan.materialSku === sku) ?? null
}

async function findUniquePlanForSku(deps: ApplyTriageDeps, sku: string): Promise<ProductionPlan | null> {
  const plans = await deps.store.productionPlans.list(deps.scope)
  const matches = plans.filter((plan) => plan.materialSku === sku)
  return matches.length === 1 ? matches[0] : null
}

async function findAttentionPlan(
  deps: ApplyTriageDeps,
  decision: Extract<TriageDecision, { outcome: 'NEEDS_ATTENTION' }>,
  candidates: readonly { threadMatch: boolean }[],
): Promise<ProductionPlan | null> {
  if (decision.reason !== 'UNRESOLVED_FIELDS') return null
  if (decision.signal.intent !== 'SUPPLY_PROPOSAL') return null
  if (decision.signal.correlation.kind !== 'NEW_CASE') return null
  if (decision.signal.confidence < (deps.confidenceThreshold ?? resolveTriageConfig().confidenceThreshold)) return null
  if (!decision.signal.sku || candidates.some((candidate) => candidate.threadMatch)) return null
  return findUniquePlanForSku(deps, decision.signal.sku)
}

/**
 * The correlation id is what a person says out loud about this case, so it is a
 * short sequence rather than a UUID. The store enforces uniqueness inside the
 * scope, so a concurrent claim loses the insert and retries with the next
 * number instead of two cases sharing a name.
 */
async function createCaseFromPlan(
  deps: ApplyTriageDeps,
  message: InboundMessage,
  plan: ProductionPlan,
  signal: InboundSignal,
  needsAttention = false,
): Promise<{ supplyCase: SupplyCase; created: boolean }> {
  const existing = await deps.store.supplyCases.list(deps.scope, { includeDeleted: true })
  let sequence = existing.length + 1
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const result = await deps.store.supplyCases.createIfAbsentByInboundMessage(deps.scope, message.id, {
        correlationId: formatCorrelationId(sequence),
        status: needsAttention ? 'NEEDS_ATTENTION' : 'RECEIVED',
        needsAttentionReason: needsAttention ? 'MISSING_DATA' : null,
        sku: plan.materialSku,
        requiredQuantity: plan.requiredQuantity,
        requiredDate: plan.requiredDate,
        supplier1Email: message.senderEmail,
        productionPlanId: plan.id,
        productionOrderIds: plan.productionOrderIds,
        supplier1Proposal: {
          sourceInboundMessageId: message.id,
          sku: signal.sku,
          deliveries: signal.commitments.map((commitment) => ({
            quantity: commitment.quantity,
            deliveryDate: commitment.date,
          })),
        },
        customerCommitmentSnapshot: await resolveCustomerSnapshot(deps, plan),
      })
      return result
    } catch (error) {
      if (!(error instanceof DuplicateRecordKeyError)) throw error
      sequence += 1
    }
  }
  throw new Error('[internal] could not allocate a free supply case correlation id')
}

async function resolveCustomerSnapshot(
  deps: ApplyTriageDeps,
  plan: ProductionPlan,
): Promise<{ customerName: string; commitmentDate: string } | null> {
  const orders = (await Promise.all(
    plan.productionOrderIds.map((id) => deps.store.productionOrders.findById(deps.scope, id)),
  )).filter((order): order is NonNullable<typeof order> => order !== null)
  const order = orders[0]
  return order ? { customerName: order.customerName, commitmentDate: order.customerCommitmentDate } : null
}

function formatCorrelationId(sequence: number): string {
  return `SC-${String(sequence).padStart(3, '0')}`
}

function isPendingClaim(message: InboundMessage): boolean {
  if (message.triageDisposition !== null || message.triageOutcome === null) return false
  if (message.triageOutcome === 'AUTO_APPLIED') {
    return message.extraction !== null && (
      message.failureReason?.startsWith('AUTO_APPLIED:CLAIMED:') === true
      || (message.caseId === null && message.failureReason === null)
    )
  }
  return message.failureReason?.includes(':CLAIMED') ?? false
}

function isSettled(message: InboundMessage): boolean {
  return !isPendingClaim(message) && (message.triageDisposition !== null || message.triageOutcome !== null)
}

async function claim(
  deps: ApplyTriageDeps,
  message: InboundMessage,
  decision: TriageDecision,
  target: { caseId?: string; productionPlanId?: string },
): Promise<void> {
  await deps.store.inboundMessages.recordTriage(
    deps.scope,
    message.id,
    buildTriagePatch(decision, null, true, target),
  )
}

async function resumeClaim(deps: ApplyTriageDeps, message: InboundMessage): Promise<ApplyTriageOutcome> {
  const signal = message.extraction
  if (!signal) throw new Error('[internal] triage claim is missing its persisted signal')

  if (message.triageOutcome === 'AUTO_APPLIED') {
    if (signal.correlation.kind === 'EXISTING_CASE') {
      const claimTarget = parseClaimTarget(message.failureReason)
      const candidateIndex = message.candidateIndexes[0] ?? 0
      const caseId = claimTarget?.kind === 'EXISTING_CASE' ? claimTarget.caseId : null
      if (!caseId) {
        const context = await assembleTriageContext(deps.store, deps.scope, message)
        const candidate = context.ok ? context.input.candidates[candidateIndex] : undefined
        if (!candidate) throw new Error('[internal] triage claim no longer resolves to an existing case')
        const supplyCase = await deps.store.supplyCases.requireById(deps.scope, candidate.caseId)
        const decision: TriageDecision = {
          outcome: 'AUTO_APPLY',
          disposition: 'AUTO_APPLIED',
          target: {
            kind: 'EXISTING_CASE',
            candidateIndex,
            caseId: supplyCase.id,
            correlationId: supplyCase.correlationId,
          },
          signal,
        }
        return settle(deps, message, decision, supplyCase, false)
      }
      const supplyCase = await deps.store.supplyCases.requireById(deps.scope, caseId)
      const decision: TriageDecision = {
        outcome: 'AUTO_APPLY',
        disposition: 'AUTO_APPLIED',
        target: {
          kind: 'EXISTING_CASE',
          candidateIndex,
          caseId: supplyCase.id,
          correlationId: supplyCase.correlationId,
        },
        signal,
      }
      return settle(deps, message, decision, supplyCase, false)
    }

    const claimTarget = parseClaimTarget(message.failureReason)
    const plan = claimTarget?.kind === 'NEW_CASE'
      ? await deps.store.productionPlans.findById(deps.scope, claimTarget.productionPlanId)
      : await findPlanForSku(deps, signal.sku)
    if (!plan) throw new Error('[internal] claimed NEW_CASE no longer has a local production plan')
    const decision: TriageDecision = {
      outcome: 'AUTO_APPLY',
      disposition: 'AUTO_APPLIED',
      target: { kind: 'NEW_CASE' },
      signal,
    }
    const created = await createCaseFromPlan(deps, message, plan, signal)
    return settle(deps, message, decision, created.supplyCase, created.created)
  }

  const reason = message.failureReason?.split(':')[1]
  if (reason !== 'UNRESOLVED_FIELDS') throw new Error('[internal] unsupported triage claim')
  const decision: TriageDecision = {
    outcome: 'NEEDS_ATTENTION',
    disposition: null,
    reason,
    signal,
    candidateIndexes: [...message.candidateIndexes],
  }
  const claimTarget = parseClaimTarget(message.failureReason)
  const plan = claimTarget?.kind === 'NEW_CASE'
    ? await deps.store.productionPlans.findById(deps.scope, claimTarget.productionPlanId)
    : await findUniquePlanForSku(deps, signal.sku ?? '')
  if (!plan) throw new Error('[internal] claimed NEEDS_ATTENTION no longer has a unique local production plan')
  const created = await createCaseFromPlan(deps, message, plan, signal, true)
  return settle(deps, message, decision, created.supplyCase, created.created)
}

async function settle(
  deps: ApplyTriageDeps,
  message: InboundMessage,
  decision: TriageDecision,
  supplyCase: SupplyCase | null = null,
  caseCreated = false,
): Promise<ApplyTriageOutcome> {
  try {
    const recorded = await deps.store.inboundMessages.recordTriage(
      deps.scope,
      message.id,
      buildTriagePatch(decision, supplyCase),
    )
    return { status: 'applied', decision, message: recorded, supplyCase, caseCreated }
  } catch (error) {
    // A concurrent redelivery may have settled the same message after this
    // invocation created or found its idempotent case. Re-read the winner and
    // report it instead of leaking an orphan case or surfacing a false failure.
    if (!(error instanceof AppendOnlyViolationError)) throw error
    const settled = await deps.store.inboundMessages.findById(deps.scope, message.id)
    if (!settled || (settled.triageDisposition === null && settled.triageOutcome === null)) throw error
    const settledCase = settled.caseId
      ? await deps.store.supplyCases.findById(deps.scope, settled.caseId)
      : null
    return {
      status: 'already_settled',
      disposition: settled.triageDisposition,
      message: settled,
      supplyCase: settledCase,
    }
  }
}

/**
 * Auto-applied messages are linked and settled. The bounded unresolved NEW_CASE
 * branch also links the message to its visible case shell, but keeps the
 * disposition null because no human has confirmed the incomplete extraction.
 */
function buildTriagePatch(
  decision: TriageDecision,
  supplyCase: SupplyCase | null,
  claimed = false,
  target: { caseId?: string; productionPlanId?: string } = {},
): InboundMessageTriageInput {
  if (decision.outcome === 'AUTO_APPLY') {
    const claimReason = decision.target.kind === 'EXISTING_CASE'
      ? `AUTO_APPLIED:CLAIMED:EXISTING_CASE:${target.caseId ?? decision.target.caseId}`
      : `AUTO_APPLIED:CLAIMED:NEW_CASE:${target.productionPlanId ?? ''}`
    return {
      caseId: claimed && decision.target.kind === 'EXISTING_CASE' ? target.caseId ?? decision.target.caseId : supplyCase?.id ?? null,
      correlationId: claimed && decision.target.kind === 'EXISTING_CASE' ? null : supplyCase?.correlationId ?? null,
      messageIntent: decision.signal.intent,
      extraction: decision.signal,
      extractionConfidence: decision.signal.confidence,
      triageDisposition: claimed ? null : 'AUTO_APPLIED',
      triageOutcome: 'AUTO_APPLIED',
      candidateIndexes: decision.target.kind === 'EXISTING_CASE' ? [decision.target.candidateIndex] : [],
      needsAttention: false,
      failureReason: claimed ? claimReason : null,
    }
  }
  if (decision.outcome === 'NEEDS_ATTENTION') {
    return {
      caseId: supplyCase?.id ?? null,
      correlationId: supplyCase?.correlationId ?? null,
      messageIntent: decision.signal.intent,
      extraction: decision.signal,
      extractionConfidence: decision.signal.confidence,
      triageDisposition: null,
      triageOutcome: 'NEEDS_ATTENTION',
      candidateIndexes: [...decision.candidateIndexes],
      needsAttention: true,
      failureReason: claimed
        ? `NEEDS_ATTENTION:${decision.reason}:CLAIMED:NEW_CASE:${target.productionPlanId ?? ''}`
        : `NEEDS_ATTENTION:${decision.reason}`,
    }
  }
  return {
    caseId: null,
    correlationId: null,
    messageIntent: null,
    extraction: null,
    extractionConfidence: null,
    triageDisposition: 'QUARANTINED',
    triageOutcome: 'QUARANTINED',
    candidateIndexes: [],
    needsAttention: decision.needsAttention,
    failureReason: `QUARANTINED:${decision.reason}`,
  }
}

type PersistedClaimTarget =
  | { kind: 'EXISTING_CASE'; caseId: string }
  | { kind: 'NEW_CASE'; productionPlanId: string }

function parseClaimTarget(reason: string | null): PersistedClaimTarget | null {
  if (!reason) return null
  const parts = reason.split(':')
  if (parts[0] === 'AUTO_APPLIED' && parts[1] === 'CLAIMED' && parts[2] === 'EXISTING_CASE' && parts[3]) {
    return { kind: 'EXISTING_CASE', caseId: parts.slice(3).join(':') }
  }
  if (parts[0] === 'AUTO_APPLIED' && parts[1] === 'CLAIMED' && parts[2] === 'NEW_CASE' && parts[3]) {
    return { kind: 'NEW_CASE', productionPlanId: parts.slice(3).join(':') }
  }
  if (parts[0] === 'NEEDS_ATTENTION' && parts[2] === 'CLAIMED' && parts[3] === 'NEW_CASE' && parts[4]) {
    return { kind: 'NEW_CASE', productionPlanId: parts.slice(4).join(':') }
  }
  return null
}
