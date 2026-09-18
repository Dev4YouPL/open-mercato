import { normalizeEmailOrNull } from '../email/normalizeEmail'
import type { OutboundPhase } from '../../data/types'

/**
 * The durable idempotency key every outbound message is sent under: case +
 * phase + recipient, and nothing else.
 *
 * Deriving it rather than generating one per attempt is what makes a retry
 * safe. The retry computes the same key, finds the anchor the first attempt
 * recorded, and reuses its `Message-ID` — so the supplier is not mailed twice,
 * and the reply they eventually send still resolves to the request we think
 * they are answering.
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
