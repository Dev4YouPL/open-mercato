import { normalizeEmailOrNull } from '../email/normalizeEmail'
import type { InboundGateConfig } from './gateConfig'
import { prepareInboundBody } from './prepareInboundBody'
import { isSenderAllowed } from './senderAllowlist'

/**
 * Stage 1 of the inbound path: a deterministic decision, no LLM and no writes.
 *
 * `communication_channels.message.received` is technical evidence that a
 * message was observed, not proof that it belongs to this business flow. Every
 * security-relevant answer — is this our channel, is it still active, whose
 * tenant is it, who actually sent it — is settled here, before any agent sees a
 * single character of the body.
 *
 * The module is pure on purpose: the subscriber loads the platform records and
 * hands them in, so the policy can be tested without a database and cannot
 * quietly widen its own input.
 */

export type InboundGateRejectionReason =
  | 'MISSING_CHANNEL_LINK'
  | 'MISSING_SCOPE'
  | 'SCOPE_CONFLICT'
  | 'UNKNOWN_CHANNEL'
  | 'INACTIVE_CHANNEL'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_MISMATCH'
  | 'NOT_INBOUND'
  | 'MISSING_RFC_MESSAGE_ID'
  | 'MISSING_SENDER'
  | 'UNAUTHORIZED_SENDER'
  | 'MISSING_RECIPIENT'
  | 'UNUSABLE_BODY'

