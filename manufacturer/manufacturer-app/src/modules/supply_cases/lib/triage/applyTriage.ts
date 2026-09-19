import type { InboundSignal } from '../../data/inbound-signal'
import type { InboundTriageFailureReason, InboundTriageResult } from './runInboundTriage'
import type { InboundCandidate } from '../inbound/candidateList'
import { DEFAULT_CONFIDENCE_THRESHOLD } from './triageConfig'

/**
 * What the module does with what the agent said — decided by code, every time.
 *
 * This is a pure function on purpose. It takes no repository, no event bus and
 * no clock, so no path through it can change a case; the caller applies the
 * decision it returns. That is what makes "the agent never mutates anything" a
 * property of the design rather than a promise about a prompt.
 *
 * A message is auto-applied only when all four hold: the agent cleared the
 * confidence bar, left nothing `unresolved`, chose inside the offered list, and
 * did not contradict the thread evidence. Anything else is a human's call —
 * ambiguity is never resolved by guessing.
 */

export type TriageAttentionReason =
  | 'LOW_CONFIDENCE'
  | 'UNRESOLVED_FIELDS'
  | 'THREAD_CONTRADICTION'
  | 'AGENT_UNAVAILABLE'
  /**
   * The agent answered `NEW_CASE` for a SKU no local production plan requires.
   * A supplier e-mail states what the supplier will do, never what we needed —
   * so there is nothing to open a case against, and no quantity or date to
   * invent one from.
   */
  | 'NO_LOCAL_DEMAND'

export type TriageQuarantineReason =
  | 'EMPTY_BODY'
  | 'SCHEMA_INVALID'
  | 'INVALID_CANDIDATE_INDEX'
  | 'UNRELATED'
  | 'AGENT_UNAVAILABLE'

export type TriageTarget =
  | { kind: 'EXISTING_CASE'; candidateIndex: number; caseId: string; correlationId: string }
  | { kind: 'NEW_CASE' }

export type TriageDecision =
  | { outcome: 'AUTO_APPLY'; disposition: 'AUTO_APPLIED'; target: TriageTarget; signal: InboundSignal }
  | {
      /** The message is recorded, the case is not touched, and a human picks from the SAME list. */
      outcome: 'NEEDS_ATTENTION'
      disposition: null
      reason: TriageAttentionReason
      signal: InboundSignal
      candidateIndexes: readonly number[]
    }
  | {
      /** The message never reaches a case at all. `needsAttention` is the operator-visible half. */
      outcome: 'QUARANTINE'
      disposition: 'QUARANTINED'
      reason: TriageQuarantineReason
      needsAttention: boolean
    }

export type DecideTriageParams = {
  result: InboundTriageResult
  candidates: readonly InboundCandidate[]
  confidenceThreshold?: number
}

export function decideTriage(params: DecideTriageParams): TriageDecision {
  const { result, candidates } = params
  const confidenceThreshold = params.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD

  if (!result.ok) return quarantineForFailure(result.reason)

  const { signal } = result

  const targetIndex = signal.correlation.kind === 'EXISTING_CASE' ? signal.correlation.candidateIndex : null
  if (targetIndex !== null && !isOfferedIndex(targetIndex, candidates.length)) {
    return { outcome: 'QUARANTINE', disposition: 'QUARANTINED', reason: 'INVALID_CANDIDATE_INDEX', needsAttention: true }
  }

  if (signal.intent === 'UNRELATED') {
    return { outcome: 'QUARANTINE', disposition: 'QUARANTINED', reason: 'UNRELATED', needsAttention: false }
  }

  const candidateIndexes = candidates.map((_candidate, index) => index)

  if (signal.unresolved.length > 0) {
    return needsAttention('UNRESOLVED_FIELDS', signal, candidateIndexes)
  }

  if (signal.confidence < confidenceThreshold) {
    return needsAttention('LOW_CONFIDENCE', signal, candidateIndexes)
  }

  const threadIndexes = candidates.flatMap((candidate, index) => (candidate.threadMatch ? [index] : []))
  if (threadIndexes.length > 0 && (targetIndex === null || !threadIndexes.includes(targetIndex))) {
    return needsAttention('THREAD_CONTRADICTION', signal, candidateIndexes)
  }

  return {
    outcome: 'AUTO_APPLY',
    disposition: 'AUTO_APPLIED',
    target: resolveTarget(signal, candidates),
    signal,
  }
}

/**
 * A run that never produced a valid signal cannot be reviewed as one, so it is
 * quarantined rather than routed. An empty body is the exception that needs no
 * operator: the message carried no new statement to review.
 */
function quarantineForFailure(reason: InboundTriageFailureReason): TriageDecision {
  return {
    outcome: 'QUARANTINE',
    disposition: 'QUARANTINED',
    reason,
    needsAttention: reason !== 'EMPTY_BODY',
  }
}

function needsAttention(
  reason: TriageAttentionReason,
  signal: InboundSignal,
  candidateIndexes: readonly number[],
): TriageDecision {
  return { outcome: 'NEEDS_ATTENTION', disposition: null, reason, signal, candidateIndexes }
}

/**
 * Defence in depth: the per-run schema already rejects an index outside the
 * offered list, and this check means a signal reaching the apply step from any
 * other path still cannot address a case that was never offered.
 */
function isOfferedIndex(index: number, candidateCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < candidateCount
}

function resolveTarget(signal: InboundSignal, candidates: readonly InboundCandidate[]): TriageTarget {
  if (signal.correlation.kind === 'NEW_CASE') return { kind: 'NEW_CASE' }
  const candidateIndex = signal.correlation.candidateIndex
  if (candidateIndex === null) throw new Error('[internal] Existing case target requires a candidate index')
  const candidate = candidates[candidateIndex]
  return {
    kind: 'EXISTING_CASE',
    candidateIndex,
    caseId: candidate.caseId,
    correlationId: candidate.correlationId,
  }
}
