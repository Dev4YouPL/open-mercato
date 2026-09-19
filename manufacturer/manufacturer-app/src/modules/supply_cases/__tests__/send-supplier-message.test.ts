import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { buildOutboundIdempotencyKey } from '../lib/outbound/correlationKey'
import {
  sendSupplierMessage,
  type OutboundChannelRecord,
  type SupplierOutboundPorts,
  type SupplierOutboundTransportInput,
  type SupplierOutboundTransportResult,
} from '../lib/outbound/sendSupplierMessage'

/**
 * TEST-005: the outbound correlation guarantee.
 *
 * The transport itself belongs to `communication_channels` and is faked here.
 * What these tests own is the part that decides whether a supplier is mailed at
 * all, under which identity, and what is durable at the moment the send is
 * attempted — none of which the platform can answer for us.
 */

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
const supplier = 'supplier2@hackon-om-wro.cloud'
const allowedProviderKeys = new Set(['imap'])

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 19, 0, 0, tick++)).toISOString(),
    newId: () => `outbound-${tick++}`,
  }
}

function createChannel(overrides: Partial<OutboundChannelRecord> = {}): OutboundChannelRecord {
  return {
    id: 'channel-1',
    providerKey: 'imap',
    userId: 'user-mailbox-owner',
    isActive: true,
    status: 'connected',
    externalIdentifier: 'manufacturer@hackon-om-wro.cloud',
    ...overrides,
  }
}

type Harness = {
  ports: SupplierOutboundPorts
  sends: SupplierOutboundTransportInput[]
  /** Anchors visible in the store at the moment each send was attempted. */
  anchorsAtSendTime: number[]
  store: SupplyCasesStore
}

function createHarness(
  store: SupplyCasesStore,
  options: {
    channel?: OutboundChannelRecord | null
    transport?: (input: SupplierOutboundTransportInput) => SupplierOutboundTransportResult
    idSequence?: string[]
  } = {},
): Harness {
  const sends: SupplierOutboundTransportInput[] = []
  const anchorsAtSendTime: number[] = []
  const ids = [...(options.idSequence ?? ['sc-fixed-1', 'sc-fixed-2'])]
  const channel = options.channel === undefined ? createChannel() : options.channel

  const ports: SupplierOutboundPorts = {
    outboundCorrelations: store.outboundCorrelations,
    loadOutboundChannel: async () => channel,
    newRfcMessageId: (domain: string) => `${ids.shift() ?? 'sc-exhausted'}@${domain}`,
    send: async (input) => {
      sends.push(input)
      // Read through the real store: this is how the test proves the anchor was
      // durable BEFORE the transport was reached, rather than trusting call order.
      anchorsAtSendTime.push((await store.outboundCorrelations.list(scopeA)).length)
      return options.transport ? options.transport(input) : { ok: true, messageId: 'msg-1', threadId: 'thread-1' }
    },
  }

  return { ports, sends, anchorsAtSendTime, store }
}

function baseInput() {
  return {
    caseId: 'case-1',
    phase: 'ALTERNATIVE_SUPPLY_REQUEST' as const,
    recipientEmail: supplier,
    subject: 'Zapytanie o dostawe zastepcza',
    body: 'Czy moga Panstwo dostarczyc 200 sztuk MAT-42 na 23.09.2026?',
  }
}

