import { normalizeEmailOrNull } from '../email/normalizeEmail'
import type { OutboundPhase } from '../../data/types'

/**
 * The durable idempotency key every outbound message is sent under: case +
 * phase + recipient, and nothing else.
 *
 * Deriving it rather than generating one per attempt is what makes a retry
 * safe. A second attempt computes the same key and finds the anchor the first
 * one recorded: `sendSupplierMessage` then sends nothing at all, because it
 * cannot tell a delivered attempt from one that died before SMTP. An explicit
 * human retry (`resend`) does deliver again, reusing that anchor's
 * `Message-ID` — so the supplier sees one message identity rather than two, and
 * the reply they eventually send still resolves to the request we think they
 * are answering.
 *
 * The recipient is normalized first: `Supplier2@Example.com` and
 * `supplier2@example.com` are one mailbox, and treating them as two keys would
 * send that mailbox the same request twice.
 */
export function buildOutboundIdempotencyKey(
  caseId: string,
  phase: OutboundPhase,
  recipientEmail: string,
): string {
  const recipient = normalizeEmailOrNull(recipientEmail)
  if (!recipient) {
    throw new Error('[internal] an outbound idempotency key needs a normalizable recipient address')
  }
  return `${caseId}:${phase}:${recipient}`
}
