import { sanitizeBody, type SanitizeBodyFailureReason, type SanitizeBodyInput } from './sanitizeBody'
import { stripQuotedHistory } from './stripQuotedHistory'

/**
 * Bridges the two pure body steps into the pair the intake record stores: the
 * body exactly as delivered, and the reduced text the triage agent is allowed
 * to read.
 *
 * Keeping both is what makes an extraction auditable. The agent sees only the
 * author's new sentences, so it cannot extract the superseded quantities the
 * thread still quotes, while a reviewer opening the case still reads the
 * message the supplier actually sent.
 */

export type PrepareInboundBodyFailureReason = SanitizeBodyFailureReason | 'QUOTED_HISTORY_ONLY'

export type PreparedInboundBody = {
  ok: true
  /** The delivered body, verbatim, quoted history included. Never shown to the agent. */
  rawBody: string
  /** Only the text the sender wrote in THIS message. The agent's entire input. */
  sanitizedBody: string
  truncated: boolean
  strippedMarker: string | null
}

export type PrepareInboundBodyResult = PreparedInboundBody | { ok: false; reason: PrepareInboundBodyFailureReason }

export type PrepareInboundBodyOptions = {
  maxLength?: number
}

/**
 * A message that strips to nothing is a failure, not an empty success: it
 * carried no new statement, and the only text it holds is the history whose
 * numbers are already superseded. Falling back to that history is precisely the
 * silent-wrong-quantity failure the stripping exists to prevent, so the caller
 * quarantines instead.
 */
export function prepareInboundBody(
  input: SanitizeBodyInput,
  options: PrepareInboundBodyOptions = {},
): PrepareInboundBodyResult {
  const sanitized = sanitizeBody(input, options)
  if (!sanitized.ok) return { ok: false, reason: sanitized.reason }

  const stripped = stripQuotedHistory(sanitized.text)
  if (stripped.text.length === 0) return { ok: false, reason: 'QUOTED_HISTORY_ONLY' }

  return {
    ok: true,
    rawBody: resolveRawBody(input),
    sanitizedBody: stripped.text,
    truncated: sanitized.truncated,
    strippedMarker: stripped.matchedMarker,
  }
}

/**
 * The plain-text part is the audit copy when the provider delivered one, and
 * the HTML source otherwise. Storing the converted text instead would discard
 * the only evidence of what actually arrived.
 */
function resolveRawBody(input: SanitizeBodyInput): string {
  const text = input.text ?? ''
  if (text.trim().length > 0) return text
  return input.html ?? ''
}
