import type { SupplyCaseStatus } from '../../data/types'
import type { CandidateParticipantRole, InboundCandidate } from '../inbound/candidateList'

/**
 * The projection of the candidate list the agent actually receives.
 *
 * `buildCandidateList` decides WHICH cases may be chosen — open, in scope, and
 * the authenticated sender is a participant. This step decides what the agent
 * gets to SEE of them, and the answer excludes `caseId`: an identifier the
 * model never receives is an identifier it cannot echo back. Correlation is a
 * position in this list or `NEW_CASE`, and nothing else is expressible.
 */

export type TriageCandidateView = {
  candidateIndex: number
  correlationId: string
  status: SupplyCaseStatus
  sku: string
  requiredQuantity: number
  requiredDate: string
  participantRole: CandidateParticipantRole
  /** The reply chain resolved to a message we sent on this case. Evidence, not a verdict. */
  threadMatch: boolean
  /** That matched message has since been replaced, so this reply answers a superseded request. */
  threadMatchSuperseded: boolean
}

export type InboundTriageAgentInput = {
  /** The author's new text only — quoted history has already been removed. */
  sanitizedBody: string
  /** The authenticated envelope sender, never an address found in the body. */
  senderEmail: string
  candidates: readonly TriageCandidateView[]
}

export function toCandidateView(candidate: InboundCandidate): TriageCandidateView {
  return {
    candidateIndex: candidate.index,
    correlationId: candidate.correlationId,
    status: candidate.status,
    sku: candidate.sku,
    requiredQuantity: candidate.requiredQuantity,
    requiredDate: candidate.requiredDate,
    participantRole: candidate.participantRole,
    threadMatch: candidate.threadMatch,
    threadMatchSuperseded: candidate.threadMatchSuperseded,
  }
}

export function buildInboundTriageInput(params: {
  sanitizedBody: string
  senderEmail: string
  candidates: readonly InboundCandidate[]
}): InboundTriageAgentInput {
  assertDenseIndexes(params.candidates)
  return {
    sanitizedBody: params.sanitizedBody,
    senderEmail: params.senderEmail,
    candidates: params.candidates.map(toCandidateView),
  }
}

/**
 * The per-run schema bounds `candidateIndex` by the LIST LENGTH, so the two
 * only agree while the indexes are exactly `0..n-1`. `buildCandidateList`
 * guarantees that; a list assembled some other way might not, and a sparse one
 * would let a bounded index resolve to the wrong case. Failing loudly here
 * keeps that coupling visible instead of silent.
 */
function assertDenseIndexes(candidates: readonly InboundCandidate[]): void {
  const misplaced = candidates.findIndex((candidate, position) => candidate.index !== position)
  if (misplaced !== -1) {
    throw new Error(
      `[internal] candidate at position ${misplaced} declares index ${candidates[misplaced].index}; the triage contract requires 0..n-1`,
    )
  }
}