/** The raw event payload; every field is `unknown` because none of it is trusted yet. */
export type InboundTransportEventPayload = {
  channelLinkId?: unknown
  messageChannelLinkId?: unknown
  channelId?: unknown
  externalMessageId?: unknown
  providerKey?: unknown
  direction?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

/** The `MessageChannelLink` row owned by `communication_channels`, read-only here. */
export type ChannelLinkRecord = {
  id: string
  direction?: unknown
  providerKey?: unknown
  tenantId?: unknown
  organizationId?: unknown
  channelPayload?: Record<string, unknown> | null
  channelMetadata?: Record<string, unknown> | null
  createdAt?: unknown
}

/** The `CommunicationChannel` row owned by `communication_channels`, read-only here. */
export type ChannelRecord = {
  id: string
  providerKey?: unknown
  isActive?: unknown
  deletedAt?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export type InboundEnvelope = {
  channelLinkId: string
  channelId: string | null
  externalMessageId: string | null
  tenantId: string
  organizationId: string
}

export type AcceptedInboundTransport = {
  channelLinkId: string
  providerKey: string
  tenantId: string
  organizationId: string
  rfcMessageId: string
  inReplyTo: string | null
  references: string[]
  senderEmail: string
  recipientEmail: string
  rawBody: string
  sanitizedBody: string
  providerMessageId: string | null
  receivedAt: string | null
}

export type InboundGateRejection = { ok: false; reason: InboundGateRejectionReason }
export type EnvelopeResolution = { ok: true; envelope: InboundEnvelope } | InboundGateRejection
export type InboundGateDecision = { ok: true; accepted: AcceptedInboundTransport } | InboundGateRejection

const reject = (reason: InboundGateRejectionReason): InboundGateRejection => ({ ok: false, reason })

/**
 * Resolves the identifiers needed to load the platform records, and nothing
 * else. Missing scope is a rejection rather than a tenant-wide lookup: an
 * unscoped read is exactly the cross-tenant disclosure this gate exists to
 * prevent.
 */
export function resolveInboundEnvelope(payload: InboundTransportEventPayload): EnvelopeResolution {
  const channelLinkId = asNonEmptyString(payload.channelLinkId) ?? asNonEmptyString(payload.messageChannelLinkId)
  if (!channelLinkId) return reject('MISSING_CHANNEL_LINK')

  const tenantId = asNonEmptyString(payload.tenantId)
  const organizationId = asNonEmptyString(payload.organizationId)
  if (!tenantId || !organizationId) return reject('MISSING_SCOPE')

  return {
    ok: true,
    envelope: {
      channelLinkId,
      channelId: asNonEmptyString(payload.channelId),
      externalMessageId: asNonEmptyString(payload.externalMessageId),
      tenantId,
      organizationId,
    },
  }
}

export type EvaluateInboundTransportInput = {
  envelope: InboundEnvelope
  link: ChannelLinkRecord | null
  channel: ChannelRecord | null
  config: InboundGateConfig
}

/**
 * The full gate. Order matters: channel identity and scope are settled before
 * the message is even looked at, and the sender is read from the delivered
 * envelope headers rather than from anything the author could type.
 */
export function evaluateInboundTransport(input: EvaluateInboundTransportInput): InboundGateDecision {
  const { envelope, link, channel, config } = input

  if (!link || link.id !== envelope.channelLinkId) return reject('UNKNOWN_CHANNEL')
  if (!scopeMatches(link, envelope)) return reject('SCOPE_CONFLICT')
  if (link.direction !== 'inbound') return reject('NOT_INBOUND')

  const providerKey = asNonEmptyString(link.providerKey)?.toLowerCase()
  if (!providerKey) return reject('UNKNOWN_CHANNEL')
  if (!config.allowedProviderKeys.has(providerKey)) return reject('UNSUPPORTED_PROVIDER')

  // A link without a resolvable channel cannot be shown to be active, and an
  // unverifiable channel is treated as unknown rather than trusted.
  if (!channel || (envelope.channelId !== null && channel.id !== envelope.channelId)) return reject('UNKNOWN_CHANNEL')
  if (!scopeMatches(channel, envelope)) return reject('SCOPE_CONFLICT')
  if (asNonEmptyString(channel.providerKey)?.toLowerCase() !== providerKey) return reject('PROVIDER_MISMATCH')
  if (channel.isActive !== true || channel.deletedAt != null) return reject('INACTIVE_CHANNEL')

  const metadata = asRecord(link.channelMetadata)
  const channelPayload = asRecord(link.channelPayload)

  const rfcMessageId = stripBrackets(
    asNonEmptyString(metadata.messageId) ?? asNonEmptyString(channelPayload.messageId),
  )
  if (!rfcMessageId) return reject('MISSING_RFC_MESSAGE_ID')

  // The delivered envelope decides the sender. Any address in the body is
  // informational and authorizes nothing.
  const senderEmail = normalizeEmailOrNull(readAddress(channelPayload.from))
  if (!senderEmail) return reject('MISSING_SENDER')
  if (!isSenderAllowed(config.senderAllowlist, senderEmail)) return reject('UNAUTHORIZED_SENDER')

  const recipientEmail = normalizeEmailOrNull(readAddress(channelPayload.to))
  if (!recipientEmail) return reject('MISSING_RECIPIENT')

  const body = prepareInboundBody(
    { text: asNullableString(channelPayload.text), html: asNullableString(channelPayload.html) },
    config.maxBodyLength === undefined ? {} : { maxLength: config.maxBodyLength },
  )
  if (!body.ok) return reject('UNUSABLE_BODY')

  return {
    ok: true,
    accepted: {
      channelLinkId: link.id,
      providerKey,
      tenantId: envelope.tenantId,
      organizationId: envelope.organizationId,
      rfcMessageId,
      inReplyTo: stripBrackets(asNonEmptyString(metadata.inReplyTo)),
      references: readReferences(metadata.references),
      senderEmail,
      recipientEmail,
      rawBody: body.rawBody,
      sanitizedBody: body.sanitizedBody,
      providerMessageId: envelope.externalMessageId,
      receivedAt: asIsoDate(link.createdAt),
    },
  }
}

function scopeMatches(record: { tenantId?: unknown; organizationId?: unknown }, envelope: InboundEnvelope): boolean {
  return record.tenantId === envelope.tenantId && record.organizationId === envelope.organizationId
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stripBrackets(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
  return unwrapped.length > 0 ? unwrapped : null
}

/**
 * The hub stores addresses as a string, an `{ address }` object, or a list of
 * either, depending on the provider. Only the first entry matters here: the
 * envelope sender is one mailbox, and the recipient we record is the mailbox
 * the message was addressed to.
 */
function readAddress(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const address = readAddress(entry)
      if (address) return address
    }
    return null
  }
  if (typeof value === 'string') return asNonEmptyString(value)
  if (value && typeof value === 'object') return asNonEmptyString((value as Record<string, unknown>).address)
  return null
}

function readReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const reference = stripBrackets(asNonEmptyString(entry))
    if (reference && !out.includes(reference)) out.push(reference)
  }
  return out
}

function asIsoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const raw = asNonEmptyString(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}
