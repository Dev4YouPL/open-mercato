import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import applyTriageCommand from '../commands/inbound-triage'
import { RecordNotFoundError } from '../data/errors'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { InboundTriageInvoker } from '../lib/triage/runInboundTriage'

/**
 * The command is reachable two ways — an authenticated request and a trusted
 * server-side invocation — and the whole point of `scope` is that only the
 * second may state it. These tests pin that boundary, because a regression here
 * is a cross-tenant read rather than a broken feature.
 */

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 19, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

/** Classifies everything as unrelated: these tests are about scope, not triage. */
const unrelatedInvoker: InboundTriageInvoker = async () => ({
  intent: 'UNRELATED',
  correlation: { kind: 'NEW_CASE' },
  sku: null,
  commitments: [],
  price: null,
  confidence: 0.2,
  unresolved: [],
  rationale: 'Marketing newsletter.',
})

function createContainer(store: SupplyCasesStore): AwilixContainer {
  const values: Record<string, unknown> = {
    supplyCasesStore: store,
    inboundTriageInvokerFactory: () => unrelatedInvoker,
  }
  return {
    resolve<T = unknown>(name: string): T {
      if (!(name in values)) throw new Error(`[internal] ${name} is not registered`)
      return values[name] as T
    },
  } as unknown as AwilixContainer
}

type ContextOverrides = {
  systemActor?: boolean
  tenantId?: string | null
  organizationId?: string | null
}

function createContext(store: SupplyCasesStore, overrides: ContextOverrides = {}): CommandRuntimeContext {
  const tenantId = overrides.tenantId === undefined ? scopeA.tenantId : overrides.tenantId
  const organizationId = overrides.organizationId === undefined ? scopeA.organizationId : overrides.organizationId
  return {
    container: createContainer(store),
    auth: overrides.systemActor
      ? null
      : ({ sub: 'user-1', tenantId, orgId: organizationId } as CommandRuntimeContext['auth']),
    organizationScope: null,
    selectedOrganizationId: overrides.systemActor ? organizationId : organizationId,
    organizationIds: organizationId ? [organizationId] : null,
    ...(overrides.systemActor ? { systemActor: true } : {}),
  } as CommandRuntimeContext
}

describe('supply_cases.inbound.apply_triage — scope resolution', () => {
  let dataDir: string
  let store: SupplyCasesStore
  let messageId: string

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-cmd-scope-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
    const message = await store.inboundMessages.append(scopeA, {
      rfcMessageId: 'scope-1@supplier.example',
      senderEmail: 'supplier@hackon-om-wro.cloud',
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      sanitizedBody: 'Dzien dobry, zalaczam newsletter.',
    })
    messageId = message.id
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('honours the stated scope for a trusted system invocation', async () => {
    const result = await applyTriageCommand.execute(
      { inboundMessageId: messageId, scope: scopeA },
      createContext(store, { systemActor: true }),
    )

    expect(result.inboundMessageId).toBe(messageId)
    expect(result.status).toBe('applied')
  })

  it('reads only the stated scope, never a wider one', async () => {
    // The message exists, but not in the scope the caller stated. A fallback to
    // "look everywhere" would find it — this must not.
    await expect(
      applyTriageCommand.execute(
        { inboundMessageId: messageId, scope: scopeB },
        createContext(store, { systemActor: true }),
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError)
  })

  it('refuses a system invocation that states no scope', async () => {
    await expect(
      applyTriageCommand.execute({ inboundMessageId: messageId }, createContext(store, { systemActor: true })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a request that tries to supply its own scope', async () => {
    // Rejected rather than ignored: a caller that believes it selected a tenant
    // and silently got another one is worse than an error.
    await expect(
      applyTriageCommand.execute({ inboundMessageId: messageId, scope: scopeB }, createContext(store)),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('derives a request scope from the authenticated context', async () => {
    const result = await applyTriageCommand.execute({ inboundMessageId: messageId }, createContext(store))

    expect(result.status).toBe('applied')
  })

  it('fails closed when an authenticated context carries no tenant', async () => {
    await expect(
      applyTriageCommand.execute({ inboundMessageId: messageId }, createContext(store, { tenantId: null })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('fails closed when an authenticated context carries no organization', async () => {
    await expect(
      applyTriageCommand.execute({ inboundMessageId: messageId }, createContext(store, { organizationId: null })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an unknown input key instead of ignoring it', async () => {
    await expect(
      applyTriageCommand.execute(
        { inboundMessageId: messageId, caseId: 'case-1' },
        createContext(store, { systemActor: true }),
      ),
    ).rejects.toThrow()
  })
})
