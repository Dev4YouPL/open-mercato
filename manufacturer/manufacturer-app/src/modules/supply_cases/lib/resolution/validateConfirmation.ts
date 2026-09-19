import type { ExtractedCommitment } from '../../data/inbound-signal'
import type { ConfirmationPlanContract, ConfirmationRole, ConfirmationVerdict } from '../../data/types'

export type ConfirmationMismatchReason =
  | 'UNKNOWN_ROLE'
  | 'QUANTITY_OR_DATE_DIFFERS'
  | 'UNRESOLVED_FACTS'
  | 'PLAN_SUPERSEDED'

export type ConfirmationValidationInput = {
  /** Null when the sender could not be matched to any required role. */
  role: ConfirmationRole | null
  /**
   * The plan the confirmation was read against. Equal to `plan.planHash` for
   * every real inbound reply in this phase — the plan is immutable once set
   * (A-1) — so a mismatch here only exercises the defensive path a future,
   * re-planning phase would actually reach.
   */
  planHash: string
  commitments: readonly ExtractedCommitment[]
  unresolved: readonly string[]
}

export type ConfirmationValidationResult =
  | { verdict: 'MATCHES_PLAN'; mismatchReasons: [] }
  | { verdict: 'DIFFERS_FROM_PLAN'; mismatchReasons: ConfirmationMismatchReason[] }

/**
 * One supplier's reply against one plan. The comparison is a SET over
 * `{quantity, day}` for that role's `COMMIT` entries only — `CANCEL` entries
 * are not something the supplier is expected to enumerate, since they confirm
 * what they will deliver, not what they will not.
 *
 * Dates compare by calendar day, not instant: a supplier who writes "Wednesday"
 * is not expected to match a stored delivery timestamp to the second.
 */
export function validateConfirmation(
  plan: ConfirmationPlanContract,
  input: ConfirmationValidationInput,
): ConfirmationValidationResult {
  const reasons: ConfirmationMismatchReason[] = []

  const roleIsRequired = input.role !== null && plan.requiredConfirmations.includes(input.role)
  if (!roleIsRequired) reasons.push('UNKNOWN_ROLE')

  if (input.planHash !== plan.planHash) reasons.push('PLAN_SUPERSEDED')

  if (input.unresolved.length > 0 || input.commitments.length === 0) reasons.push('UNRESOLVED_FACTS')

  if (roleIsRequired) {
    const expected = plan.supplierCommitments
      .filter((commitment) => commitment.role === input.role && commitment.intent === 'COMMIT')
      .map((commitment) => commitmentKey(commitment.quantity, commitment.deliveryDate))
    const actual = input.commitments.map((commitment) => commitmentKey(commitment.quantity, commitment.date))
    if (!multisetsEqual(expected, actual)) reasons.push('QUANTITY_OR_DATE_DIFFERS')
  }

  if (reasons.length === 0) return { verdict: 'MATCHES_PLAN', mismatchReasons: [] }
  return { verdict: 'DIFFERS_FROM_PLAN', mismatchReasons: reasons }
}

/**
 * Matches a confirmation's sender to the role that owns their address in the
 * plan snapshot. Unreachable in practice once triage has already narrowed
 * inbound senders to case participants, but checked anyway because this
 * command is also reachable by a human operator, who is not bound by the
 * candidate list.
 */
export function resolveConfirmationRole(plan: ConfirmationPlanContract, senderEmail: string): ConfirmationRole | null {
  const normalized = normalizeEmail(senderEmail)
  const match = plan.supplierCommitments.find((commitment) => normalizeEmail(commitment.supplierEmail) === normalized)
  return match ? match.role : null
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Per-day key. The slice is a UTC-day truncation: both sides are stored as UTC
 * ISO strings, so a plan whose `deliveryDate` was ever written as local midnight
 * in a positive-offset zone would truncate to the previous day. Every date in
 * this module is minted in UTC; that assumption is what makes this safe.
 */
function commitmentKey(quantity: number, date: string): string {
  return `${quantity}:${date.slice(0, 10)}`
}

/**
 * MULTISET equality, not set equality.
 *
 * A role's commitments are a LIST and two of them may legitimately be
 * identical — an `ACCEPT_DELAY` split into `250 Wed` + `250 Wed` is the obvious
 * case. Deduplicating either side would let a supplier confirm ONE of those two
 * deliveries and still match, after which apply would mark BOTH rows
 * `CONFIRMED` and the case would go green on 250 units nobody ever promised.
 * Counting occurrences is what keeps "confirmed" meaning every delivery.
 */
function multisetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of b) {
    const remaining = counts.get(value)
    if (remaining === undefined || remaining === 0) return false
    counts.set(value, remaining - 1)
  }
  return true
}

export type { ConfirmationVerdict }
