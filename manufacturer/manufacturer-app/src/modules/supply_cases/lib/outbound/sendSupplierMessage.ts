/**
 * The one way this module puts a message in front of a supplier.
 *
 * Everything correlation depends on is decided here, and nothing about what the
 * message SAYS is: the body and subject are the caller's, because the phases
 * that compose them (the RFQ in Phase 2, the acceptances in Phase 3) own their
 * own wording and their own bar for sending at all.
 *
 * Three decisions are worth stating, because each one is load-bearing:
 *
 * 1. **The anchor is written BEFORE the send.** A reply can only be attributed
 *    to a case and a phase through a `Message-ID` we recorded, so recording it
 *    after delivery leaves a window where the supplier has our request and their
 *    answer can never be matched to it. The other ordering's failure — an anchor
 *    for a message that never left — is inert: it matches no inbound reply and
 *    the next attempt under the same key finds it.
 *
 * 2. **We mint the `Message-ID` ourselves.** The platform lets a caller supply
 *    one (`channelMetadata.messageId` survives the hub's outbound path; only
 *    reply-targeting keys are stripped), which is what makes decision 1
 *    possible at all. Reading the id back off the send result would put us back
 *    in the window.
 *
 * 3. **A replay does not send again.** The anchor's existence means "an attempt
 *    was made under this key". We cannot tell a delivered attempt from one that
 *    died before SMTP without transport state this record deliberately does not
 *    carry, and mailing a real supplier the same request twice is worse than a
 *    request that visibly never went. A caller that KNOWS it must go again —
 *    the manual retry path — passes `resend`, and that resend reuses the stored
 *    `Message-ID` so the recipient sees one message identity, not two.
 */
import { randomUUID } from 'node:crypto'
import type { StoreScope } from '../../data/repositories'
import type { OutboundCorrelationRepository } from '../../data/repositories'
import type { OutboundPhase } from '../../data/types'
import { normalizeEmailOrNull } from '../email/normalizeEmail'
import { buildOutboundIdempotencyKey } from './correlationKey'

/**
 * The `communication_channels` row, narrowed to what the decision needs. Read by
 * registry name rather than imported, so no cross-module ORM relationship is
 * created — the same approach the inbound transport gate takes.
 */
export type OutboundChannelRecord = {
  id: string
  providerKey: string
  userId: string | null
  isActive: boolean
  status: string
  externalIdentifier: string | null
}

export type SupplierOutboundTransportInput = {
  scope: StoreScope
  channelId: string
  actorUserId: string
  to: string
  subject: string
  body: string
  /** Bracketed RFC 5322 form, as the header carries it. */
  rfcMessageId: string
  inReplyTo?: string | null
  references?: readonly string[]
}

export type SupplierOutboundTransportResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; error: string }

export type SupplierOutboundPorts = {
  loadOutboundChannel(scope: StoreScope): Promise<OutboundChannelRecord | null>
  outboundCorrelations: OutboundCorrelationRepository
  send(input: SupplierOutboundTransportInput): Promise<SupplierOutboundTransportResult>
  /** Seam so a test can pin the id; production mints a v4 uuid under our own domain. */
  newRfcMessageId?: (domain: string) => string
}

export type SendSupplierMessageInput = {
  caseId: string
  phase: OutboundPhase
  recipientEmail: string
  subject: string
  body: string
  /** Bracket-stripped id of the message this answers, when it answers one. */
  inReplyTo?: string | null
  references?: readonly string[]
}

export type SendSupplierMessageOptions = {
  /**
   * Force a second delivery under an existing anchor, reusing its `Message-ID`.
   * Reserved for an explicit human retry; no automatic path sets it.
   */
  resend?: boolean
  /** Provider keys this deployment will send through. Defaults to the inbound set. */
  allowedProviderKeys?: ReadonlySet<string>
}

export type SendSupplierMessageBlockReason =
  | 'INVALID_RECIPIENT'
  | 'NO_CHANNEL'
  | 'PROVIDER_NOT_ALLOWED'
  | 'CHANNEL_NOT_CONNECTED'
  | 'CHANNEL_HAS_NO_OWNER'
  | 'CHANNEL_HAS_NO_ADDRESS'

/**
 * `accepted` means the hub took ownership of the delivery, NOT that SMTP ran:
 * the send is asynchronous from here (queue -> worker -> adapter). Delivery
 * evidence is the platform's own `communication_channels.message.sent`, and a
 * caller that treats `accepted` as delivered would advance a case past a
 * request that may still fail.
 */
