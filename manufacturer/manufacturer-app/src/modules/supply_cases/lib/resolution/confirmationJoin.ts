import type { ConfirmationRole, SupplyConfirmation } from '../../data/types'

export type ConfirmationJoinStatus = 'PENDING' | 'COMPLETE' | 'BLOCKED'

/**
 * Pure function over one plan's required roles and its recorded confirmations.
 * Called from inside `JsonCollection.mutate`'s critical section by
 * `SupplyConfirmationRepository.recordAndEvaluate`, and again, from scratch, by
 * `apply_confirmed`'s own precondition — the command never trusts a caller's
 * idea of "complete" and always recomputes it from the current records.
 *
 * `confirmations` MUST already be filtered to the case and plan hash under
 * evaluation: a stale-plan confirmation belongs to a different set entirely,
 * and mixing it in here would let an old reply count toward a new plan's join.
 *
 * `BLOCKED` beats `PENDING`: a role that answered `DIFFERS_FROM_PLAN` will
 * never close automatically (renegotiation happens outside the system per the
 * spec's non-goals), so reporting `PENDING` for that case would suggest a
 * closing confirmation is still simply in flight.
 */
export function evaluateConfirmationJoin(
  requiredRoles: readonly ConfirmationRole[],
  confirmations: readonly SupplyConfirmation[],
): ConfirmationJoinStatus {
  const byRole = new Map<ConfirmationRole, SupplyConfirmation>()
  for (const confirmation of confirmations) {
    if (!byRole.has(confirmation.role)) byRole.set(confirmation.role, confirmation)
  }

  const hasMismatch = requiredRoles.some((role) => byRole.get(role)?.verdict === 'DIFFERS_FROM_PLAN')
  if (hasMismatch) return 'BLOCKED'

  const allMatched = requiredRoles.every((role) => byRole.get(role)?.verdict === 'MATCHES_PLAN')
  return allMatched ? 'COMPLETE' : 'PENDING'
}
