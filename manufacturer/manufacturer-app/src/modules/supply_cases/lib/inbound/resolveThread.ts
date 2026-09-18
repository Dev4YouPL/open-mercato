import { normalizeEmailOrNull } from '../email/normalizeEmail'
import type { OutboundCorrelation, OutboundPhase } from '../../data/types'

/**
 * Resolves an inbound reply's RFC 5322 threading headers against the
 * `Message-ID`s this module actually sent.
 *
 * This is the only correlation signal that cannot be forged by the message
 * author: `In-Reply-To` names a message we issued, addressed to a mailbox we
 * chose. It is still evidence rather than a verdict — suppliers routinely reply
 * to whatever thread is nearest to hand — so the result is handed to the agent
 * as a flag it may argue with, never as a routing decision already taken.
 */

export type ThreadEvidenceSource = 'IN_REPLY_TO' | 'REFERENCES'

export type ThreadMatch = {
  caseId: string
  phase: OutboundPhase
  recipientEmail: string
  rfcMessageId: string
  source: ThreadEvidenceSource
  /**
   * True when a newer request exists for the same case, phase and recipient.
   * The reply answers a question we have since re-asked, so it must not resume
   * the current wait — a stale Supplier 2 offer resuming a newer RFQ is exactly
   * the failure this flag exists to prevent.
   */
  superseded: boolean
}

export type ThreadEvidence = {
  /** Every anchor the reply chain resolved to, strongest evidence first. */
  matches: ThreadMatch[]
  /** Reply-chain ids that match nothing we sent. Recorded, never acted on. */
  unmatchedReferences: string[]
}

export type ResolveThreadInput = {
  inReplyTo: string | null
  references: readonly string[]
  correlations: readonly OutboundCorrelation[]
}

export const EMPTY_THREAD_EVIDENCE: ThreadEvidence = { matches: [], unmatchedReferences: [] }

export function resolveThreadEvidence(input: ResolveThreadInput): ThreadEvidence {
  const byMessageId = new Map<string, OutboundCorrelation>()
  for (const correlation of input.correlations) {
    byMessageId.set(correlation.rfcMessageId, correlation)
  }

  const currentByLane = buildCurrentByLane(input.correlations)

  const matches: ThreadMatch[] = []
  const unmatchedReferences: string[] = []
  const seenMessageIds = new Set<string>()

  // `In-Reply-To` first and deduplicated against `References`: it names the one
  // message being answered, while `References` is the whole ancestry and would
  // otherwise re-report the same anchor as weaker evidence.
  for (const candidate of buildLookupOrder(input)) {
    if (seenMessageIds.has(candidate.rfcMessageId)) continue
    seenMessageIds.add(candidate.rfcMessageId)

    const correlation = byMessageId.get(candidate.rfcMessageId)
    if (!correlation) {
      unmatchedReferences.push(candidate.rfcMessageId)
      continue
    }

    matches.push({
      caseId: correlation.caseId,
      phase: correlation.phase,
      recipientEmail: correlation.recipientEmail,
      rfcMessageId: correlation.rfcMessageId,
      source: candidate.source,
      superseded: currentByLane.get(laneKey(correlation)) !== correlation.rfcMessageId,
    })
  }

  return { matches, unmatchedReferences }
}

/**
 * The strongest, still-current match, if the reply chain produced one. This is
 * what a resumption check asks for: a superseded anchor deliberately does not
 * qualify, so a late answer to a replaced request cannot resume the wait its
 * replacement is holding.
 */
export function selectResumableMatch(evidence: ThreadEvidence): ThreadMatch | null {
  return evidence.matches.find((match) => !match.superseded) ?? null
}

type LookupCandidate = { rfcMessageId: string; source: ThreadEvidenceSource }

function buildLookupOrder(input: ResolveThreadInput): LookupCandidate[] {
  const order: LookupCandidate[] = []
  if (input.inReplyTo) order.push({ rfcMessageId: input.inReplyTo, source: 'IN_REPLY_TO' })
  // Newest ancestor first: `References` is ordered oldest to newest, and the
  // most recent one is the closest to what this reply is about.
  for (let index = input.references.length - 1; index >= 0; index -= 1) {
    order.push({ rfcMessageId: input.references[index], source: 'REFERENCES' })
  }
  return order
}

/**
 * One "lane" is a case + recipient: the running conversation with one supplier
 * about one case. Whichever message we sent into that lane last states where
 * the case currently stands, so a reply arriving against an earlier one is
 * answering a position we have already moved on from.
 *
 * The lane is deliberately wider than the idempotency key (case + phase +
 * recipient). That key guarantees we never send the same phase twice, which
 * means a per-phase lane could never hold two anchors and supersession would be
 * unreachable by construction. Across phases it is reachable and real: once we
 * have sent Supplier 2 an acceptance, a late offer still replying to the
 * original RFQ is stale and must not resume the confirmation wait.
 */
function buildCurrentByLane(correlations: readonly OutboundCorrelation[]): Map<string, string> {
  const newest = new Map<string, OutboundCorrelation>()
  for (const correlation of correlations) {
    const key = laneKey(correlation)
    const incumbent = newest.get(key)
    if (!incumbent || isNewer(correlation, incumbent)) newest.set(key, correlation)
  }
  return new Map(Array.from(newest, ([key, correlation]) => [key, correlation.rfcMessageId]))
}

function laneKey(correlation: OutboundCorrelation): string {
  return `${correlation.caseId}:${normalizeEmailOrNull(correlation.recipientEmail) ?? correlation.recipientEmail.toLowerCase()}`
}

/** Id breaks a timestamp tie so the answer never depends on iteration order. */
function isNewer(candidate: OutboundCorrelation, incumbent: OutboundCorrelation): boolean {
  if (candidate.createdAt === incumbent.createdAt) return candidate.id.localeCompare(incumbent.id) > 0
  return candidate.createdAt > incumbent.createdAt
}
