import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createJsonSupplyCasesStore } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { buildFixtureIds, buildScenarioFixtures, FIXTURE_PROPOSAL_BUSINESS_MESSAGE_ID } from '../data/fixtures'
import type { SupplierOutboundPorts, SupplierOutboundTransportInput } from '../lib/outbound/sendSupplierMessage'
import { readSupplyProposalSource } from '../lib/outbound/supplyRejection'
import rejectPrimaryProposal from '../commands/reject-proposal'

const scope: StoreScope = { tenantId: 'tenant-rejection', organizationId: 'org-rejection' }

describe('SUPPLY_REJECTION primary proposal command', () => {
  let dataDir: string
  let store: SupplyCasesStore
  let caseId: string

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-rejection-'))
    store = createJsonSupplyCasesStore({ dataDir })
    caseId = (await store.seedScenario(scope)).supplyCase.id
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('rejects the trusted proposal with one threaded machine envelope and replays idempotently', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, caseId)
    const context = commandContext(store, outboundPorts(store, sends))

    const result = await rejectPrimaryProposal.execute({
      caseId: current.id,
      expectedUpdatedAt: current.updatedAt,
      reason: 'Primary supplier cannot meet the requested delivery date.',
      scope,
    }, context)

    expect(result.status).toBe('rejected')
    expect(result.businessMessageId).toMatch(/^MSG-/)
    expect(result.businessMessageId).not.toBe(sends[0].rfcMessageId)
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({
      to: 'supplier@hackon-om-wro.cloud',
      inReplyTo: buildFixtureIds(scope).supplyProposalRfcMessageId,
      references: [buildFixtureIds(scope).supplyProposalRfcMessageId],
    })
    expect(sends[0].body.match(/---OPEN-MERCATO-SUPPLY-MESSAGE---/g)).toHaveLength(1)
    expect(sends[0].body.match(/---END-OPEN-MERCATO-SUPPLY-MESSAGE---/g)).toHaveLength(1)

    const correlations = await store.outboundCorrelations.list(scope)
    expect(correlations).toHaveLength(1)
    expect(correlations[0]).toMatchObject({
      phase: 'SUPPLY_REJECTION',
      businessMessageId: result.businessMessageId,
      rfcMessageId: 'rejection-1@manufacturer.example.com',
    })

    const replay = await rejectPrimaryProposal.execute({
      caseId: current.id,
      expectedUpdatedAt: current.updatedAt,
      reason: 'A different replay reason must not create a second message.',
      scope,
    }, context)
    expect(replay).toEqual({ ...result, status: 'already_rejected' })
    expect(sends).toHaveLength(1)
  })

  it('fails closed for a stale case version before sending', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, caseId)

    await expect(rejectPrimaryProposal.execute({
      caseId: current.id,
      expectedUpdatedAt: 'stale-version',
      reason: 'Reject the proposal.',
      scope,
    }, commandContext(store, outboundPorts(store, sends)))).rejects.toMatchObject({
      status: 409,
      body: { error: 'stale_supply_case' },
    })
    expect(sends).toHaveLength(0)
    expect(await store.outboundCorrelations.list(scope)).toHaveLength(0)
  })

  it('retries a failed transport with the original business and RFC identities', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, caseId)
    await expect(rejectPrimaryProposal.execute({
      caseId: current.id,
      expectedUpdatedAt: current.updatedAt,
      reason: 'Retryable transport failure.',
      scope,
    }, commandContext(store, outboundPorts(store, sends, true)))).rejects.toMatchObject({ status: 502 })

    const afterFailure = await store.supplyCases.requireById(scope, caseId)
    const retry = await rejectPrimaryProposal.execute({
      caseId: current.id,
      expectedUpdatedAt: afterFailure.updatedAt,
      reason: 'Retry after the channel became available.',
      resend: true,
      scope,
    }, commandContext(store, outboundPorts(store, sends, false)))

    expect(retry.status).toBe('rejected')
    expect(sends).toHaveLength(2)
    expect(sends[1].rfcMessageId).toBe(sends[0].rfcMessageId)
    expect((await store.outboundCorrelations.list(scope))[0].businessMessageId).toBe(retry.businessMessageId)
  })

  it('allows only one concurrent rejection to claim the case version', async () => {
    const sends: SupplierOutboundTransportInput[] = []
    const current = await store.supplyCases.requireById(scope, caseId)
    const ports = outboundPorts(store, sends, false)
    const outcomes = await Promise.allSettled([
      rejectPrimaryProposal.execute({ caseId: current.id, expectedUpdatedAt: current.updatedAt, reason: 'Concurrent rejection A.', scope }, commandContext(store, ports)),
      rejectPrimaryProposal.execute({ caseId: current.id, expectedUpdatedAt: current.updatedAt, reason: 'Concurrent rejection B.', scope }, commandContext(store, ports)),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')?.reason).toMatchObject({
      status: 409,
      body: { error: 'stale_supply_case' },
    })
    expect(sends).toHaveLength(1)
  })

  it('requires the persisted source envelope instead of trusting sanitized text', async () => {
    const fixture = buildScenarioFixtures(scope)
    const current = await store.supplyCases.requireById(scope, caseId)
    const message = (await store.inboundMessages.list(scope, { where: { caseId: current.id } }))[0]
    if (!message) throw new Error('[internal] fixture proposal message missing')
    expect(readSupplyProposalSource({ ...message, rawBody: null }, current)).toBeNull()
    expect(readSupplyProposalSource({ ...message, rfcMessageId: '   ' }, current)).toBeNull()
    expect(readSupplyProposalSource(message, current)).toMatchObject({
      proposal: { messageId: FIXTURE_PROPOSAL_BUSINESS_MESSAGE_ID },
      sourceRfcMessageId: buildFixtureIds(scope).supplyProposalRfcMessageId,
    })
  })
})

function outboundPorts(currentStore: SupplyCasesStore, sends: SupplierOutboundTransportInput[], failTransport = false): SupplierOutboundPorts {
  return {
    outboundCorrelations: currentStore.outboundCorrelations,
    loadOutboundChannel: async () => ({
      id: 'channel-rejection',
      providerKey: 'imap',
      userId: 'manufacturer-mailbox-owner',
      isActive: true,
      status: 'connected',
      externalIdentifier: 'manufacturer@hackon-om-wro.cloud',
    }),
    newRfcMessageId: () => 'rejection-1@manufacturer.example.com',
    send: async (input) => {
      sends.push(input)
      if (failTransport) return { ok: false, error: 'temporary transport failure' }
      return { ok: true, messageId: 'transport-rejection-1', threadId: 'thread-rejection-1' }
    },
  }
}

function commandContext(currentStore: SupplyCasesStore, ports: SupplierOutboundPorts): CommandRuntimeContext {
  return {
    container: {
      resolve<T = unknown>(name: string): T {
        if (name === 'supplyCasesStore') return currentStore as T
        if (name === 'supplyCaseOutboundPortsFactory') return (() => ports) as T
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    } as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}
