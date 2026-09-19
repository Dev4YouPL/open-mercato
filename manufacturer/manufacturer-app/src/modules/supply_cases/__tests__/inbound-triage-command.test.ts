import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import applyTriageCommand, { APPLY_TRIAGE_COMMAND_ID } from '../commands/inbound-triage'
import { INBOUND_TRIAGE_AGENT_ID } from '../lib/triage/agentId'
import { NEW_SUPPLY_PROPOSAL, TRIAGE_FIXTURE_SENDERS } from '../data/triage-fixtures'

/**
 * The command envelope: scope derivation, the agent the runtime is asked for,
 * and what a caller is able to influence — which is only the message id.
 */

const scope: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

type RuntimeCall = { agentId: string; input: unknown }

function createContext(params: {
  store: SupplyCasesStore
  runtimeCalls?: RuntimeCall[]
  runtimeResult?: unknown
  withRuntime?: boolean
  tenantId?: string | null
}): CommandRuntimeContext {
  const container = {
    resolve(key: string) {
      if (key === 'supplyCasesStore') return params.store
      if (key === 'agentRuntime' && params.withRuntime !== false) {
        return {
          async run(agentId: string, input: unknown) {
            params.runtimeCalls?.push({ agentId, input })
            return { kind: 'research', data: params.runtimeResult }
          },
        }
      }
      throw new Error(`[internal] ${key} is not registered`)
    },
  } as unknown as AwilixContainer

  const tenantId = params.tenantId === undefined ? scope.tenantId : params.tenantId
  return {
    container,
    auth: tenantId ? ({ tenantId, orgId: scope.organizationId, sub: 'user-1' } as never) : null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as CommandRuntimeContext
}

describe(APPLY_TRIAGE_COMMAND_ID, () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-command-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
    await store.productionPlans.create(scope, {
      planNumber: 'PP-1',
      materialSku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
    })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  async function seedMessage(overrides: Partial<Parameters<SupplyCasesStore['inboundMessages']['append']>[1]> = {}) {
    return store.inboundMessages.append(scope, {
      rfcMessageId: '<proposal-1@supplier.example>',
      senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      sanitizedBody: NEW_SUPPLY_PROPOSAL.sanitizedBody,
      ...overrides,
    })
  }

  it('is registered under the stable command id', () => {
    expect(applyTriageCommand.id).toBe('supply_cases.inbound.apply_triage')
    expect(applyTriageCommand.isUndoable).toBe(false)
  })

  it('runs the triage agent and reports the linked case', async () => {
    const message = await seedMessage()
    const runtimeCalls: RuntimeCall[] = []
    const ctx = createContext({ store, runtimeCalls, runtimeResult: NEW_SUPPLY_PROPOSAL.rawResult })

    const result = await applyTriageCommand.execute({ inboundMessageId: message.id }, ctx)

    expect(runtimeCalls).toHaveLength(1)
    expect(runtimeCalls[0].agentId).toBe(INBOUND_TRIAGE_AGENT_ID)
    expect(JSON.stringify(runtimeCalls[0].input)).not.toContain(message.id)
    expect(result.outcome).toBe('AUTO_APPLY')
    expect(result.disposition).toBe('AUTO_APPLIED')
    expect(result.correlationId).toBe('SC-001')
  })

  it('reports a newly created needs-attention shell as caseCreated', async () => {
    const message = await seedMessage({ rfcMessageId: '<missing-date@supplier.example>' })
    const ctx = createContext({
      store,
      runtimeResult: {
        ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>),
        commitments: [],
        unresolved: ['commitments[0].date'],
        correlation: { kind: 'NEW_CASE', candidateIndex: null },
      },
    })

    const result = await applyTriageCommand.execute({ inboundMessageId: message.id }, ctx)
    const cases = await store.supplyCases.list(scope)

    expect(result.outcome).toBe('NEEDS_ATTENTION')
    expect(result.reason).toBe('UNRESOLVED_FIELDS')
    expect(result.caseCreated).toBe(true)
    expect(result.caseId).toBe(cases[0]?.id)
    expect(cases[0]).toMatchObject({ status: 'NEEDS_ATTENTION', needsAttentionReason: 'MISSING_DATA' })
  })

  it('recovers a failed proposal announcement exactly once without rerunning the agent', async () => {
    const message = await seedMessage({ rfcMessageId: '<announcement-recovery@supplier.example>' })
    const emitted: string[] = []
    let failProposalOnce = true
    setGlobalEventBus({
      emit: async (eventId: string) => {
        if (eventId === 'supply_cases.case.proposal_received' && failProposalOnce) {
          failProposalOnce = false
          throw new Error('[internal] injected proposal event failure')
        }
        emitted.push(eventId)
      },
    })

    try {
      const firstCalls: RuntimeCall[] = []
      await expect(applyTriageCommand.execute(
        { inboundMessageId: message.id },
        createContext({ store, runtimeCalls: firstCalls, runtimeResult: NEW_SUPPLY_PROPOSAL.rawResult }),
      )).rejects.toThrow('injected proposal event failure')
      expect(firstCalls).toHaveLength(1)

      const secondCalls: RuntimeCall[] = []
      const retry = await applyTriageCommand.execute(
        { inboundMessageId: message.id },
        createContext({
          store,
          runtimeCalls: secondCalls,
          runtimeResult: { ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>), sku: 'MAT-99' },
        }),
      )

      expect(retry.status).toBe('already_settled')
      expect(retry.outcome).toBe('AUTO_APPLY')
      expect(secondCalls).toHaveLength(0)
      expect(emitted.filter((eventId) => eventId === 'supply_cases.case.proposal_received')).toHaveLength(1)
      expect((await store.inboundMessages.findById(scope, message.id))?.proposalAnnouncementState).toBe('EMITTED')

      const replay = await applyTriageCommand.execute(
        { inboundMessageId: message.id },
        createContext({ store, runtimeResult: { ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>), sku: 'MAT-88' } }),
      )
      expect(replay.outcome).toBeNull()
      expect(emitted.filter((eventId) => eventId === 'supply_cases.case.proposal_received')).toHaveLength(1)
    } finally {
      setGlobalEventBus({ emit: async () => undefined })
    }
  })

  it('accepts nothing but a message id', async () => {
    const message = await seedMessage()
    const ctx = createContext({ store, runtimeResult: NEW_SUPPLY_PROPOSAL.rawResult })

    await expect(
      applyTriageCommand.execute({ inboundMessageId: message.id, caseId: 'case-sc-999' }, ctx),
    ).rejects.toThrow()
  })

  it('fails closed without a tenant rather than widening the lookup', async () => {
    const message = await seedMessage()
    const ctx = createContext({ store, tenantId: null })

    await expect(applyTriageCommand.execute({ inboundMessageId: message.id }, ctx)).rejects.toThrow(
      /Tenant context is required/,
    )
  })

  it('quarantines instead of guessing when the runtime is not available', async () => {
    const message = await seedMessage()
    const ctx = createContext({ store, withRuntime: false })

    const result = await applyTriageCommand.execute({ inboundMessageId: message.id }, ctx)

    expect(result.outcome).toBe('QUARANTINE')
    expect(result.reason).toBe('AGENT_UNAVAILABLE')
    expect(result.caseId).toBeNull()
    expect(await store.supplyCases.list(scope)).toHaveLength(0)
  })

  it('rejects a runtime result that is not the extraction contract', async () => {
    const message = await seedMessage()
    const ctx = createContext({ store, runtimeResult: { options: [], rationale: 'wrong envelope' } })

    const result = await applyTriageCommand.execute({ inboundMessageId: message.id }, ctx)

    expect(result.outcome).toBe('QUARANTINE')
    expect(result.reason).toBe('SCHEMA_INVALID')
  })
})
