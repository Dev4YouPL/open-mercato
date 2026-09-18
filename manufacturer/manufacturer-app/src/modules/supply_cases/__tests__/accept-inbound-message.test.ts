import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import {
  acceptInboundMessage,
  type AcceptInboundMessagePorts,
  type InboundMessageAcceptedPayload,
  type InboundMessageAuditEntry,
} from '../lib/inbound/acceptInboundMessage'
import type { InboundGateConfig } from '../lib/inbound/gateConfig'
import { parseSenderAllowlist } from '../lib/inbound/senderAllowlist'
import type { ChannelLinkRecord, ChannelRecord, InboundTransportEventPayload } from '../lib/inbound/transportGate'

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
const CHANNEL_LINK_ID = 'link-1'
const CHANNEL_ID = 'channel-1'

const config: InboundGateConfig = {
  allowedProviderKeys: new Set(['imap']),
  senderAllowlist: parseSenderAllowlist('@hackon-om-wro.cloud'),
}

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

function eventPayload(overrides: Partial<InboundTransportEventPayload> = {}): InboundTransportEventPayload {
  return {
    channelLinkId: CHANNEL_LINK_ID,
    channelId: CHANNEL_ID,
    externalMessageId: 'external-message-1',
    providerKey: 'imap',
    direction: 'inbound',
    tenantId: scopeA.tenantId,
    organizationId: scopeA.organizationId,
    ...overrides,
  }
}

function channelLinkFor(scope: StoreScope, overrides: Partial<ChannelLinkRecord> = {}): ChannelLinkRecord {
  return {
    id: CHANNEL_LINK_ID,
    direction: 'inbound',
    providerKey: 'imap',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    createdAt: new Date('2026-09-18T08:00:00.000Z'),
    channelMetadata: { messageId: '<proposal-1@supplier.example>', inReplyTo: null, references: [] },
    channelPayload: {
      from: { address: 'supplier@hackon-om-wro.cloud' },
      to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
      text: 'W srode tylko 300 sztuk MAT-42.\n\n> Potwierdzamy 500 sztuk na srode.',
    },
    ...overrides,
  }
}

function channelFor(scope: StoreScope, overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id: CHANNEL_ID,
    providerKey: 'imap',
    isActive: true,
    deletedAt: null,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...overrides,
  }
}

type Harness = {
  ports: AcceptInboundMessagePorts
  emitted: InboundMessageAcceptedPayload[]
  audited: InboundMessageAuditEntry[]
}

/**
 * The platform lookups are the ports the real subscriber fills with scoped
 * `findOneWithDecryption` calls. Here they enforce the same rule the database
 * does: a record outside the requested scope is simply not there.
 */
function createHarness(
  store: SupplyCasesStore,
  records: { links: ChannelLinkRecord[]; channels: ChannelRecord[] },
): Harness {
  const emitted: InboundMessageAcceptedPayload[] = []
  const audited: InboundMessageAuditEntry[] = []

  const inScope = <T extends { tenantId?: unknown; organizationId?: unknown }>(record: T, scope: StoreScope) =>
    record.tenantId === scope.tenantId && record.organizationId === scope.organizationId

  return {
    emitted,
    audited,
    ports: {
      async loadChannelLink(scope, channelLinkId) {
        return records.links.find((link) => link.id === channelLinkId && inScope(link, scope)) ?? null
      },
      async loadChannel(scope, channelId) {
        return records.channels.find((entry) => entry.id === channelId && inScope(entry, scope)) ?? null
      },
      inboundMessages: store.inboundMessages,
      async emitAccepted(payload) {
        emitted.push(payload)
      },
      audit(entry) {
        audited.push(entry)
      },
    },
  }
}

