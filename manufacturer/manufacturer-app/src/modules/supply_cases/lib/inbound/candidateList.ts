import { emailsMatch } from '../email/normalizeEmail'
import type { SupplyCase, SupplyCaseStatus } from '../../data/types'
import type { ThreadEvidence, ThreadMatch } from './resolveThread'

/**
 * Builds the closed set of cases the triage agent is allowed to choose from.
 *
 * This is the correlation guarantee, and it is enforced here rather than in the
 * agent's prompt: the agent answers with a position in this list or `NEW_CASE`,
 * and nothing else is expressible. A message body naming a case its sender has
 * no part in cannot route anywhere, because that case was never offered.
 *
 * Two rules decide membership, and thread evidence overrides neither:
 *   - the case is open in THIS tenant + organization, and
 *   - the authenticated envelope sender is one of its recorded participants.
 */

const TERMINAL_STATUSES: ReadonlySet<SupplyCaseStatus> = new Set(['RESOLVED', 'REJECTED', 'CANCELLED'])

export type CandidateParticipantRole = 'SUPPLIER_1' | 'SUPPLIER_2'

export type InboundCandidate = {
  /**
   * Dense position in this list, `0..n-1`. The agent-facing projection exposes
   * it as `candidateIndex`; it stays `index` here because this record still
   * carries `caseId`, which the agent is never shown.
   */
  index: number
  caseId: string
  correlationId: string
  status: SupplyCaseStatus
  sku: string
  requiredQuantity: number
  requiredDate: string
  participantRole: CandidateParticipantRole
  /** The reply chain resolved to a message we sent on this case. Evidence, not a verdict. */
  threadMatch: boolean
  /** The matched message has since been replaced; this reply answers a superseded request. */
  threadMatchSuperseded: boolean
}

export type CandidateList = {
  candidates: InboundCandidate[]
  /**
   * Thread evidence pointing at a case the sender may not reach. Recorded for
   * audit precisely because it is NOT allowed to widen the list: a reply from
   * an address that is not a participant must not pull that case into view.
   */
  unreachableThreadMatches: ThreadMatch[]
}

export type BuildCandidateListInput = {
  cases: readonly SupplyCase[]
  senderEmail: string
  threadEvidence: ThreadEvidence
}

export function buildCandidateList(input: BuildCandidateListInput): CandidateList {
  const matchesByCaseId = new Map<string, ThreadMatch>()
  for (const match of input.threadEvidence.matches) {
    // Strongest evidence first in `matches`, so the first entry for a case wins.
    if (!matchesByCaseId.has(match.caseId)) matchesByCaseId.set(match.caseId, match)
  }

  const eligible: Array<{ supplyCase: SupplyCase; role: CandidateParticipantRole; match: ThreadMatch | null }> = []
  const reachableCaseIds = new Set<string>()

  for (const supplyCase of input.cases) {
    if (!isOpen(supplyCase)) continue
    const role = resolveParticipantRole(supplyCase, input.senderEmail)
    if (!role) continue

    reachableCaseIds.add(supplyCase.id)
    eligible.push({ supplyCase, role, match: matchesByCaseId.get(supplyCase.id) ?? null })
  }

  eligible.sort(compareCandidates)

  return {
    candidates: eligible.map(({ supplyCase, role, match }, position) => ({
      index: position,
      caseId: supplyCase.id,
      correlationId: supplyCase.correlationId,
      status: supplyCase.status,
      sku: supplyCase.sku,
      requiredQuantity: supplyCase.requiredQuantity,
      requiredDate: supplyCase.requiredDate,
      participantRole: role,
      threadMatch: match !== null,
      threadMatchSuperseded: match?.superseded ?? false,
    })),
    unreachableThreadMatches: input.threadEvidence.matches.filter((match) => !reachableCaseIds.has(match.caseId)),
  }
}

/**
 * A terminal case is not a correlation target: reopening one would let a late
 * reply mutate a case whose outcome is already recorded. Restarting requires a
 * new case, which is what `NEW_CASE` is for.
 */
function isOpen(supplyCase: SupplyCase): boolean {
  return supplyCase.deletedAt === null && !TERMINAL_STATUSES.has(supplyCase.status)
}

function resolveParticipantRole(supplyCase: SupplyCase, senderEmail: string): CandidateParticipantRole | null {
  if (emailsMatch(supplyCase.supplier1Email, senderEmail)) return 'SUPPLIER_1'
  if (emailsMatch(supplyCase.supplier2Email, senderEmail)) return 'SUPPLIER_2'
  return null
}

/**
 * The ordering has to be total and stable, because the agent's answer is an
 * index into it: the same inputs must produce the same list on a retry, or a
 * replayed run would resolve `candidateIndex: 0` to a different case.
 *
 * Thread-matched cases lead because they are the likeliest target, and a
 * superseded match ranks below a current one — but both stay in the list, since
 * a supplier replying on an old thread about a new problem is an expected case
 * the agent is allowed to reject in favour of `NEW_CASE`.
 */
function compareCandidates(
  left: { supplyCase: SupplyCase; match: ThreadMatch | null },
  right: { supplyCase: SupplyCase; match: ThreadMatch | null },
): number {
  const byEvidence = threadRank(left.match) - threadRank(right.match)
  if (byEvidence !== 0) return byEvidence

  // Newest first: a supplier is far likelier to be writing about the case we
  // opened this week than one from last month.
  if (left.supplyCase.createdAt !== right.supplyCase.createdAt) {
    return right.supplyCase.createdAt.localeCompare(left.supplyCase.createdAt)
  }
  return left.supplyCase.id.localeCompare(right.supplyCase.id)
}

function threadRank(match: ThreadMatch | null): number {
  if (!match) return 2
  return match.superseded ? 1 : 0
}
