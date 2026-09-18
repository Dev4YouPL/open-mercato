import type { InboundMessageRepository, StoreScope } from '../../data/repositories'
import type { InboundMessage } from '../../data/types'
import type { InboundGateConfig } from './gateConfig'
import {
  evaluateInboundTransport,
  resolveInboundEnvelope,
  type AcceptedInboundTransport,
  type ChannelLinkRecord,
  type ChannelRecord,
  type InboundEnvelope,
  type InboundGateRejectionReason,
  type InboundTransportEventPayload,
} from './transportGate'

/**
 * Runs the transport gate, claims the message, and announces it — in that
 * order, and only in that order.
 *
 * The ports are injected rather than resolved so the whole decision path is
 * exercisable without a database or an event bus, and so the rule that nothing
 * is emitted before the record exists is visible in one function.
 */

export type InboundMessageAuditEntry =
  | { outcome: 'rejected'; reason: InboundGateRejectionReason; channelLinkId: string | null; tenantId: string | null }
  | { outcome: 'duplicate'; rfcMessageId: string; inboundMessageId: string; tenantId: string }
  | { outcome: 'accepted'; rfcMessageId: string; inboundMessageId: string; tenantId: string }

export type AcceptInboundMessagePorts = {
  loadChannelLink(scope: StoreScope, channelLinkId: string): Promise<ChannelLinkRecord | null>
  loadChannel(scope: StoreScope, channelId: string): Promise<ChannelRecord | null>
  inboundMessages: InboundMessageRepository
  emitAccepted(payload: InboundMessageAcceptedPayload): Promise<void>
  audit(entry: InboundMessageAuditEntry): void
}

export type InboundMessageAcceptedPayload = {
  id: string
  inboundMessageId: string
  rfcMessageId: string
  channelLinkId: string
  providerKey: string
  senderEmail: string
  recipientEmail: string
  receivedAt: string | null
  tenantId: string
  organizationId: string
}

export type AcceptInboundMessageOutcome =
  | { status: 'accepted'; message: InboundMessage }
  | { status: 'duplicate'; message: InboundMessage }
  | { status: 'rejected'; reason: InboundGateRejectionReason }

export async function acceptInboundMessage(
  payload: InboundTransportEventPayload,
  ports: AcceptInboundMessagePorts,
  config: InboundGateConfig,
): Promise<AcceptInboundMessageOutcome> {
  const envelopeResult = resolveInboundEnvelope(payload)
  if (!envelopeResult.ok) {
    ports.audit({
      outcome: 'rejected',
      reason: envelopeResult.reason,
      channelLinkId: null,
      tenantId: null,
    })
    return { status: 'rejected', reason: envelopeResult.reason }
  }

  const envelope = envelopeResult.envelope
  const scope: StoreScope = { tenantId: envelope.tenantId, organizationId: envelope.organizationId }

  // Both reads are scoped. A record belonging to another tenant comes back as
  // missing, so the rejection reveals nothing about what exists elsewhere.
  const link = await ports.loadChannelLink(scope, envelope.channelLinkId)
  const channel = envelope.channelId ? await ports.loadChannel(scope, envelope.channelId) : null

  const decision = evaluateInboundTransport({ envelope, link, channel, config })
  if (!decision.ok) {
    ports.audit({
      outcome: 'rejected',
      reason: decision.reason,
      channelLinkId: envelope.channelLinkId,
      tenantId: envelope.tenantId,
    })
    return { status: 'rejected', reason: decision.reason }
  }

  const claim = await ports.inboundMessages.appendIfAbsent(scope, buildAppendInput(decision.accepted))

  if (!claim.created) {
    // Losing the dedupe race is the normal outcome of at-least-once delivery,
    // not an error: the winner already persisted the message and emitted the
    // event, so a second emit here would duplicate every downstream effect.
    ports.audit({
      outcome: 'duplicate',
      rfcMessageId: decision.accepted.rfcMessageId,
      inboundMessageId: claim.message.id,
      tenantId: envelope.tenantId,
    })
    return { status: 'duplicate', message: claim.message }
  }

  ports.audit({
    outcome: 'accepted',
    rfcMessageId: decision.accepted.rfcMessageId,
    inboundMessageId: claim.message.id,
    tenantId: envelope.tenantId,
  })

  // Post-commit: the record is durable before anything is told it exists, so a
  // subscriber can never read an id that was not written.
  await ports.emitAccepted(buildAcceptedPayload(claim.message, decision.accepted))

  return { status: 'accepted', message: claim.message }
}

/**
 * Everything triage-related stays null: this record is the neutral intake
 * fact, and the message is not yet known to concern a `SupplyCase` at all.
 */
function buildAppendInput(accepted: AcceptedInboundTransport) {
  return {
    rfcMessageId: accepted.rfcMessageId,
    inReplyTo: accepted.inReplyTo,
    references: accepted.references,
    senderEmail: accepted.senderEmail,
    recipientEmail: accepted.recipientEmail,
    rawBody: accepted.rawBody,
    sanitizedBody: accepted.sanitizedBody,
    providerMessageId: accepted.providerMessageId,
    receivedAt: accepted.receivedAt,
  }
}

function buildAcceptedPayload(
  message: InboundMessage,
  accepted: AcceptedInboundTransport,
): InboundMessageAcceptedPayload {
  return {
    id: message.id,
    inboundMessageId: message.id,
    rfcMessageId: message.rfcMessageId,
    channelLinkId: accepted.channelLinkId,
    providerKey: accepted.providerKey,
    senderEmail: message.senderEmail,
    recipientEmail: message.recipientEmail,
    receivedAt: message.receivedAt,
    tenantId: message.tenantId,
    organizationId: message.organizationId,
  }
}

export type { InboundEnvelope, InboundGateRejectionReason, InboundTransportEventPayload }
