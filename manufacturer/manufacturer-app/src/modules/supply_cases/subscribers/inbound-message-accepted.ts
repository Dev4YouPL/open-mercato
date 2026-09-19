/**
 * Persistent subscriber for `supply_cases.inbound_message.accepted`.
 *
 * This is the join between the deterministic transport gate and the rest of the
 * module: the gate proved the message may be processed, and this step decides
 * what it means and gives the case a durable process.
 *
 * It deliberately reaches triage through the `supply_cases.inbound.apply_triage`
 * COMMAND rather than calling the apply step directly. The command is where the
 * auto-apply bar, the candidate list and the agent run live, and routing a
 * second caller around it would give the module two places that decide whether a
 * message may touch a case. The CLI and a future operator action use the same
 * entry point for the same reason.
 *
 * What stays here is what the command has no business knowing: starting and
 * signalling the durable workflow.
 */
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { SupplyCase } from '../data/types'
import { APPLY_TRIAGE_COMMAND_ID, type ApplyTriageCommandResult } from '../commands/inbound-triage'
import { RECORD_INITIAL_IMPACT_COMMAND_ID, type RecordInitialImpactResult } from '../commands/initial-impact'
import { RECORD_CONFIRMATION_COMMAND_ID, type RecordConfirmationResult } from '../commands/resolution'
import { INBOUND_CASE_REPLY_SIGNAL, INBOUND_CASE_WORKFLOW_ID } from '../workflows'

export const metadata = {
  event: 'supply_cases.inbound_message.accepted',
  persistent: true,
  id: 'supply_cases:inbound-message-accepted',
}

type WorkflowExecutor = {
  startWorkflow(
    em: EntityManager,
    options: {
      workflowId: string
      initialContext: Record<string, unknown>
      correlationKey: string
      metadata: { entityType: string; entityId: string; initiatedBy: string }
      tenantId: string
      organizationId: string
    },
  ): Promise<{ id: string }>
  executeWorkflow(em: EntityManager, container: unknown, instanceId: string): Promise<unknown>
}

type SignalHandler = {
  sendSignal(
    em: EntityManager,
    container: unknown,
    options: {
      instanceId: string
      signalName: string
      payload: Record<string, unknown>
      tenantId: string
      organizationId: string
    },
  ): Promise<void>
}

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
}

type AcceptedPayload = {
  inboundMessageId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export default async function handler(payload: AcceptedPayload, ctx: SubscriberContext): Promise<void> {
  const inboundMessageId = asNonEmptyString(payload?.inboundMessageId)
  const tenantId = asNonEmptyString(payload?.tenantId)
  const organizationId = asNonEmptyString(payload?.organizationId)
  // The gate only emits a fully scoped payload. A malformed one is not a
  // licence to look wider, so it is dropped rather than defaulted.
  if (!inboundMessageId || !tenantId || !organizationId) return

  const scope: StoreScope = { tenantId, organizationId }
  const container = ctx.container ?? { resolve: ctx.resolve }
  const store = container.resolve<SupplyCasesStore>('supplyCasesStore')

  const result = await runTriageCommand(container, scope, inboundMessageId)

  // Only an auto-applied message is on a case, and only a case can have a
  // process. Everything else — a replay, a quarantine, a message waiting for a
  // human — deliberately starts nothing.
  if (result.status !== 'applied' || result.outcome !== 'AUTO_APPLY' || !result.caseId) return

  const supplyCase = await store.supplyCases.findById(scope, result.caseId)
  if (!supplyCase) return

  await ensureWorkflow(container, store, scope, supplyCase, inboundMessageId)
  await recordInitialImpactIfAvailable(container, scope, supplyCase.id)

  // A supplier's confirmation reply is settled through the SAME command bar as
  // every other Phase 4 entry point (the CLI, a future operator action): this
  // subscriber only decides that a confirmed message deserves a call, never
  // what the call does with it.
  const message = await store.inboundMessages.findById(scope, inboundMessageId)
  if (message?.messageIntent === 'SUPPLY_COMMITMENT_CONFIRMED') {
    await recordConfirmationCommand(container, scope, inboundMessageId)
  }
}

async function recordConfirmationCommand(
  container: ResolverContainer,
  scope: StoreScope,
  inboundMessageId: string,
): Promise<void> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
  await commandBus.execute<{ inboundMessageId: string; scope: StoreScope }, RecordConfirmationResult>(
    RECORD_CONFIRMATION_COMMAND_ID,
    { input: { inboundMessageId, scope }, ctx: commandCtx },
  )
}

async function recordInitialImpactIfAvailable(container: ResolverContainer, scope: StoreScope, caseId: string): Promise<void> {
  let advisorFactory: unknown
  try {
    advisorFactory = container.resolve('initialImpactAdvisorInvokerFactory')
  } catch {
    return
  }
  if (typeof advisorFactory !== 'function') return
  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
  await commandBus.execute<{ caseId: string; scope: StoreScope }, RecordInitialImpactResult>(RECORD_INITIAL_IMPACT_COMMAND_ID, {
    input: { caseId, scope },
    ctx: commandCtx,
  })
}

/**
 * The command runs as a trusted system invocation: an event subscriber has no
 * authenticated actor, so it states the scope it was handed by the gate and the
 * command honours it only because `systemActor` is set.
 */
async function runTriageCommand(
  container: ResolverContainer,
  scope: StoreScope,
  inboundMessageId: string,
): Promise<ApplyTriageCommandResult> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }

  const { result } = await commandBus.execute<
    { inboundMessageId: string; scope: StoreScope },
    ApplyTriageCommandResult
  >(APPLY_TRIAGE_COMMAND_ID, { input: { inboundMessageId, scope }, ctx: commandCtx })

  return result
}

/**
 * One case, one instance. A case that already has a process gets the new message
 * delivered as a signal instead of a second instance, because two instances on
 * one case would each hold their own idea of what the case is waiting for.
 */
async function ensureWorkflow(
  container: ResolverContainer,
  store: SupplyCasesStore,
  scope: StoreScope,
  supplyCase: SupplyCase,
  inboundMessageId: string,
): Promise<void> {
  const em = container.resolve<EntityManager>('em').fork()

  if (supplyCase.workflowInstanceId) {
    const signalHandler = container.resolve<SignalHandler>('signalHandler')
    await signalHandler.sendSignal(em, container, {
      instanceId: supplyCase.workflowInstanceId,
      signalName: INBOUND_CASE_REPLY_SIGNAL,
      payload: { inboundMessageId, caseId: supplyCase.id },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return
  }

  const workflowExecutor = container.resolve<WorkflowExecutor>('workflowExecutor')
  const instance = await workflowExecutor.startWorkflow(em, {
    workflowId: INBOUND_CASE_WORKFLOW_ID,
    initialContext: {
      inboundMessageId,
      caseId: supplyCase.id,
      correlationId: supplyCase.correlationId,
    },
    correlationKey: `supply-case:${supplyCase.id}`,
    metadata: {
      entityType: 'supply_cases.case',
      entityId: supplyCase.id,
      initiatedBy: 'system:supply_cases',
    },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  // Persisted before the instance is executed: a crash mid-execution must not
  // leave a running instance the case cannot name, which would start a second
  // one on the next message.
  await store.supplyCases.update(scope, supplyCase.id, { workflowInstanceId: instance.id })
  await workflowExecutor.executeWorkflow(em.fork(), container, instance.id)
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
