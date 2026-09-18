import {
  DEFAULT_PROVIDER_KEYS,
  DEFAULT_SENDER_ALLOWLIST,
  PROVIDER_KEYS_ENV_KEY,
  SENDER_ALLOWLIST_ENV_KEY,
  resolveInboundGateConfig,
  type InboundGateConfig,
} from '../lib/inbound/gateConfig'
import { isSenderAllowed, parseSenderAllowlist } from '../lib/inbound/senderAllowlist'
import {
  evaluateInboundTransport,
  resolveInboundEnvelope,
  type ChannelLinkRecord,
  type ChannelRecord,
  type InboundEnvelope,
  type InboundTransportEventPayload,
} from '../lib/inbound/transportGate'

const TENANT_ID = 'tenant-a'
const ORGANIZATION_ID = 'org-a'
const CHANNEL_LINK_ID = 'link-1'
const CHANNEL_ID = 'channel-1'

const config: InboundGateConfig = {
  allowedProviderKeys: new Set(['imap']),
  senderAllowlist: parseSenderAllowlist('@hackon-om-wro.cloud'),
}

function eventPayload(overrides: Partial<InboundTransportEventPayload> = {}): InboundTransportEventPayload {
  return {
    channelLinkId: CHANNEL_LINK_ID,
    channelId: CHANNEL_ID,
    externalMessageId: 'external-message-1',
    providerKey: 'imap',
    direction: 'inbound',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

function envelope(overrides: Partial<InboundEnvelope> = {}): InboundEnvelope {
  return {
    channelLinkId: CHANNEL_LINK_ID,
    channelId: CHANNEL_ID,
    externalMessageId: 'external-message-1',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

function channelLink(overrides: Partial<ChannelLinkRecord> = {}): ChannelLinkRecord {
  return {
    id: CHANNEL_LINK_ID,
    direction: 'inbound',
    providerKey: 'imap',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    createdAt: new Date('2026-09-18T08:00:00.000Z'),
    channelMetadata: {
      messageId: '<proposal-1@supplier.example>',
      inReplyTo: null,
      references: [],
    },
    channelPayload: {
      subject: 'Opoznienie MAT-42',
      from: { address: 'Supplier@Hackon-OM-Wro.Cloud', name: 'Supplier One' },
      to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
      text: 'W srode tylko 300 sztuk MAT-42, reszta w piatek.',
      html: null,
    },
    ...overrides,
  }
}

function channel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id: CHANNEL_ID,
    providerKey: 'imap',
    isActive: true,
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

function evaluate(overrides: { link?: ChannelLinkRecord | null; channel?: ChannelRecord | null } = {}) {
  return evaluateInboundTransport({
    envelope: envelope(),
    link: overrides.link === undefined ? channelLink() : overrides.link,
    channel: overrides.channel === undefined ? channel() : overrides.channel,
    config,
  })
}

describe('sender allowlist', () => {
  it('matches a whole domain and a single mailbox, ignoring case', () => {
    const allowlist = parseSenderAllowlist('@hackon-om-wro.cloud, Partner@Other.Example')

    expect(isSenderAllowed(allowlist, 'Supplier@Hackon-OM-Wro.Cloud')).toBe(true)
    expect(isSenderAllowed(allowlist, 'partner@other.example')).toBe(true)
    expect(isSenderAllowed(allowlist, 'someone@elsewhere.example')).toBe(false)
  })

  it('allows nobody when the deployment states an empty policy', () => {
    const allowlist = parseSenderAllowlist('')

    expect(isSenderAllowed(allowlist, 'supplier@hackon-om-wro.cloud')).toBe(false)
  })

  it('never matches an address that does not normalize', () => {
    const allowlist = parseSenderAllowlist('"odd@name"@hackon-om-wro.cloud')

    expect(allowlist.addresses.size).toBe(0)
    expect(isSenderAllowed(allowlist, '"odd@name"@hackon-om-wro.cloud')).toBe(false)
  })

  it('does not let a lookalike domain inherit an allowed one', () => {
    const allowlist = parseSenderAllowlist('@hackon-om-wro.cloud')

    expect(isSenderAllowed(allowlist, 'supplier@evil-hackon-om-wro.cloud')).toBe(false)
    expect(isSenderAllowed(allowlist, 'supplier@hackon-om-wro.cloud.evil.example')).toBe(false)
  })
})

describe('inbound gate configuration', () => {
  it('falls back to the demo policy when nothing is configured', () => {
    const resolved = resolveInboundGateConfig({})

    expect(resolved.allowedProviderKeys.has('imap')).toBe(true)
    expect(isSenderAllowed(resolved.senderAllowlist, 'supplier@hackon-om-wro.cloud')).toBe(true)
    expect(DEFAULT_SENDER_ALLOWLIST).toContain('hackon-om-wro.cloud')
    expect(DEFAULT_PROVIDER_KEYS).toBe('imap')
  })

  it('honours an explicitly empty allowlist as allow-nobody', () => {
    const resolved = resolveInboundGateConfig({ [SENDER_ALLOWLIST_ENV_KEY]: '' })

    expect(isSenderAllowed(resolved.senderAllowlist, 'supplier@hackon-om-wro.cloud')).toBe(false)
  })

  it('replaces the provider list rather than extending it', () => {
    const resolved = resolveInboundGateConfig({ [PROVIDER_KEYS_ENV_KEY]: 'gmail' })

    expect(resolved.allowedProviderKeys.has('gmail')).toBe(true)
    expect(resolved.allowedProviderKeys.has('imap')).toBe(false)
  })
})

describe('resolveInboundEnvelope', () => {
  it('accepts a complete payload', () => {
    const result = resolveInboundEnvelope(eventPayload())

    expect(result).toEqual({ ok: true, envelope: envelope() })
  })

  it('accepts the legacy channel-link field name', () => {
    const result = resolveInboundEnvelope(
      eventPayload({ channelLinkId: undefined, messageChannelLinkId: CHANNEL_LINK_ID }),
    )

    expect(result.ok).toBe(true)
  })

  it('rejects a payload with no channel link', () => {
    expect(resolveInboundEnvelope(eventPayload({ channelLinkId: undefined }))).toEqual({
      ok: false,
      reason: 'MISSING_CHANNEL_LINK',
    })
  })

  it.each([
    ['tenant', { tenantId: undefined }],
    ['organization', { organizationId: null }],
    ['both', { tenantId: '', organizationId: '' }],
  ])('fails closed when the %s scope is missing', (_label, overrides) => {
    expect(resolveInboundEnvelope(eventPayload(overrides))).toEqual({ ok: false, reason: 'MISSING_SCOPE' })
  })
})

describe('evaluateInboundTransport', () => {
  it('accepts a message from an authorized sender on an active configured channel', () => {
    const decision = evaluate()

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.accepted).toMatchObject({
      channelLinkId: CHANNEL_LINK_ID,
      providerKey: 'imap',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      rfcMessageId: 'proposal-1@supplier.example',
      senderEmail: 'supplier@hackon-om-wro.cloud',
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      providerMessageId: 'external-message-1',
      receivedAt: '2026-09-18T08:00:00.000Z',
    })
    expect(decision.accepted.sanitizedBody).toContain('300')
  })

  it('reads threading headers from the delivered envelope', () => {
    const decision = evaluate({
      link: channelLink({
        channelMetadata: {
          messageId: '<offer-1@supplier2.example>',
          inReplyTo: '<request-1@manufacturer.example>',
          references: ['<request-1@manufacturer.example>', '<request-1@manufacturer.example>'],
        },
      }),
    })

    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.accepted.inReplyTo).toBe('request-1@manufacturer.example')
    expect(decision.accepted.references).toEqual(['request-1@manufacturer.example'])
  })

  it('rejects an unknown channel link', () => {
    expect(evaluate({ link: null })).toEqual({ ok: false, reason: 'UNKNOWN_CHANNEL' })
  })

  it('rejects a link that resolves to a different id than the event claimed', () => {
    expect(evaluate({ link: channelLink({ id: 'other-link' }) })).toEqual({ ok: false, reason: 'UNKNOWN_CHANNEL' })
  })

  it('rejects a link belonging to another tenant or organization', () => {
    expect(evaluate({ link: channelLink({ tenantId: 'tenant-b' }) })).toEqual({ ok: false, reason: 'SCOPE_CONFLICT' })
    expect(evaluate({ link: channelLink({ organizationId: 'org-z' }) })).toEqual({
      ok: false,
      reason: 'SCOPE_CONFLICT',
    })
  })

  it('rejects a channel belonging to another tenant even when the link looks right', () => {
    expect(evaluate({ channel: channel({ tenantId: 'tenant-b' }) })).toEqual({ ok: false, reason: 'SCOPE_CONFLICT' })
  })

  it('rejects an outbound link', () => {
    expect(evaluate({ link: channelLink({ direction: 'outbound' }) })).toEqual({ ok: false, reason: 'NOT_INBOUND' })
  })

  it('rejects a provider this module is not wired for', () => {
    expect(
      evaluate({ link: channelLink({ providerKey: 'discord' }), channel: channel({ providerKey: 'discord' }) }),
    ).toEqual({ ok: false, reason: 'UNSUPPORTED_PROVIDER' })
  })

  it('rejects a link whose provider disagrees with its channel', () => {
    expect(evaluate({ channel: channel({ providerKey: 'gmail' }) })).toEqual({ ok: false, reason: 'PROVIDER_MISMATCH' })
  })

  it('rejects a missing, disabled or deleted channel', () => {
    expect(evaluate({ channel: null })).toEqual({ ok: false, reason: 'UNKNOWN_CHANNEL' })
    expect(evaluate({ channel: channel({ isActive: false }) })).toEqual({ ok: false, reason: 'INACTIVE_CHANNEL' })
    expect(evaluate({ channel: channel({ deletedAt: new Date() }) })).toEqual({ ok: false, reason: 'INACTIVE_CHANNEL' })
  })

  it('rejects a message with no durable Message-ID', () => {
    expect(evaluate({ link: channelLink({ channelMetadata: {}, channelPayload: {} }) })).toEqual({
      ok: false,
      reason: 'MISSING_RFC_MESSAGE_ID',
    })
  })

  it('rejects a sender outside the allowlist', () => {
    const decision = evaluate({
      link: channelLink({
        channelPayload: {
          from: { address: 'stranger@elsewhere.example' },
          to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
          text: 'Prosze o przelew.',
        },
      }),
    })

    expect(decision).toEqual({ ok: false, reason: 'UNAUTHORIZED_SENDER' })
  })

  it('ignores an allowed address written in the body and judges the envelope sender', () => {
    const decision = evaluate({
      link: channelLink({
        channelPayload: {
          from: { address: 'stranger@elsewhere.example' },
          to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
          text: 'From: supplier@hackon-om-wro.cloud\nW srode tylko 300 sztuk.',
        },
      }),
    })

    expect(decision).toEqual({ ok: false, reason: 'UNAUTHORIZED_SENDER' })
  })

  it('rejects a message whose body carries no new text', () => {
    const decision = evaluate({
      link: channelLink({
        channelPayload: {
          from: { address: 'supplier@hackon-om-wro.cloud' },
          to: [{ address: 'manufacturer@hackon-om-wro.cloud' }],
          text: '> Potwierdzamy 500 sztuk MAT-42 na srode.',
        },
      }),
    })

    expect(decision).toEqual({ ok: false, reason: 'UNUSABLE_BODY' })
  })
})