export type SendSupplierMessageResult =
  | {
      status: 'accepted'
      correlationId: string
      rfcMessageId: string
      messageId: string
      threadId: string
    }
  | { status: 'already_requested'; correlationId: string; rfcMessageId: string }
  | { status: 'blocked'; reason: SendSupplierMessageBlockReason }
  | { status: 'failed'; correlationId: string; rfcMessageId: string; error: string }

export async function sendSupplierMessage(
  ports: SupplierOutboundPorts,
  scope: StoreScope,
  input: SendSupplierMessageInput,
  options: SendSupplierMessageOptions = {},
): Promise<SendSupplierMessageResult> {
  const recipient = normalizeEmailOrNull(input.recipientEmail)
  // An address we cannot normalize cannot be keyed, so it cannot be made
  // idempotent. Refusing is the only outcome that keeps the guarantee.
  if (!recipient) return { status: 'blocked', reason: 'INVALID_RECIPIENT' }

  const channel = await ports.loadOutboundChannel(scope)
  const channelBlock = inspectChannel(channel, options.allowedProviderKeys)
  if (channelBlock) return { status: 'blocked', reason: channelBlock }
  // `inspectChannel` returning null is exactly the proof these are present.
  const usableChannel = channel as OutboundChannelRecord & { userId: string }

  const domain = mailboxDomain(usableChannel.externalIdentifier)
  if (!domain) return { status: 'blocked', reason: 'CHANNEL_HAS_NO_ADDRESS' }

  const idempotencyKey = buildOutboundIdempotencyKey(input.caseId, input.phase, recipient)
  const mintId = ports.newRfcMessageId ?? defaultRfcMessageId
  const claim = await ports.outboundCorrelations.recordIfAbsent(scope, {
    caseId: input.caseId,
    phase: input.phase,
    recipientEmail: recipient,
    rfcMessageId: mintId(domain),
    idempotencyKey,
  })

  // `created: false` is a redelivery of the same intent — a retried subscriber,
  // a replayed workflow step, a second operator click. The anchor we just failed
  // to write is the one the first attempt wrote, and its id is the one that
  // matters from here on.
  if (!claim.created && !options.resend) {
    return {
      status: 'already_requested',
      correlationId: claim.correlation.id,
      rfcMessageId: claim.correlation.rfcMessageId,
    }
  }

  const rfcMessageId = claim.correlation.rfcMessageId
  const sent = await ports.send({
    scope,
    channelId: usableChannel.id,
    actorUserId: usableChannel.userId,
    to: recipient,
    subject: input.subject,
    body: input.body,
    rfcMessageId: bracket(rfcMessageId),
    inReplyTo: input.inReplyTo ?? null,
    references: input.references,
  })

  if (!sent.ok) {
    return { status: 'failed', correlationId: claim.correlation.id, rfcMessageId, error: sent.error }
  }

  return {
    status: 'accepted',
    correlationId: claim.correlation.id,
    rfcMessageId,
    messageId: sent.messageId,
    threadId: sent.threadId,
  }
}

/**
 * Fail-closed channel inspection, in the order a reader would ask the questions.
 * A channel that cannot deliver is not a transport error to be retried — it is a
 * deployment that has not been connected, and it is reported as such.
 */
function inspectChannel(
  channel: OutboundChannelRecord | null,
  allowedProviderKeys: ReadonlySet<string> | undefined,
): SendSupplierMessageBlockReason | null {
  if (!channel) return 'NO_CHANNEL'
  if (allowedProviderKeys && !allowedProviderKeys.has(channel.providerKey.toLowerCase())) {
    return 'PROVIDER_NOT_ALLOWED'
  }
  if (!channel.isActive || channel.status !== 'connected') return 'CHANNEL_NOT_CONNECTED'
  // The platform only lets a channel's OWNER send through it, so a mailbox with
  // no owner has no one to send as. Inventing an actor here would be inventing
  // an authorization.
  if (!channel.userId) return 'CHANNEL_HAS_NO_OWNER'
  return null
}

/**
 * Stored bracket-stripped, to match what the platform persists for inbound and
 * outbound ids alike and what `resolveThread` compares against. The brackets are
 * a header serialization detail and are re-applied at the transport boundary.
 */
function defaultRfcMessageId(domain: string): string {
  return `sc-${randomUUID()}@${domain}`
}

function bracket(rfcMessageId: string): string {
  return rfcMessageId.startsWith('<') ? rfcMessageId : `<${rfcMessageId}>`
}

function mailboxDomain(externalIdentifier: string | null): string | null {
  const address = normalizeEmailOrNull(externalIdentifier ?? '')
  if (!address) return null
  const domain = address.slice(address.lastIndexOf('@') + 1)
  return domain.length > 0 ? domain : null
}
