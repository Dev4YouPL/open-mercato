import { z } from 'zod'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { initialOptionIdSchema, initialOptionSchema, type CanonicalInitialOption } from '../data/initial-impact'
import { markAlternativeRequestDelivered, resolveDefaultOutboundPorts, requestAlternativeSupplier } from '../lib/sourcing/alternativeRequest'
import type { SupplierOutboundPorts } from '../lib/outbound/sendSupplierMessage'
import { VersionConflictError } from '../data/errors'
import { signalCaseWorkflow } from '../lib/workflow/phaseSignals'
import { SOURCING_DECISION_SIGNAL } from '../workflows'

export const APPLY_SOURCING_DECISION_COMMAND_ID = 'supply_cases.sourcing.apply_decision'
export const REQUEST_ALTERNATIVE_COMMAND_ID = 'supply_cases.sourcing.request_alternative'
export const MARK_ALTERNATIVE_DELIVERED_COMMAND_ID = 'supply_cases.sourcing.mark_alternative_delivered'

const scopeSchema = z.object({ tenantId: z.string().min(1), organizationId: z.string().min(1) }).strict()
const decisionSchema = z.object({
  caseId: z.string().min(1),
  proposalId: z.string().min(1),
  factsHash: z.string().min(1),
  expectedUpdatedAt: z.string().min(1),
  kind: z.enum(['SELECT', 'REJECT', 'EDIT']),
  selectedOptionId: initialOptionIdSchema.nullable(),
  reason: z.string().trim().nullable(),
  idempotencyKey: z.string().min(1),
  scope: scopeSchema.optional(),
}).strict()
const requestSchema = z.object({
  caseId: z.string().min(1),
  expectedUpdatedAt: z.string().min(1).optional(),
  scope: scopeSchema.optional(),
}).strict()
const deliverySchema = z.object({ caseId: z.string().min(1), scope: scopeSchema.optional() }).strict()

export type SourcingDecisionResult = {
  status: 'selected' | 'rejected' | 'edited' | 'already_applied' | 'pending_delivery'
  caseId: string
  selectedOptionId: string | null
  outboundCorrelationId: string | null
}