describe('TEST-005: sendSupplierMessage', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-outbound-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('TEST-005A: anchors the message identity before it reaches the transport', async () => {
    const harness = createHarness(store)

    const result = await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    expect(result).toMatchObject({ status: 'accepted', messageId: 'msg-1', threadId: 'thread-1' })
    // The anchor existed when the transport ran — not merely afterwards.
    expect(harness.anchorsAtSendTime).toEqual([1])

    const anchors = await store.outboundCorrelations.list(scopeA)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({
      caseId: 'case-1',
      phase: 'ALTERNATIVE_SUPPLY_REQUEST',
      recipientEmail: supplier,
      idempotencyKey: buildOutboundIdempotencyKey('case-1', 'ALTERNATIVE_SUPPLY_REQUEST', supplier),
    })
    // Stored bare, sent bracketed: the brackets are a header detail, and the
    // stored form is what an inbound `In-Reply-To` is compared against.
    expect(anchors[0].rfcMessageId).toBe('sc-fixed-1@hackon-om-wro.cloud')
    expect(harness.sends[0].rfcMessageId).toBe('<sc-fixed-1@hackon-om-wro.cloud>')
    expect(harness.sends[0].actorUserId).toBe('user-mailbox-owner')
    expect(harness.sends[0].to).toBe(supplier)
  })

  it('TEST-005B: a replay sends nothing and reports the original identity', async () => {
    const harness = createHarness(store)
    const first = await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    const replay = await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    expect(replay).toEqual({
      status: 'already_requested',
      correlationId: (first as { correlationId: string }).correlationId,
      rfcMessageId: 'sc-fixed-1@hackon-om-wro.cloud',
    })
    expect(harness.sends).toHaveLength(1)
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(1)
  })

  it('TEST-005C: a differently-cased recipient is the same mailbox, not a second one', async () => {
    const harness = createHarness(store)
    await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    const replay = await sendSupplierMessage(
      harness.ports,
      scopeA,
      { ...baseInput(), recipientEmail: 'Supplier2@Hackon-OM-Wro.Cloud' },
      { allowedProviderKeys },
    )

    expect(replay.status).toBe('already_requested')
    expect(harness.sends).toHaveLength(1)
  })

  it('TEST-005D: an explicit resend reuses the anchored Message-ID', async () => {
    const harness = createHarness(store)
    await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    const resent = await sendSupplierMessage(harness.ports, scopeA, baseInput(), {
      allowedProviderKeys,
      resend: true,
    })

    expect(resent.status).toBe('accepted')
    expect(harness.sends).toHaveLength(2)
    // One identity, two deliveries — so the recipient and any reply still resolve
    // to a single request.
    expect(harness.sends[1].rfcMessageId).toBe('<sc-fixed-1@hackon-om-wro.cloud>')
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(1)
  })

  it('TEST-005E: another phase or another case is a different message, not a replay', async () => {
    const harness = createHarness(store, { idSequence: ['sc-a', 'sc-b', 'sc-c'] })
    await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    await sendSupplierMessage(
      harness.ports,
      scopeA,
      { ...baseInput(), phase: 'SUPPLY_ACCEPTANCE' },
      { allowedProviderKeys },
    )
    await sendSupplierMessage(harness.ports, scopeA, { ...baseInput(), caseId: 'case-2' }, { allowedProviderKeys })

    expect(harness.sends).toHaveLength(3)
    expect(new Set(harness.sends.map((send) => send.rfcMessageId)).size).toBe(3)
  })

  it('TEST-005F: an anchor in one scope never settles another scope', async () => {
    const harness = createHarness(store, { idSequence: ['sc-a', 'sc-b'] })
    await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    const other = await sendSupplierMessage(harness.ports, scopeB, baseInput(), { allowedProviderKeys })

    expect(other.status).toBe('accepted')
    expect(harness.sends).toHaveLength(2)
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(1)
    expect(await store.outboundCorrelations.list(scopeB)).toHaveLength(1)
  })

  it('TEST-005G: a transport failure is reported and keeps the anchor', async () => {
    const harness = createHarness(store, {
      transport: () => ({ ok: false, error: '422: Channel is in status ...' }),
    })

    const result = await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    expect(result).toMatchObject({ status: 'failed', rfcMessageId: 'sc-fixed-1@hackon-om-wro.cloud' })
    // The anchor stays: it is the identity a retry must reuse, and it matches no
    // inbound reply while nothing was delivered.
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(1)
  })

  it.each([
    ['NO_CHANNEL', { channel: null }],
    ['CHANNEL_NOT_CONNECTED', { channel: createChannel({ status: 'requires_reauth' }) }],
    ['CHANNEL_NOT_CONNECTED', { channel: createChannel({ isActive: false }) }],
    ['CHANNEL_HAS_NO_OWNER', { channel: createChannel({ userId: null }) }],
    ['CHANNEL_HAS_NO_ADDRESS', { channel: createChannel({ externalIdentifier: null }) }],
    ['PROVIDER_NOT_ALLOWED', { channel: createChannel({ providerKey: 'discord' }) }],
  ] as const)('TEST-005H: refuses to send and writes no anchor — %s', async (reason, options) => {
    const harness = createHarness(store, options)

    const result = await sendSupplierMessage(harness.ports, scopeA, baseInput(), { allowedProviderKeys })

    expect(result).toEqual({ status: 'blocked', reason })
    expect(harness.sends).toHaveLength(0)
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(0)
  })

  it('TEST-005I: refuses a recipient that cannot be normalized, before any channel lookup', async () => {
    let channelLookups = 0
    const harness = createHarness(store)
    const ports: SupplierOutboundPorts = {
      ...harness.ports,
      loadOutboundChannel: async () => {
        channelLookups += 1
        return createChannel()
      },
    }

    const result = await sendSupplierMessage(
      ports,
      scopeA,
      { ...baseInput(), recipientEmail: '   ' },
      { allowedProviderKeys },
    )

    expect(result).toEqual({ status: 'blocked', reason: 'INVALID_RECIPIENT' })
    expect(channelLookups).toBe(0)
    expect(await store.outboundCorrelations.list(scopeA)).toHaveLength(0)
  })
})
