import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { ConfirmationPlanContract, ConfirmationRole, ConfirmationVerdict, SupplyCase } from '../data/types'
import { RecordNotFoundError, VersionConflictError } from '../data/errors'
import { emitSupplyCasesEvent } from '../events'
import { applyResolution } from '../lib/resolution/applyResolution'
import { evaluateConfirmationDeadline, resolveConfirmationWindowMs } from '../lib/resolution/confirmationDeadline'
import { evaluateConfirmationJoin } from '../lib/resolution/confirmationJoin'
import { parseConfirmationPlanContract } from '../lib/resolution/planContract'
import { resolveConfirmationRole, validateConfirmation } from '../lib/resolution/validateConfirmation'

export const RECORD_CONFIRMATION_COMMAND_ID = 'supply_cases.resolution.record_confirmation'
export const APPLY_CONFIRMED_COMMAND_ID = 'supply_cases.resolution.apply_confirmed'
export const EXPIRE_CONFIRMATIONS_COMMAND_ID = 'supply_cases.resolution.expire_confirmations'

const scopeSchema = z.object({ tenantId: z.string().min(1), organizationId: z.string().min(1) }).strict()

const ENTERABLE_CONFIRMATION_STATUSES = new Set<SupplyCase['status']>(['WAITING_FOR_SUPPLIER_CONFIRMATIONS'])
const RETRIABLE_ATTENTION_REASONS = new Set<NonNullable<SupplyCase['needsAttentionReason']>>([
  'CONFIRMATION_MISMATCH',
  'WAIT_TIMEOUT',
])

/**
 * A case may accept a confirmation while actively waiting, or after a prior
 * mismatch/timeout — a late or corrected reply must not vanish silently. Any
 * other status (still analyzing, already resolved, cancelled) is not this
 * command's business.
 */
function isAwaitingConfirmations(supplyCase: SupplyCase): boolean {
  if (ENTERABLE_CONFIRMATION_STATUSES.has(supplyCase.status)) return true
  return supplyCase.status === 'NEEDS_ATTENTION' && RETRIABLE_ATTENTION_REASONS.has(supplyCase.needsAttentionReason as never)
}

// ---------------------------------------------------------------------------
// supply_cases.resolution.record_confirmation
// ---------------------------------------------------------------------------

const recordConfirmationInputSchema = z
  .object({
    inboundMessageId: z.string().min(1),
    scope: scopeSchema.optional(),
  })
  .strict()

export type RecordConfirmationResult = {
  status:
    | 'recorded'
    | 'already_recorded'
    | 'not_awaiting_confirmation'
    | 'invalid_plan'
    /** The plan shape is not one this reader understands — our defect, not the case's. */
    | 'unreadable_plan'
    | 'unknown_role'
    | 'no_case'
  caseId: string | null
  role: ConfirmationRole | null
  verdict: ConfirmationVerdict | null
  closedTheSet: boolean
}