describe('acceptInboundMessage', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-gate-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  function harnessForScopeA(): Harness {
    return createHarness(store, { links: [channelLinkFor(scopeA)], channels: [channelFor(scopeA)] })
  }

  it('persists the message and emits the accepted event once', async () => {
    const harness = harnessForScopeA()

    const outcome = await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(outcome.status).toBe('accepted')
    const stored = await store.inboundMessages.list(scopeA)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      rfcMessageId: 'proposal-1@supplier.example',
      senderEmail: 'supplier@hackon-om-wro.cloud',
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      caseId: null,
      correlationId: null,
      messageIntent: null,
      triageDisposition: null,
      providerMessageId: 'external-message-1',
      receivedAt: '2026-09-18T08:00:00.000Z',
    })

    expect(harness.emitted).toHaveLength(1)
    expect(harness.emitted[0]).toEqual({
      id: stored[0].id,
      inboundMessageId: stored[0].id,
      rfcMessageId: 'proposal-1@supplier.example',
      channelLinkId: CHANNEL_LINK_ID,
      providerKey: 'imap',
      senderEmail: 'supplier@hackon-om-wro.cloud',
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      receivedAt: '2026-09-18T08:00:00.000Z',
      tenantId: scopeA.tenantId,
      organizationId: scopeA.organizationId,
    })
  })

  it('keeps the quoted history out of the agent-visible body and off the event', async () => {
    const harness = harnessForScopeA()

    await acceptInboundMessage(eventPayload(), harness.ports, config)

    const [stored] = await store.inboundMessages.list(scopeA)
    expect(stored.rawBody).toContain('500')
    expect(stored.sanitizedBody).toBe('W srode tylko 300 sztuk MAT-42.')
    expect(JSON.stringify(harness.emitted[0])).not.toContain('300')
  })

  it('treats a replayed delivery as idempotent: one record, one event', async () => {
    const harness = harnessForScopeA()

    const first = await acceptInboundMessage(eventPayload(), harness.ports, config)
    const replay = await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(first.status).toBe('accepted')
    expect(replay.status).toBe('duplicate')
    if (first.status !== 'accepted' || replay.status !== 'duplicate') return
    expect(replay.message.id).toBe(first.message.id)
    await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    expect(harness.emitted).toHaveLength(1)
  })

  it('claims concurrent replays exactly once', async () => {
    const harness = harnessForScopeA()

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => acceptInboundMessage(eventPayload(), harness.ports, config)),
    )

    expect(outcomes.filter((outcome) => outcome.status === 'accepted')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'duplicate')).toHaveLength(4)
    await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    expect(harness.emitted).toHaveLength(1)
  })

  it('never emits the business proposal event from the transport gate', async () => {
    const harness = harnessForScopeA()

    await acceptInboundMessage(eventPayload(), harness.ports, config)

    const [stored] = await store.inboundMessages.list(scopeA)
    // Triage has not run, so nothing here may look like a classified proposal.
    expect(stored.messageIntent).toBeNull()
    expect(stored.extraction).toBeNull()
    expect(stored.caseId).toBeNull()
  })

  it('does not let one tenant claim another tenant channel link', async () => {
    const harness = createHarness(store, { links: [channelLinkFor(scopeB)], channels: [channelFor(scopeB)] })

    const outcome = await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(outcome).toEqual({ status: 'rejected', reason: 'UNKNOWN_CHANNEL' })
    await expect(store.inboundMessages.list(scopeA)).resolves.toEqual([])
    await expect(store.inboundMessages.list(scopeB)).resolves.toEqual([])
    expect(harness.emitted).toHaveLength(0)
  })

  it('records the same message separately for two tenants that both received it', async () => {
    const harnessA = harnessForScopeA()
    const harnessB = createHarness(store, { links: [channelLinkFor(scopeB)], channels: [channelFor(scopeB)] })

    await acceptInboundMessage(eventPayload(), harnessA.ports, config)
    await acceptInboundMessage(
      eventPayload({ tenantId: scopeB.tenantId, organizationId: scopeB.organizationId }),
      harnessB.ports,
      config,
    )

    await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    await expect(store.inboundMessages.list(scopeB)).resolves.toHaveLength(1)
  })

  it('fails closed and writes nothing when the event carries no scope', async () => {
    const harness = harnessForScopeA()

    const outcome = await acceptInboundMessage(eventPayload({ organizationId: null }), harness.ports, config)

    expect(outcome).toEqual({ status: 'rejected', reason: 'MISSING_SCOPE' })
    await expect(store.inboundMessages.list(scopeA)).resolves.toEqual([])
    expect(harness.emitted).toHaveLength(0)
    expect(harness.audited).toEqual([
      { outcome: 'rejected', reason: 'MISSING_SCOPE', channelLinkId: null, tenantId: null },
    ])
  })

  it('rejects an unauthorized sender without persisting or announcing anything', async () => {
    const harness = createHarness(store, {
      links: [
        channelLinkFor(scopeA, {
          channelPayload: {
            from: { address: 'stranger@elsewhere.example' },
            to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
            text: 'Prosze o zmiane numeru konta.',
          },
        }),
      ],
      channels: [channelFor(scopeA)],
    })

    const outcome = await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(outcome).toEqual({ status: 'rejected', reason: 'UNAUTHORIZED_SENDER' })
    await expect(store.inboundMessages.list(scopeA)).resolves.toEqual([])
    expect(harness.emitted).toHaveLength(0)
  })

  it('rejects a message arriving on a disabled channel', async () => {
    const harness = createHarness(store, {
      links: [channelLinkFor(scopeA)],
      channels: [channelFor(scopeA, { isActive: false })],
    })

    const outcome = await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(outcome).toEqual({ status: 'rejected', reason: 'INACTIVE_CHANNEL' })
    await expect(store.inboundMessages.list(scopeA)).resolves.toEqual([])
  })

  it('audits a rejection with scope and reason only', async () => {
    const harness = createHarness(store, {
      links: [channelLinkFor(scopeA, { direction: 'outbound' })],
      channels: [channelFor(scopeA)],
    })

    await acceptInboundMessage(eventPayload(), harness.ports, config)

    expect(harness.audited).toEqual([
      { outcome: 'rejected', reason: 'NOT_INBOUND', channelLinkId: CHANNEL_LINK_ID, tenantId: scopeA.tenantId },
    ])
    expect(JSON.stringify(harness.audited)).not.toContain('supplier@hackon-om-wro.cloud')
  })
})