const applySourcingDecision: CommandHandler<Record<string, unknown>, SourcingDecisionResult> = {
  id: APPLY_SOURCING_DECISION_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = decisionSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    await requireDecisionFeature(ctx, scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const supplyCase = await store.supplyCases.requireById(scope, input.caseId)
    if (supplyCase.initialDecisionIdempotencyKey === input.idempotencyKey) {
      return {
        status: 'already_applied',
        caseId: supplyCase.id,
        selectedOptionId: supplyCase.selectedInitialOptionId,
        outboundCorrelationId: null,
      }
    }
    if (
      supplyCase.initialDecisionIdempotencyKey
      && supplyCase.initialDecisionIdempotencyKey !== input.idempotencyKey
      && supplyCase.initialDecisionKind !== 'EDIT'
    ) {
      throw new CrudHttpError(409, { error: 'sourcing_decision_already_applied' })
    }
    if (supplyCase.initialProposalId !== input.proposalId || supplyCase.initialFactsHash !== input.factsHash) {
      throw new CrudHttpError(409, { error: 'stale_sourcing_proposal' })
    }
    if (supplyCase.status !== 'AWAITING_SOURCING_DECISION') throw new CrudHttpError(422, { error: 'sourcing_decision_not_available' })

    if (input.kind === 'REJECT') {
      if (!input.reason) throw new CrudHttpError(400, { error: 'rejection_reason_required' })
      await claimDecision(store, scope, supplyCase.id, input.expectedUpdatedAt, {
        status: 'REJECTED',
        selectedInitialOptionId: null,
        initialDecisionIdempotencyKey: input.idempotencyKey,
        initialDecisionKind: 'REJECT',
        initialDecisionReason: input.reason,
      })
      return { status: 'rejected', caseId: supplyCase.id, selectedOptionId: null, outboundCorrelationId: null }
    }

    if (!input.selectedOptionId) throw new CrudHttpError(400, { error: 'selected_option_required' })
    const option = parseOption(supplyCase.initialOptions, input.selectedOptionId)
    if (!option) throw new CrudHttpError(422, { error: 'selected_option_not_in_proposal' })
    if (input.kind === 'EDIT') {
      if (!input.reason) throw new CrudHttpError(400, { error: 'edit_reason_required' })
      await claimDecision(store, scope, supplyCase.id, input.expectedUpdatedAt, {
        initialAnalysis: mergeOperatorEdit(supplyCase.initialAnalysis, input.selectedOptionId, input.reason),
        initialDecisionKind: 'EDIT',
        initialDecisionReason: input.reason,
        initialDecisionIdempotencyKey: input.idempotencyKey,
        selectedInitialOptionId: null,
        status: 'AWAITING_SOURCING_DECISION',
      })
      return { status: 'edited', caseId: supplyCase.id, selectedOptionId: null, outboundCorrelationId: null }
    }

    const claimed = await claimDecision(store, scope, supplyCase.id, input.expectedUpdatedAt, {
      selectedInitialOptionId: option.id,
      initialDecisionIdempotencyKey: input.idempotencyKey,
      initialDecisionKind: 'SELECT',
      initialDecisionReason: input.reason ?? null,
      status: option.id === 'CHECK_ALTERNATIVE_SUPPLIER' ? 'SENDING_ALTERNATIVE_REQUEST' : 'SENDING_PLAN_ACCEPTANCE',
    })
    if (option.id !== 'CHECK_ALTERNATIVE_SUPPLIER') {
      await store.supplyCases.update(scope, supplyCase.id, {
        pendingResolutionPlan: buildPendingPlan(option, input.factsHash),
      })
      return { status: 'selected', caseId: supplyCase.id, selectedOptionId: option.id, outboundCorrelationId: null }
    }

    await signalCaseWorkflow(ctx.container, scope, claimed.workflowInstanceId, SOURCING_DECISION_SIGNAL, {
      caseId: claimed.id,
      selectedOptionId: option.id,
    })

    const requestResult = await requestAlternativeSupplier({
      store,
      scope,
      caseId: supplyCase.id,
      option,
      ports: resolvePorts(ctx, store),
    })
    if (requestResult.status === 'pending_delivery') {
      return {
        status: 'pending_delivery',
        caseId: supplyCase.id,
        selectedOptionId: option.id,
        outboundCorrelationId: requestResult.result.status === 'accepted' || requestResult.result.status === 'already_requested'
          ? requestResult.result.correlationId
          : null,
      }
    }
    await store.supplyCases.update(scope, supplyCase.id, {
      status: 'NEEDS_ATTENTION',
      needsAttentionReason: 'DELIVERY_FAILED',
    })
    throw new CrudHttpError(422, { error: requestResult.reason })
  },
}

const requestAlternative: CommandHandler<Record<string, unknown>, SourcingDecisionResult> = {
  id: REQUEST_ALTERNATIVE_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = requestSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    await requireDecisionFeature(ctx, scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const supplyCase = await store.supplyCases.requireById(scope, input.caseId)
    if (input.expectedUpdatedAt && supplyCase.updatedAt !== input.expectedUpdatedAt) throw new CrudHttpError(409, { error: 'stale_supply_case' })
    const option = parseOption(supplyCase.initialOptions, 'CHECK_ALTERNATIVE_SUPPLIER')
    if (!option) throw new CrudHttpError(422, { error: 'alternative_option_missing' })
    if (supplyCase.status !== 'SENDING_ALTERNATIVE_REQUEST' && supplyCase.status !== 'NEEDS_ATTENTION') {
      if (supplyCase.status === 'WAITING_FOR_ALTERNATIVE_OFFER') return { status: 'already_applied', caseId: supplyCase.id, selectedOptionId: option.id, outboundCorrelationId: null }
      throw new CrudHttpError(422, { error: 'alternative_request_not_available' })
    }
    const result = await requestAlternativeSupplier({ store, scope, caseId: supplyCase.id, option, ports: resolvePorts(ctx, store) })
    if (result.status === 'pending_delivery') {
      await store.supplyCases.update(scope, supplyCase.id, { status: 'SENDING_ALTERNATIVE_REQUEST', needsAttentionReason: null })
      return {
        status: 'pending_delivery',
        caseId: supplyCase.id,
        selectedOptionId: option.id,
        outboundCorrelationId: result.result.correlationId,
      }
    }
    await store.supplyCases.update(scope, supplyCase.id, { status: 'NEEDS_ATTENTION', needsAttentionReason: 'DELIVERY_FAILED' })
    throw new CrudHttpError(422, { error: result.reason })
  },
}