const recordConfirmationCommand: CommandHandler<Record<string, unknown>, RecordConfirmationResult> = {
  id: RECORD_CONFIRMATION_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    await requireManageFeature(ctx)
    const input = recordConfirmationInputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')

    const message = await store.inboundMessages.findById(scope, input.inboundMessageId)
    if (!message) throw new RecordNotFoundError('InboundMessage', input.inboundMessageId)
    if (!message.caseId) {
      return { status: 'no_case', caseId: null, role: null, verdict: null, closedTheSet: false }
    }

    const supplyCase = await store.supplyCases.requireById(scope, message.caseId)

    if (!isAwaitingConfirmations(supplyCase)) {
      return { status: 'not_awaiting_confirmation', caseId: supplyCase.id, role: null, verdict: null, closedTheSet: false }
    }

    const planResult = parseConfirmationPlanContract(supplyCase.pendingResolutionPlan)
    if (!planResult.ok) {
      // Only a plan that CONTRADICTS ITSELF is the case's problem. A shape this
      // parser does not recognise is OUR problem — Phase 3 authors the plan and
      // its schema may legitimately move ahead of this reader. Flipping a
      // healthy waiting case to NEEDS_ATTENTION because we could not read the
      // plan would damage the case to report a defect in the module.
      if (planResult.reason === 'PLAN_INCONSISTENT') {
        if (supplyCase.status !== 'NEEDS_ATTENTION' || supplyCase.needsAttentionReason !== 'MISSING_DATA') {
          await store.supplyCases.update(scope, supplyCase.id, {
            status: 'NEEDS_ATTENTION',
            needsAttentionReason: 'MISSING_DATA',
          })
        }
        return { status: 'invalid_plan', caseId: supplyCase.id, role: null, verdict: null, closedTheSet: false }
      }
      return { status: 'unreadable_plan', caseId: supplyCase.id, role: null, verdict: null, closedTheSet: false }
    }
    const plan = planResult.plan

    const role = resolveConfirmationRole(plan, message.senderEmail)
    if (!role) {
      return { status: 'unknown_role', caseId: supplyCase.id, role: null, verdict: null, closedTheSet: false }
    }

    const idempotencyKey = `${supplyCase.id}:${plan.planHash}:${role}`
    const existing = await store.supplyConfirmations.findByIdempotencyKey(scope, idempotencyKey)
    if (existing) {
      // A replay is not merely "nothing to write". If the process died between
      // the closing confirmation's write and the apply it should have
      // triggered, this redelivery is the only thing that will ever come back
      // for that case — and `closedTheSet` can never be true again, because the
      // set was already complete when this record landed. So re-evaluate the
      // stored set and resume. `apply_confirmed` is idempotent and answers
      // `already_applied` when there is nothing left to do, which is what makes
      // this safe to run on every replay rather than only the interesting one.
      await resumeApplyIfComplete(ctx, store, scope, supplyCase, plan)
      return {
        status: 'already_recorded',
        caseId: supplyCase.id,
        role,
        verdict: existing.verdict,
        closedTheSet: false,
      }
    }

    const extraction = message.extraction
    const verdictResult = validateConfirmation(plan, {
      role,
      planHash: plan.planHash,
      commitments: extraction?.commitments ?? [],
      unresolved: extraction?.unresolved ?? [],
    })

    const recorded = await store.supplyConfirmations.recordAndEvaluate(
      scope,
      {
        caseId: supplyCase.id,
        planId: plan.planId,
        planHash: plan.planHash,
        role,
        supplierEmail: message.senderEmail,
        inboundMessageId: message.id,
        rfcMessageId: message.rfcMessageId,
        confirmedCommitments: extraction ? [...extraction.commitments] : [],
        verdict: verdictResult.verdict,
        mismatchReasons: verdictResult.mismatchReasons,
        idempotencyKey,
      },
      plan.requiredConfirmations,
    )

    // Post-commit: the confirmation is already durable, so nothing downstream
    // can be told about a record that was not written.
    await emitSupplyCasesEvent(
      'supply_cases.case.confirmation_recorded',
      {
        id: recorded.confirmation.id,
        caseId: supplyCase.id,
        correlationId: supplyCase.correlationId,
        role,
        verdict: recorded.confirmation.verdict,
        confirmedCommitments: recorded.confirmation.confirmedCommitments.map((commitment) => ({
          quantity: commitment.quantity,
          date: commitment.date,
        })),
        planId: plan.planId,
        inboundMessageId: message.id,
        occurredAt: recorded.confirmation.createdAt,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (verdictResult.verdict === 'DIFFERS_FROM_PLAN') {
      if (supplyCase.status !== 'NEEDS_ATTENTION' || supplyCase.needsAttentionReason !== 'CONFIRMATION_MISMATCH') {
        await store.supplyCases.update(scope, supplyCase.id, {
          status: 'NEEDS_ATTENTION',
          needsAttentionReason: 'CONFIRMATION_MISMATCH',
        })
      }
    }

    if (recorded.closedTheSet && recorded.join === 'COMPLETE') {
      await dispatchApplyConfirmed(ctx, scope, supplyCase.id)
    }

    return {
      status: 'recorded',
      caseId: supplyCase.id,
      role,
      verdict: recorded.confirmation.verdict,
      closedTheSet: recorded.closedTheSet,
    }
  },
}

registerCommand(recordConfirmationCommand)

/**
 * Recovery path for a crash between the closing confirmation and its apply.
 * Deliberately does nothing when the case is already settled: `RESOLVED` needs
 * no work, and a case parked in NEEDS_ATTENTION is waiting for a human, not for
 * a retry.
 */
async function resumeApplyIfComplete(
  ctx: CommandRuntimeContext,
  store: SupplyCasesStore,
  scope: StoreScope,
  supplyCase: SupplyCase,
  plan: ConfirmationPlanContract,
): Promise<void> {
  if (supplyCase.status === 'RESOLVED') return
  const confirmations = await store.supplyConfirmations.findByCaseId(scope, supplyCase.id)
  const relevant = confirmations.filter((confirmation) => confirmation.planHash === plan.planHash)
  if (evaluateConfirmationJoin(plan.requiredConfirmations, relevant) !== 'COMPLETE') return
  await dispatchApplyConfirmed(ctx, scope, supplyCase.id)
}

async function dispatchApplyConfirmed(ctx: CommandRuntimeContext, scope: StoreScope, caseId: string): Promise<void> {
  const commandBus = ctx.container.resolve<CommandBus>('commandBus')
  const systemCtx: CommandRuntimeContext = {
    container: ctx.container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
  await commandBus.execute<{ caseId: string; scope: StoreScope }, ApplyConfirmedResult>(APPLY_CONFIRMED_COMMAND_ID, {
    input: { caseId, scope },
    ctx: systemCtx,
  })
}

// ---------------------------------------------------------------------------
// supply_cases.resolution.apply_confirmed
// ---------------------------------------------------------------------------

const applyConfirmedInputSchema = z
  .object({
    caseId: z.string().min(1),
    scope: scopeSchema.optional(),
  })
  .strict()

export type ApplyConfirmedResult = {
  status: 'resolved' | 'needs_attention' | 'already_applied' | 'not_ready'
  caseId: string
  coveredQuantity: number | null
  requiredQuantity: number | null
  riskStatus: string | null
}

const applyConfirmedCommand: CommandHandler<Record<string, unknown>, ApplyConfirmedResult> = {
  id: APPLY_CONFIRMED_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    await requireDecisionApplyFeature(ctx)
    const input = applyConfirmedInputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')

    const supplyCase = await store.supplyCases.requireById(scope, input.caseId)

    // Idempotent no-op: no mutation, no event, no error. A second dispatch of
    // the same closed set (or a manual re-trigger after resolution) must be
    // free to happen without stock or commitments moving twice.
    if (supplyCase.status === 'RESOLVED') {
      return emptyResult('already_applied', supplyCase.id)
    }

    if (supplyCase.status !== 'WAITING_FOR_SUPPLIER_CONFIRMATIONS' && supplyCase.status !== 'APPLYING_RESOLUTION') {
      return emptyResult('not_ready', supplyCase.id)
    }

    const planResult = parseConfirmationPlanContract(supplyCase.pendingResolutionPlan)
    if (!planResult.ok) {
      await store.supplyCases.update(scope, supplyCase.id, {
        status: 'NEEDS_ATTENTION',
        needsAttentionReason: 'MISSING_DATA',
      })
      return emptyResult('needs_attention', supplyCase.id)
    }
    const plan = planResult.plan

    // The required set is recomputed from scratch, never trusted from the
    // caller: this is the command's own precondition, and it is what makes a
    // redundant dispatch (two closing confirmations racing, or a stale
    // trigger) harmless rather than a race.
    const confirmations = await store.supplyConfirmations.findByCaseId(scope, supplyCase.id)
    const relevant = confirmations.filter((confirmation) => confirmation.planHash === plan.planHash)
    const join = evaluateConfirmationJoin(plan.requiredConfirmations, relevant)
    if (join !== 'COMPLETE') {
      return emptyResult('not_ready', supplyCase.id)
    }

    let applyingCase: SupplyCase
    if (supplyCase.status === 'APPLYING_RESOLUTION') {
      // Resuming after a crash between step 1 and the commit point.
      applyingCase = supplyCase
    } else {
      try {
        applyingCase = await store.supplyCases.compareAndSwap(scope, supplyCase.id, supplyCase.updatedAt, {
          status: 'APPLYING_RESOLUTION',
        })
      } catch (error) {
        if (error instanceof VersionConflictError) return emptyResult('not_ready', supplyCase.id)
        throw error
      }
    }

    let outcome: Awaited<ReturnType<typeof applyResolution>>
    try {
      outcome = await applyResolution(store, scope, applyingCase, plan, () => new Date().toISOString())
    } catch (error) {
      // Two callers can both find the case already in APPLYING_RESOLUTION and
      // both reach here with the same version. The plan write is idempotent, so
      // the loser has nothing left to do — and the spec's posture for a
      // redundant dispatch is "harmless", which means a benign result, not an
      // exception escaping the command.
      if (error instanceof VersionConflictError) return emptyResult('already_applied', supplyCase.id)
      throw error
    }

    if (outcome.status === 'RESOLVED') {
      await emitSupplyCasesEvent(
        'supply_cases.case.resolved',
        {
          id: outcome.supplyCase.id,
          caseId: outcome.supplyCase.id,
          correlationId: outcome.supplyCase.correlationId,
          planId: plan.planId,
          coveredQuantity: outcome.coverage.coveredQuantity,
          requiredQuantity: outcome.coverage.requiredQuantity,
          riskStatus: outcome.coverage.riskStatus,
          occurredAt: outcome.supplyCase.updatedAt,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      return {
        status: 'resolved',
        caseId: outcome.supplyCase.id,
        coveredQuantity: outcome.coverage.coveredQuantity,
        requiredQuantity: outcome.coverage.requiredQuantity,
        riskStatus: outcome.coverage.riskStatus,
      }
    }

    return {
      status: 'needs_attention',
      caseId: outcome.supplyCase.id,
      coveredQuantity: outcome.coverage.coveredQuantity,
      requiredQuantity: outcome.coverage.requiredQuantity,
      riskStatus: outcome.coverage.riskStatus,
    }
  },
}

registerCommand(applyConfirmedCommand)

function emptyResult(status: ApplyConfirmedResult['status'], caseId: string): ApplyConfirmedResult {
  return { status, caseId, coveredQuantity: null, requiredQuantity: null, riskStatus: null }
}

// ---------------------------------------------------------------------------
// supply_cases.resolution.expire_confirmations
// ---------------------------------------------------------------------------

const expireConfirmationsInputSchema = z
  .object({
    caseId: z.string().min(1),
    scope: scopeSchema.optional(),
    windowMs: z.number().int().nonnegative().optional(),
  })
  .strict()

export type ExpireConfirmationsResult = {
  status: 'expired' | 'within_window' | 'already_complete' | 'not_applicable'
  caseId: string
}

const expireConfirmationsCommand: CommandHandler<Record<string, unknown>, ExpireConfirmationsResult> = {
  id: EXPIRE_CONFIRMATIONS_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    await requireManageFeature(ctx)
    const input = expireConfirmationsInputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')

    const supplyCase = await store.supplyCases.requireById(scope, input.caseId)
    if (supplyCase.status !== 'WAITING_FOR_SUPPLIER_CONFIRMATIONS') {
      return { status: 'not_applicable', caseId: supplyCase.id }
    }

    const planResult = parseConfirmationPlanContract(supplyCase.pendingResolutionPlan)
    if (!planResult.ok) {
      return { status: 'not_applicable', caseId: supplyCase.id }
    }
    const plan = planResult.plan

    const confirmations = await store.supplyConfirmations.findByCaseId(scope, supplyCase.id)
    const relevant = confirmations.filter((confirmation) => confirmation.planHash === plan.planHash)
    // Never overrides a completed join with a timeout: closing and expiring
    // are racing outcomes, and treating "complete" as "expired" here would
    // turn that race into a lie about why the case stopped waiting.
    const join = evaluateConfirmationJoin(plan.requiredConfirmations, relevant)
    if (join === 'COMPLETE') {
      return { status: 'already_complete', caseId: supplyCase.id }
    }

    const windowMs = input.windowMs ?? resolveConfirmationWindowMs()
    const deadline = evaluateConfirmationDeadline(supplyCase, new Date().toISOString(), windowMs)
    if (deadline === 'WITHIN') {
      return { status: 'within_window', caseId: supplyCase.id }
    }

    try {
      await store.supplyCases.compareAndSwap(scope, supplyCase.id, supplyCase.updatedAt, {
        status: 'NEEDS_ATTENTION',
        needsAttentionReason: 'WAIT_TIMEOUT',
      })
    } catch (error) {
      if (error instanceof VersionConflictError) return { status: 'not_applicable', caseId: supplyCase.id }
      throw error
    }

    return { status: 'expired', caseId: supplyCase.id }
  },
}

registerCommand(expireConfirmationsCommand)

export { recordConfirmationCommand, applyConfirmedCommand, expireConfirmationsCommand }
export default recordConfirmationCommand

// ---------------------------------------------------------------------------
// Shared scope + ACL helpers, mirroring commands/inbound-triage.ts and
// commands/sourcing.ts exactly: `scope` is honoured only under
// `ctx.systemActor`, and a human caller is gated by the module's own features.
// ---------------------------------------------------------------------------

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

async function requireManageFeature(ctx: CommandRuntimeContext): Promise<void> {
  await requireFeature(ctx, 'supply_cases.manage', 'manage_feature_required')
}

async function requireDecisionApplyFeature(ctx: CommandRuntimeContext): Promise<void> {
  await requireFeature(ctx, 'supply_cases.decisions.apply', 'decision_feature_required')
}

async function requireFeature(ctx: CommandRuntimeContext, featureId: string, errorCode: string): Promise<void> {
  if (ctx.systemActor) return
  const userId = ctx.auth?.sub
  if (!userId) throw new CrudHttpError(403, { error: errorCode })
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (tenantId && organizationId) {
    try {
      const rbac = ctx.container.resolve<{
        userHasAllFeatures: (id: string, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean>
      }>('rbacService')
      if (!(await rbac.userHasAllFeatures(userId, [featureId], { tenantId, organizationId }))) {
        throw new CrudHttpError(403, { error: errorCode })
      }
      return
    } catch (error) {
      if (error instanceof CrudHttpError) throw error
    }
  }
  const auth = ctx.auth as unknown as { features?: string[]; grantedFeatures?: string[] }
  if (!hasFeature(auth.features ?? auth.grantedFeatures, featureId)) throw new CrudHttpError(403, { error: errorCode })
}
