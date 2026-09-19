import { z } from 'zod'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { emitSupplyCasesEvent } from '../events'
import { createAgentRuntimeInvoker } from '../lib/triage/agentRuntimeInvoker'
import type { InboundTriageInvoker } from '../lib/triage/runInboundTriage'
import { applyTriageOutcome, type ApplyTriageOutcome } from '../lib/triage/applyTriageOutcome'

/**
 * `supply_cases.inbound.apply_triage` — the deterministic half of the inbound
 * path, exposed as a command so the workflow, the CLI and a future operator
 * action all reach the SAME bar.
 *
 * The input is an inbound message id and nothing else. The agent run, the
 * candidate list and the auto-apply rules are all resolved inside: a command
 * that accepted a finished decision would let its caller submit one that never
 * cleared the bar, and a command that accepted a case id would reopen exactly
 * the correlation hole the closed candidate list exists to shut.
 */

export const APPLY_TRIAGE_COMMAND_ID = 'supply_cases.inbound.apply_triage'

const scopeInputSchema = z
  .object({
    tenantId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict()

/**
 * `scope` exists for trusted server-side callers only — an event subscriber or a
 * workflow activity has no authenticated actor to derive it from. It is honoured
 * exclusively under `ctx.systemActor`; see `resolveScope`.
 */
const applyTriageInputSchema = z
  .object({
    inboundMessageId: z.string().min(1),
    scope: scopeInputSchema.optional(),
  })
  .strict()

export type ApplyTriageCommandResult = {
  status: ApplyTriageOutcome['status']
  inboundMessageId: string
  caseId: string | null
  correlationId: string | null
  disposition: string | null
  /** `AUTO_APPLY`, `NEEDS_ATTENTION` or `QUARANTINE`; null on a replay. */
  outcome: string | null
  reason: string | null
  /** True only when this run created the case, false for a reply onto an existing one. */
  caseCreated: boolean
}

const applyTriageCommand: CommandHandler<Record<string, unknown>, ApplyTriageCommandResult> = {
  id: APPLY_TRIAGE_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = applyTriageInputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')

    const outcome = await applyTriageOutcome(
      {
        store,
        scope,
        invoke: resolveInvoker(ctx, scope),
      },
      input.inboundMessageId,
    )

    // Post-commit: the disposition and the case are already durable, so nothing
    // downstream can be told about a link that was not written.
    const proposalRecovered = await announceProposal(scope, store, outcome)

    return summarize(input.inboundMessageId, outcome, proposalRecovered)
  },
}

registerCommand(applyTriageCommand)

export default applyTriageCommand

/**
 * How the agent is reached is a DI seam, not a hard-wired call.
 *
 * `register()` binds `inboundTriageInvokerFactory` to the real agent runtime, so
 * production behaviour is unchanged. Tests and the e2e harness bind their own
 * factory and drive the whole command — gate, bar, persistence, event — without
 * a provider key. The direct construction stays as the fallback so the command
 * still works in a container that never registered the factory.
 */
function resolveInvoker(ctx: CommandRuntimeContext, scope: StoreScope): InboundTriageInvoker {
  const userId = resolveActorId(ctx)
  try {
    const factory = ctx.container.resolve<
      (invokerScope: StoreScope, invokerUserId?: string) => InboundTriageInvoker
    >('inboundTriageInvokerFactory')
    if (typeof factory === 'function') return factory(scope, userId)
  } catch {
    // Not registered in this container; fall through to the runtime invoker.
  }
  return createAgentRuntimeInvoker({ container: ctx.container, scope, userId })
}

/**
 * Emits `supply_cases.case.proposal_received` for exactly the one outcome that
 * justifies it: a first-time apply that cleared the bar and OPENED a case.
 *
 * Everything else is silent on purpose. A reply correlated onto an existing case
 * is not a new proposal — announcing one would make every subscriber re-handle a
 * case it has already seen. `already_settled` is a redelivery, and the first run
 * already announced it. NEEDS_ATTENTION and QUARANTINE never linked a case, so
 * there is no proposal to announce; saying otherwise would let a subscriber act
 * on a correlation a human has not yet confirmed.
 *
 * The payload carries identifiers and scope only — the supplier's prose stays in
 * the intake record.
 */
async function announceProposal(
  scope: StoreScope,
  store: SupplyCasesStore,
  outcome: ApplyTriageOutcome,
): Promise<boolean> {
  const candidate = outcome.status === 'applied'
    ? outcome.decision.outcome === 'AUTO_APPLY' && outcome.decision.target.kind === 'NEW_CASE'
      ? { message: outcome.message, supplyCase: outcome.supplyCase, signal: outcome.decision.signal }
      : null
    : outcome.message.triageOutcome === 'AUTO_APPLIED' && outcome.message.caseId && outcome.message.candidateIndexes.length === 0 && outcome.message.extraction
      ? {
          message: outcome.message,
          supplyCase: await store.supplyCases.findById(scope, outcome.message.caseId),
          signal: outcome.message.extraction,
        }
      : null
  if (!candidate?.supplyCase) return false

  const claimed = await store.inboundMessages.claimProposalAnnouncement(scope, candidate.message.id)
  if (!claimed) return false

  try {
    await emitSupplyCasesEvent(
      'supply_cases.case.proposal_received',
      {
        id: candidate.supplyCase.id,
        caseId: candidate.supplyCase.id,
        correlationId: candidate.supplyCase.correlationId,
        inboundMessageId: candidate.message.id,
        rfcMessageId: candidate.message.rfcMessageId,
        senderEmail: candidate.message.senderEmail,
        sku: candidate.signal.sku,
        commitments: candidate.signal.commitments.map((commitment) => ({
          quantity: commitment.quantity,
          date: commitment.date,
        })),
        caseCreated: true,
        occurredAt: candidate.message.receivedAt ?? candidate.message.createdAt,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    await store.inboundMessages.completeProposalAnnouncement(scope, candidate.message.id)
    return true
  } catch (error) {
    await store.inboundMessages.releaseProposalAnnouncement(scope, candidate.message.id)
    throw error
  }
}

function summarize(inboundMessageId: string, outcome: ApplyTriageOutcome, proposalRecovered = false): ApplyTriageCommandResult {
  if (outcome.status === 'already_settled') {
    return {
      status: outcome.status,
      inboundMessageId,
      caseId: outcome.message.caseId,
      correlationId: outcome.message.correlationId,
      disposition: outcome.disposition,
      outcome: proposalRecovered ? 'AUTO_APPLY' : null,
      reason: null,
      caseCreated: false,
    }
  }
  const { decision } = outcome
  return {
    status: outcome.status,
    inboundMessageId,
    caseId: outcome.supplyCase?.id ?? null,
    correlationId: outcome.supplyCase?.correlationId ?? null,
    disposition: decision.disposition,
    outcome: decision.outcome,
    reason: decision.outcome === 'AUTO_APPLY' ? null : decision.reason,
    caseCreated: outcome.caseCreated,
  }
}

/**
 * Two callers, two ways to establish scope, and the boundary between them is
 * `ctx.systemActor` — a flag HTTP paths are forbidden to set.
 *
 * For a request, scope still comes from the authenticated context and ONLY from
 * there: an inbound message id is not proof of which tenant may read it. A
 * request that supplies `scope` is rejected rather than quietly ignored, because
 * a caller who believes it selected a tenant and silently got another one is a
 * worse outcome than an error.
 *
 * For a trusted server-side caller — the inbound workflow, a CLI backfill —
 * there is no actor to derive anything from, so `scope` is required and used as
 * given. Falling back to "no scope means every scope" is the one behaviour this
 * function must never have.
 */
function resolveScope(ctx: CommandRuntimeContext, requested: StoreScope | undefined): StoreScope {
  if (ctx.systemActor) {
    if (!requested) {
      throw new CrudHttpError(400, { error: 'A system invocation must state its tenant and organization' })
    }
    return requested
  }

  if (requested) {
    throw new CrudHttpError(403, { error: 'Scope may only be supplied by a trusted system invocation' })
  }

  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return { tenantId, organizationId }
}

/**
 * Workflow-originated runs carry no end-user actor, so the run is attributed to
 * the trusted server invocation that started it.
 */
function resolveActorId(ctx: CommandRuntimeContext): string {
  return ctx.auth?.sub ?? 'system'
}
