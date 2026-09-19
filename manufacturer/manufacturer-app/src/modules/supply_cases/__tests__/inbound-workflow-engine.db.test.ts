/**
 * TEST-002 — T-10b against the REAL database-backed workflow engine.
 *
 * `inbound-flow.e2e.test.ts` drives the same subscriber with a workflow harness:
 * it proves the module calls `startWorkflow`/`sendSignal` once each, and nothing
 * about the engine. The claim T-10b actually makes — one durable
 * `WorkflowInstance` per case, named by the case, still there after the process
 * that started it is gone, and resumed by the next correlated message — can only
 * be proven against a live engine over a live database, because the fact under
 * test IS the persisted row.
 *
 * So this file resolves `workflowExecutor` and `signalHandler` from the
 * workflows module's own `register()`, runs them over a real MikroORM
 * connection, and simulates the restart by closing the ORM and the JSON store
 * and rebuilding both from the same durable state.
 *
 * Skipped — loudly — when `DATABASE_URL` is unset, because an empty run must
 * never read as a pass. When it IS set, a connection failure fails the suite:
 * a configured database that cannot be reached is a broken environment, not an
 * excuse to skip the only coverage of the durability claim.
 */
import 'dotenv/config'
import 'reflect-metadata'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { register as registerWorkflowServices } from '@open-mercato/core/modules/workflows/di'
import { registerCodeWorkflows } from '@open-mercato/core/modules/workflows/lib/code-registry'
import {
  StepInstance,
  UserTask,
  WorkflowBranchInstance,
  WorkflowDefinition,
  WorkflowDefinitionDraft,
  WorkflowDefinitionMetricRollup,
  WorkflowEvent,
  WorkflowEventTrigger,
  WorkflowInstance,
} from '@open-mercato/core/modules/workflows/data/entities'
import { createJsonSupplyCasesStore } from '../data/json/store'
import { NEW_SUPPLY_PROPOSAL, TRIAGE_FIXTURE_SENDERS } from '../data/triage-fixtures'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { InboundTriageInvoker } from '../lib/triage/runInboundTriage'
import inboundMessageAcceptedHandler from '../subscribers/inbound-message-accepted'
import {
  ALTERNATIVE_REQUEST_DELIVERED_SIGNAL,
  INBOUND_CASE_REPLY_SIGNAL,
  INBOUND_CASE_WORKFLOW_ID,
  INITIAL_IMPACT_READY_SIGNAL,
  SOURCING_DECISION_SIGNAL,
  workflowsConfig,
} from '../workflows'
import { applySourcingDecision } from '../commands/sourcing'
import { buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import type { SupplierOutboundPorts, SupplierOutboundTransportInput } from '../lib/outbound/sendSupplierMessage'
import alternativeDeliveredHandler from '../subscribers/alternative-request-delivered'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const sender = TRIAGE_FIXTURE_SENDERS.supplier1

// uuid columns on `workflow_instances`, so the scope cannot be a readable
// label here the way it is in the JSON-only suites.
const scope: StoreScope = { tenantId: randomUUID(), organizationId: randomUUID() }
const foreignScope: StoreScope = { tenantId: randomUUID(), organizationId: randomUUID() }

const databaseUrl = process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

if (!databaseUrl) {
  console.warn('[supply_cases] TEST-002 skipped: DATABASE_URL is not set, so the workflow engine has no database.')
}

type Runtime = {
  orm: MikroORM
  container: AwilixContainer
  store: SupplyCasesStore
}

const workflowEntities = [
  WorkflowDefinition,
  WorkflowDefinitionDraft,
  WorkflowInstance,
  WorkflowBranchInstance,
  StepInstance,
  UserTask,
  WorkflowEvent,
  WorkflowEventTrigger,
  WorkflowDefinitionMetricRollup,
]

/**
 * A fresh ORM connection, container and store over the SAME data directory —
 * which is what "the process restarted" means here. The module DI warns against
 * two stores sharing a directory concurrently; the previous one is closed before
 * this runs, so nothing is concurrent.
 */
async function startRuntime(dataDir: string): Promise<Runtime> {
  const orm = await MikroORM.init({
    driver: PostgreSqlDriver,
    clientUrl: databaseUrl,
    entities: workflowEntities,
    metadataProvider: ReflectMetadataProvider,
    allowGlobalContext: true,
    discovery: { warnWhenNoEntities: false },
    debug: false,
  })

  const store = createJsonSupplyCasesStore({ dataDir })
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(orm.em.fork()),
    commandBus: asValue(new CommandBus()),
    supplyCasesStore: asValue(store),
    inboundTriageInvokerFactory: asValue(() => invoker),
  })
  // The engine's own registrations, not a stand-in: `workflowExecutor` and
  // `signalHandler` resolve to exactly what production resolves.
  registerWorkflowServices(container)

  return { orm, container, store }
}