const markAlternativeDelivered: CommandHandler<Record<string, unknown>, { status: 'recorded' | 'already_recorded'; caseId: string }> = {
  id: MARK_ALTERNATIVE_DELIVERED_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = deliverySchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const changed = await markAlternativeRequestDelivered(store, scope, input.caseId)
    return { status: changed ? 'recorded' : 'already_recorded', caseId: input.caseId }
  },
}

registerCommand(applySourcingDecision)
registerCommand(requestAlternative)
registerCommand(markAlternativeDelivered)
export { applySourcingDecision, requestAlternative, markAlternativeDelivered }

function parseOption(value: unknown, id: string): CanonicalInitialOption | null {
  if (!Array.isArray(value)) return null
  const entry = value.find((candidate) => candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === id)
  const parsed = initialOptionSchema.safeParse(entry)
  return parsed.success ? parsed.data : null
}

function buildPendingPlan(option: CanonicalInitialOption, factsHash: string) {
  return { schemaVersion: 1, optionId: option.id, factsHash, supply: option.supply, requiredConfirmations: option.requiredConfirmations }
}

function mergeOperatorEdit(value: unknown, selectedOptionId: string, reason: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { operatorEdit: { selectedOptionId, reason } }
  return { ...(value as Record<string, unknown>), operatorEdit: { selectedOptionId, reason } }
}

function resolvePorts(ctx: CommandRuntimeContext, store: SupplyCasesStore): SupplierOutboundPorts {
  try {
    const factory = ctx.container.resolve<(container: unknown, resolvedStore: SupplyCasesStore) => SupplierOutboundPorts>('supplyCaseOutboundPortsFactory')
    return factory(ctx.container, store)
  } catch {
    return resolveDefaultOutboundPorts(ctx.container, store)
  }
}

async function requireDecisionFeature(ctx: CommandRuntimeContext, scope: StoreScope): Promise<void> {
  if (ctx.systemActor) return
  const userId = ctx.auth?.sub
  if (!userId) throw new CrudHttpError(403, { error: 'decision_feature_required' })
  try {
    const rbac = ctx.container.resolve<{ userHasAllFeatures: (id: string, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean> }>('rbacService')
    if (!(await rbac.userHasAllFeatures(userId, ['supply_cases.decisions.apply'], scope))) throw new CrudHttpError(403, { error: 'decision_feature_required' })
    return
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
  }
  const auth = ctx.auth as unknown as { features?: string[]; grantedFeatures?: string[] }
  if (!hasFeature(auth.features ?? auth.grantedFeatures, 'supply_cases.decisions.apply')) throw new CrudHttpError(403, { error: 'decision_feature_required' })
}

function resolveScope(ctx: CommandRuntimeContext, requested: StoreScope | undefined): StoreScope {
  if (ctx.systemActor) {
    if (!requested) throw new CrudHttpError(400, { error: 'scope_required' })
    return requested
  }
  if (requested) throw new CrudHttpError(403, { error: 'scope_not_allowed' })
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: 'organization_scope_required' })
  return { tenantId, organizationId }
}

async function claimDecision(
  store: SupplyCasesStore,
  scope: StoreScope,
  caseId: string,
  expectedUpdatedAt: string,
  patch: Parameters<SupplyCasesStore['supplyCases']['update']>[2],
) {
  try {
    return await store.supplyCases.compareAndSwap(scope, caseId, expectedUpdatedAt, patch)
  } catch (error) {
    if (error instanceof VersionConflictError) throw new CrudHttpError(409, { error: 'stale_supply_case' })
    throw error
  }
}
