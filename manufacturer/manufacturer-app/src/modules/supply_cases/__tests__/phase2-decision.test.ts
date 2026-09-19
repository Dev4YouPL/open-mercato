import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createJsonSupplyCasesStore } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import type { SupplierOutboundPorts, SupplierOutboundTransportInput } from '../lib/outbound/sendSupplierMessage'
import { applySourcingDecision } from '../commands/sourcing'
import deliveredHandler from '../subscribers/alternative-request-delivered'
import exhaustedHandler from '../subscribers/alternative-request-delivery-exhausted'
import timeoutHandler from '../subscribers/alternative-offer-wait-timeout'
import { workflowsConfig } from '../workflows'

describe('TEST-006: Phase 2 sourcing decision', () => {
  let dataDir: string
  let store: SupplyCasesStore
  const scope: StoreScope = { tenantId: 'tenant-phase2', organizationId: 'org-phase2' }

  test('starts the offer timeout only after delivery advances the workflow to await-reply', () => {
    const workflow = workflowsConfig.workflows[0]
    const decisionStep = workflow.definition.steps.find((step) => step.stepId === 'human-sourcing-decision')
    const deliveryStep = workflow.definition.steps.find((step) => step.stepId === 'alternative-request-delivery')
    const offerStep = workflow.definition.steps.find((step) => step.stepId === 'await-reply')
    expect(decisionStep?.signalConfig?.timeout).toBeUndefined()
    expect(deliveryStep?.signalConfig?.timeout).toBeUndefined()
    expect(offerStep?.signalConfig?.timeout).toBe('P3D')
    expect(workflow.definition.transitions).toContainEqual(expect.objectContaining({
      fromStepId: 'alternative-request-delivery', toStepId: 'await-reply',
    }))
  })

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-phase2-'))
    store = createJsonSupplyCasesStore({ dataDir })
    const order = await store.productionOrders.create(scope, {
      orderNumber: 'PO-P2', productSku: 'FG-1', quantity: 1, materialSku: 'MAT-42', materialQuantity: 500,
      dueDate: '2026-09-23T12:00:00.000Z', customerName: 'Acme',
      customerCommitmentDate: '2026-09-24T12:00:00.000Z', status: 'RELEASED',
    })
    const plan = await store.productionPlans.create(scope, {
      planNumber: 'PP-P2', materialSku: 'MAT-42', requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z', internalStockQuantity: 200, productionOrderIds: [order.id],
    })
    await store.supplyCases.create(scope, {
      id: 'case-p2', correlationId: 'SC-P2', status: 'RECEIVED', sku: 'MAT-42', requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z', supplier1Email: 'supplier1@example.com',
      supplier2Email: 'supplier2@example.com', productionPlanId: plan.id, productionOrderIds: [order.id],
      supplier1Proposal: { deliveries: [
        { quantity: 300, deliveryDate: '2026-09-23T12:00:00.000Z' },
        { quantity: 200, deliveryDate: '2026-09-25T12:00:00.000Z' },
      ] },
    })
    const loaded = await loadInitialImpactSnapshot(store, scope, 'case-p2')
    if (!loaded.ok) throw new Error('fixture did not load')
    const impact = calculateInitialImpact(loaded.snapshot)
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    await store.supplyCases.update(scope, 'case-p2', {
      status: 'AWAITING_SOURCING_DECISION', initialOptions: options,
      initialFactsHash: options[0].factsHash, initialProposalId: 'proposal-p2',
    })
  })

  afterEach(async () => fs.rm(dataDir, { recursive: true, force: true }))

  it('SELECT C sends one logical RFQ, waits for delivery evidence, and replay sends nothing', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const ports = outboundPorts(sends)
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    const input = decisionInput(current.updatedAt, current.initialFactsHash as string, 'CHECK_ALTERNATIVE_SUPPLIER')
    const first = await applySourcingDecision.execute(input, commandContext(ports))
    expect(first).toMatchObject({ status: 'pending_delivery', selectedOptionId: 'CHECK_ALTERNATIVE_SUPPLIER' })
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({ to: 'supplier2@example.com' })
    expect(sends[0].body).toContain('200')
    expect((await store.supplyCases.requireById(scope, 'case-p2')).status).toBe('SENDING_ALTERNATIVE_REQUEST')

    const replay = await applySourcingDecision.execute(input, commandContext(ports))
    expect(replay.status).toBe('already_applied')
    expect(sends).toHaveLength(1)

    await deliveredHandler(
      { channelLinkId: 'link-p2', ...scope },
      resolver(ports, { channelMetadata: { messageId: 'rfq-p2@example.com' } }),
    )
    expect((await store.supplyCases.requireById(scope, 'case-p2')).status).toBe('WAITING_FOR_ALTERNATIVE_OFFER')
  })

  it.each(['ACCEPT_PRIMARY_DELAY', 'USE_INTERNAL_STOCK'] as const)('TEST-006A: SELECT %s creates only a pending plan and never contacts Supplier 2', async (optionId) => {
    const sends: SupplierOutboundTransportInput[] = []
    const ports = outboundPorts(sends)
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    const result = await applySourcingDecision.execute(
      decisionInput(current.updatedAt, current.initialFactsHash as string, optionId),
      commandContext(ports),
    )
    expect(result).toMatchObject({ status: 'selected', selectedOptionId: optionId })
    expect(sends).toHaveLength(0)
    const updated = await store.supplyCases.requireById(scope, 'case-p2')
    expect(updated.pendingResolutionPlan).toMatchObject({ optionId })
    expect(updated.productionPlanId).toBe(current.productionPlanId)
  })

  it('TEST-006B: REJECT closes the case without outbound or production-plan mutation', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    const result = await applySourcingDecision.execute({
      ...decisionInput(current.updatedAt, current.initialFactsHash as string, 'CHECK_ALTERNATIVE_SUPPLIER'),
      kind: 'REJECT',
      selectedOptionId: null,
      reason: 'Customer cancelled the order',
      idempotencyKey: 'decision-reject',
    }, commandContext(outboundPorts(sends)))

    expect(result).toEqual({ status: 'rejected', caseId: 'case-p2', selectedOptionId: null, outboundCorrelationId: null })
    expect(sends).toHaveLength(0)
    const rejected = await store.supplyCases.requireById(scope, 'case-p2')
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      selectedInitialOptionId: null,
      initialDecisionKind: 'REJECT',
      initialDecisionReason: 'Customer cancelled the order',
      pendingResolutionPlan: null,
      productionPlanId: current.productionPlanId,
    })

    const replay = await applySourcingDecision.execute({
      ...decisionInput(rejected.updatedAt, current.initialFactsHash as string, 'CHECK_ALTERNATIVE_SUPPLIER'),
      kind: 'REJECT',
      selectedOptionId: null,
      reason: 'Customer cancelled the order',
      idempotencyKey: 'decision-reject',
    }, commandContext(outboundPorts(sends)))
    expect(replay.status).toBe('already_applied')
    expect(sends).toHaveLength(0)
  })

  it('TEST-006B: EDIT records the operator reason, keeps the decision open, and sends nothing', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    const result = await applySourcingDecision.execute({
      ...decisionInput(current.updatedAt, current.initialFactsHash as string, 'USE_INTERNAL_STOCK'),
      kind: 'EDIT',
      reason: 'Need procurement lead-time confirmation before choosing an option',
      idempotencyKey: 'decision-edit',
    }, commandContext(outboundPorts(sends)))

    expect(result).toEqual({ status: 'edited', caseId: 'case-p2', selectedOptionId: null, outboundCorrelationId: null })
    expect(sends).toHaveLength(0)
    const edited = await store.supplyCases.requireById(scope, 'case-p2')
    expect(edited).toMatchObject({
      status: 'AWAITING_SOURCING_DECISION',
      selectedInitialOptionId: null,
      initialDecisionKind: 'EDIT',
      initialDecisionReason: 'Need procurement lead-time confirmation before choosing an option',
      pendingResolutionPlan: null,
      productionPlanId: current.productionPlanId,
      initialAnalysis: {
        operatorEdit: {
          selectedOptionId: 'USE_INTERNAL_STOCK',
          reason: 'Need procurement lead-time confirmation before choosing an option',
        },
      },
    })
  })

  it('allows exactly one of two concurrent decisions to claim the expected version', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const ports = outboundPorts(sends)
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    const factsHash = current.initialFactsHash as string
    const outcomes = await Promise.allSettled([
      applySourcingDecision.execute(decisionInput(current.updatedAt, factsHash, 'USE_INTERNAL_STOCK'), commandContext(ports)),
      applySourcingDecision.execute(decisionInput(current.updatedAt, factsHash, 'CHECK_ALTERNATIVE_SUPPLIER'), commandContext(ports)),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    expect(rejected?.reason).toMatchObject({ status: 409, body: { error: 'stale_supply_case' } })
    const settled = await store.supplyCases.requireById(scope, 'case-p2')
    expect(['USE_INTERNAL_STOCK', 'CHECK_ALTERNATIVE_SUPPLIER']).toContain(settled.selectedInitialOptionId)
    expect(sends.length).toBeLessThanOrEqual(1)
  })

  it('TEST-006C: exhausted delivery and offer timeout fail closed', async () => {
    const ports = outboundPorts([])
    const current = await store.supplyCases.requireById(scope, 'case-p2')
    await applySourcingDecision.execute(
      decisionInput(current.updatedAt, current.initialFactsHash as string, 'CHECK_ALTERNATIVE_SUPPLIER'),
      commandContext(ports),
    )
    await exhaustedHandler(
      { messageId: 'message-p2', ...scope },
      resolver(ports, { channelMetadata: { messageId: 'rfq-p2@example.com' } }),
    )
    expect(await store.supplyCases.requireById(scope, 'case-p2')).toMatchObject({
      status: 'NEEDS_ATTENTION', needsAttentionReason: 'DELIVERY_FAILED',
    })

    await store.supplyCases.update(scope, 'case-p2', {
      status: 'WAITING_FOR_ALTERNATIVE_OFFER', needsAttentionReason: null, workflowInstanceId: 'workflow-p2',
    })
    await timeoutHandler(
      { id: 'workflow-p2', workflowId: 'supply_cases.inbound-case', stepId: 'await-reply', ...scope },
      resolver(ports),
    )
    expect(await store.supplyCases.requireById(scope, 'case-p2')).toMatchObject({
      status: 'NEEDS_ATTENTION', needsAttentionReason: 'WAIT_TIMEOUT',
    })
  })

  function outboundPorts(sends: SupplierOutboundTransportInput[]): SupplierOutboundPorts {
    return {
      outboundCorrelations: store.outboundCorrelations,
      loadOutboundChannel: async () => ({
        id: 'channel-p2', providerKey: 'imap', userId: 'mail-owner', isActive: true,
        status: 'connected', externalIdentifier: 'manufacturer@example.com',
      }),
      newRfcMessageId: () => 'rfq-p2@example.com',
      send: async (input) => { sends.push(input); return { ok: true, messageId: 'message-p2', threadId: 'thread-p2' } },
    }
  }

  function commandContext(ports: SupplierOutboundPorts): CommandRuntimeContext {
    return {
      container: resolver(ports) as unknown as CommandRuntimeContext['container'], auth: null,
      organizationScope: null, selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId], systemActor: true,
    }
  }

  function resolver(ports: SupplierOutboundPorts, link: Record<string, unknown> | null = null) {
    return {
      resolve<T = unknown>(name: string): T {
        if (name === 'supplyCasesStore') return store as T
        if (name === 'supplyCaseOutboundPortsFactory') return (() => ports) as T
        if (name === 'em') return { fork: () => ({ findOne: async () => link }) } as T
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    }
  }
})

function decisionInput(expectedUpdatedAt: string, factsHash: string, selectedOptionId: 'ACCEPT_PRIMARY_DELAY' | 'USE_INTERNAL_STOCK' | 'CHECK_ALTERNATIVE_SUPPLIER') {
  return {
    caseId: 'case-p2', proposalId: 'proposal-p2', factsHash, expectedUpdatedAt,
    kind: 'SELECT', selectedOptionId, reason: null, idempotencyKey: `decision-${selectedOptionId}`,
    scope: { tenantId: 'tenant-phase2', organizationId: 'org-phase2' },
  }
}