async function stopRuntime(runtime: Runtime): Promise<void> {
  await runtime.orm.close(true)
}

/**
 * Deterministic triage, because the agent is not what this file tests. The first
 * message opens a case, every later one correlates onto candidate 0 — the case
 * the first message opened, which the sender participates in.
 */
let triageMode: 'new-case' | 'existing-case' = 'new-case'
const invoker: InboundTriageInvoker = async () => {
  const raw = NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>
  if (triageMode === 'existing-case') {
    return { ...raw, correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 } }
  }
  return raw
}

async function deliverAccepted(runtime: Runtime, inboundMessageId: string): Promise<void> {
  await inboundMessageAcceptedHandler(
    { inboundMessageId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {
      resolve: <T = unknown>(name: string): T => runtime.container.resolve<T>(name),
      container: { resolve: <T = unknown>(name: string): T => runtime.container.resolve<T>(name) },
    },
  )
}

async function appendMessage(store: SupplyCasesStore, rfcMessageId: string): Promise<string> {
  const message = await store.inboundMessages.append(scope, {
    rfcMessageId,
    senderEmail: sender,
    recipientEmail: 'manufacturer@hackon-om-wro.cloud',
    sanitizedBody: NEW_SUPPLY_PROPOSAL.sanitizedBody,
  })
  return message.id
}

async function listInstances(orm: MikroORM, instanceScope: StoreScope): Promise<WorkflowInstance[]> {
  return orm.em.fork().find(WorkflowInstance, {
    tenantId: instanceScope.tenantId,
    organizationId: instanceScope.organizationId,
  })
}

describeWithDatabase('TEST-002: inbound case workflow on the real engine', () => {
  let dataDir: string
  let runtime: Runtime

  beforeAll(async () => {
    // The engine resolves `supply_cases.inbound-case` from the code registry the
    // app bootstrap fills; without this the definition lookup finds nothing and
    // `startWorkflow` throws DEFINITION_NOT_FOUND.
    registerCodeWorkflows(workflowsConfig.workflows)
    setGlobalEventBus({ emit: async () => undefined })
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-workflow-db-'))
    runtime = await startRuntime(dataDir)
    await runtime.store.productionPlans.create(scope, {
      planNumber: 'PP-WF-DB',
      materialSku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
    })
  })

  afterAll(async () => {
    if (runtime) {
      const em = runtime.orm.em.fork()
      for (const scopeToClear of [scope, foreignScope]) {
        const where = { tenantId: scopeToClear.tenantId, organizationId: scopeToClear.organizationId }
        await em.nativeDelete(WorkflowEvent, where)
        await em.nativeDelete(StepInstance, where)
        await em.nativeDelete(WorkflowInstance, where)
      }
      await runtime.store.purgeScope(scope)
      await stopRuntime(runtime)
    }
    if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
    setGlobalEventBus({ emit: async () => undefined })
  })

  it('TEST-002A: starts one durable instance, survives a restart, signals it and ignores a replay', async () => {
    // --- 1. An accepted proposal starts exactly one instance -----------------
    triageMode = 'new-case'
    const firstMessageId = await appendMessage(runtime.store, 'wf-db-1@supplier.example')
    await deliverAccepted(runtime, firstMessageId)

    const started = await listInstances(runtime.orm, scope)
    expect(started).toHaveLength(1)
    expect(started[0].workflowId).toBe(INBOUND_CASE_WORKFLOW_ID)

    // --- 2. The case names the instance -------------------------------------
    const openedCases = await runtime.store.supplyCases.list(scope)
    expect(openedCases).toHaveLength(1)
    const caseId = openedCases[0].id
    expect(openedCases[0].workflowInstanceId).toBe(started[0].id)

    // --- 3. It is parked on the first explicit Phase 2 boundary ---------------
    expect(started[0].status).toBe('PAUSED')
    expect(started[0].currentStepId).toBe('initial-impact-advisor')
    expect(started[0].correlationKey).toBe(`supply-case:${caseId}`)

    // --- 4. Restart: new ORM connection, new container, new store ------------
    await stopRuntime(runtime)
    runtime = await startRuntime(dataDir)

    const afterRestart = await listInstances(runtime.orm, scope)
    expect(afterRestart).toHaveLength(1)
    expect(afterRestart[0].id).toBe(started[0].id)
    expect(afterRestart[0].status).toBe('PAUSED')
    expect(afterRestart[0].currentStepId).toBe('initial-impact-advisor')
    const caseAfterRestart = await runtime.store.supplyCases.requireById(scope, caseId)
    expect(caseAfterRestart.workflowInstanceId).toBe(started[0].id)

    // --- 7. Scope: the parked instance is invisible and unreachable elsewhere -
    expect(await listInstances(runtime.orm, foreignScope)).toHaveLength(0)
    const signalHandler = runtime.container.resolve<{
      sendSignal: (
        em: EntityManager,
        container: unknown,
        options: {
          instanceId: string
          signalName: string
          payload: Record<string, unknown>
          tenantId: string
          organizationId: string
        },
      ) => Promise<void>
    }>('signalHandler')
    await expect(
      signalHandler.sendSignal(runtime.container.resolve<EntityManager>('em').fork(), runtime.container, {
        instanceId: started[0].id,
        signalName: INBOUND_CASE_REPLY_SIGNAL,
        payload: { caseId },
        tenantId: foreignScope.tenantId,
        organizationId: foreignScope.organizationId,
      }),
    ).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })

    for (const [signalName, payload] of [
      [INITIAL_IMPACT_READY_SIGNAL, { caseId, proposalId: 'proposal-test' }],
      [SOURCING_DECISION_SIGNAL, { caseId, selectedOptionId: 'CHECK_ALTERNATIVE_SUPPLIER' }],
      [ALTERNATIVE_REQUEST_DELIVERED_SIGNAL, { caseId, outboundCorrelationId: 'correlation-test' }],
    ] as const) {
      await signalHandler.sendSignal(runtime.container.resolve<EntityManager>('em').fork(), runtime.container, {
        instanceId: started[0].id,
        signalName,
        payload,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }
    expect((await listInstances(runtime.orm, scope))[0]).toMatchObject({ status: 'PAUSED', currentStepId: 'await-reply' })

    // --- 5. A correlated reply signals the SAME instance ---------------------
    triageMode = 'existing-case'
    const replyMessageId = await appendMessage(runtime.store, 'wf-db-2@supplier.example')
    await deliverAccepted(runtime, replyMessageId)

    const afterReply = await listInstances(runtime.orm, scope)
    expect(afterReply).toHaveLength(1)
    expect(afterReply[0].id).toBe(started[0].id)
    // The reply released the wait, so the run advanced past `await-reply`.
    expect(afterReply[0].currentStepId).toBe('end')
    expect(afterReply[0].status).toBe('COMPLETED')
    expect(afterReply[0].context).toMatchObject({ caseId, inboundMessageId: replyMessageId })
    expect(await runtime.store.supplyCases.list(scope)).toHaveLength(1)

    // --- 6. A replay of the same message creates nothing and repeats nothing --
    const eventsBeforeReplay = await runtime.orm.em.fork().count(WorkflowEvent, {
      workflowInstanceId: started[0].id,
    })
    await deliverAccepted(runtime, replyMessageId)
    await deliverAccepted(runtime, firstMessageId)

    const afterReplay = await listInstances(runtime.orm, scope)
    expect(afterReplay).toHaveLength(1)
    expect(afterReplay[0].id).toBe(started[0].id)
    expect(afterReplay[0].status).toBe('COMPLETED')
    expect(await runtime.store.supplyCases.list(scope)).toHaveLength(1)
    expect(
      await runtime.orm.em.fork().count(WorkflowEvent, { workflowInstanceId: started[0].id }),
    ).toBe(eventsBeforeReplay)
  })

  it('TEST-006: SELECT C, delivery, restart and replay retain one workflow and one logical RFQ', async () => {
    triageMode = 'new-case'
    const messageId = await appendMessage(runtime.store, 'wf-db-phase2@supplier.example')
    await deliverAccepted(runtime, messageId)
    const acceptedMessage = await runtime.store.inboundMessages.findById(scope, messageId)
    const supplyCase = acceptedMessage?.caseId
      ? await runtime.store.supplyCases.findById(scope, acceptedMessage.caseId)
      : null
    if (!supplyCase) throw new Error('Phase 2 case was not created')
    await runtime.store.supplyCases.update(scope, supplyCase.id, { supplier2Email: 'supplier2@example.com' })
    const loaded = await loadInitialImpactSnapshot(runtime.store, scope, supplyCase.id)
    if (!loaded.ok) throw new Error(`Phase 2 impact fixture failed: ${loaded.reasonCodes.join(',')}`)
    const impact = calculateInitialImpact(loaded.snapshot)
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    const prepared = await runtime.store.supplyCases.update(scope, supplyCase.id, {
      status: 'AWAITING_SOURCING_DECISION', initialOptions: options,
      initialFactsHash: options[0].factsHash, initialProposalId: 'proposal-db-phase2',
    })
    const sends: SupplierOutboundTransportInput[] = []
    const ports: SupplierOutboundPorts = {
      outboundCorrelations: runtime.store.outboundCorrelations,
      loadOutboundChannel: async () => ({ id: 'channel-db', providerKey: 'imap', userId: 'owner-db', isActive: true, status: 'connected', externalIdentifier: 'manufacturer@example.com' }),
      newRfcMessageId: () => 'phase2-db@example.com',
      send: async (input) => { sends.push(input); return { ok: true, messageId: 'hub-message-db', threadId: 'thread-db' } },
    }
    const commandContainer = {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'supplyCasesStore') return runtime.store as T
        if (name === 'supplyCaseOutboundPortsFactory') return (() => ports) as T
        return runtime.container.resolve<T>(name)
      },
    }
    const commandContext: CommandRuntimeContext = {
      container: commandContainer as unknown as AwilixContainer, auth: null, organizationScope: null,
      selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], systemActor: true,
    }
    const decisionInput = {
      caseId: supplyCase.id, proposalId: 'proposal-db-phase2', factsHash: options[0].factsHash,
      expectedUpdatedAt: prepared.updatedAt, kind: 'SELECT', selectedOptionId: 'CHECK_ALTERNATIVE_SUPPLIER',
      reason: null, idempotencyKey: 'decision-db-phase2', scope,
    }
    await runtime.container.resolve<{
      sendSignal: (em: EntityManager, container: unknown, options: Record<string, unknown>) => Promise<void>
    }>('signalHandler').sendSignal(runtime.container.resolve<EntityManager>('em').fork(), runtime.container, {
      instanceId: supplyCase.workflowInstanceId,
      signalName: INITIAL_IMPACT_READY_SIGNAL,
      payload: { caseId: supplyCase.id, proposalId: 'proposal-db-phase2' },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    await applySourcingDecision.execute(decisionInput, commandContext)
    expect(sends).toHaveLength(1)
    expect((await listInstances(runtime.orm, scope)).find((entry) => entry.id === supplyCase.workflowInstanceId)).toMatchObject({
      status: 'PAUSED', currentStepId: 'alternative-request-delivery',
    })
    expect(await runtime.store.supplyCases.requireById(scope, supplyCase.id)).toMatchObject({
      initialDecisionIdempotencyKey: 'decision-db-phase2',
    })
    await alternativeDeliveredHandler(
      { channelLinkId: 'link-db', ...scope },
      {
        resolve: <T = unknown>(name: string): T => {
          if (name === 'supplyCasesStore') return runtime.store as T
          if (name === 'em') {
            return {
              fork: () => {
                const fork = runtime.container.resolve<EntityManager>('em').fork()
                const findOne = fork.findOne.bind(fork)
                fork.findOne = ((entity: unknown, where: unknown, options?: unknown) => (
                  typeof entity === 'string'
                    ? Promise.resolve({ channelMetadata: { messageId: 'phase2-db@example.com' } })
                    : findOne(entity as never, where as never, options as never)
                )) as typeof fork.findOne
                return fork
              },
            } as T
          }
          return runtime.container.resolve<T>(name)
        },
      },
    )
    expect(await runtime.store.supplyCases.requireById(scope, supplyCase.id)).toMatchObject({
      status: 'WAITING_FOR_ALTERNATIVE_OFFER', initialDecisionIdempotencyKey: 'decision-db-phase2',
    })
    const instancesBeforeRestart = await listInstances(runtime.orm, scope)
    const instance = instancesBeforeRestart.find((entry) => entry.id === supplyCase.workflowInstanceId)
    expect(instance).toMatchObject({ status: 'PAUSED', currentStepId: 'await-reply' })

    await stopRuntime(runtime)
    runtime = await startRuntime(dataDir)
    const afterRestart = await listInstances(runtime.orm, scope)
    expect(afterRestart.find((entry) => entry.id === supplyCase.workflowInstanceId)).toMatchObject({
      status: 'PAUSED', currentStepId: 'await-reply',
    })
    const replay = await applySourcingDecision.execute(decisionInput, {
      ...commandContext,
      container: {
        resolve: <T = unknown>(name: string): T => {
          if (name === 'supplyCasesStore') return runtime.store as T
          if (name === 'supplyCaseOutboundPortsFactory') return (() => ports) as T
          return runtime.container.resolve<T>(name)
        },
      } as unknown as AwilixContainer,
    })
    expect(replay.status).toBe('already_applied')
    expect(sends).toHaveLength(1)
    expect((await listInstances(runtime.orm, scope)).filter((entry) => entry.id === supplyCase.workflowInstanceId)).toHaveLength(1)
  })
})
