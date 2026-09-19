import type { ConfirmationPlanContract, ConfirmationRole, JsonValue } from '../../data/types'
import { confirmationPlanContractSchema } from '../../data/types'

export type PlanContractRejectionReason = 'PLAN_MISSING' | 'PLAN_INVALID' | 'PLAN_INCONSISTENT'

export type PlanContractResult =
  | { ok: true; plan: ConfirmationPlanContract }
  | { ok: false; reason: PlanContractRejectionReason }

/**
 * `SupplyCase.pendingResolutionPlan` is `jsonValueSchema` — Phase 3's contract
 * stays untyped at the column, so nothing downstream may assume its shape
 * without parsing. This is the ONE place that parses it for the confirmation
 * join, and it also enforces the one-time consistency rule the spec requires:
 * every role in `requiredConfirmations` must own at least one commitment, and
 * every commitment's role must be one of `requiredConfirmations`. A plan that
 * fails either check is `MISSING_DATA` for the case, not a guess.
 */
export function parseConfirmationPlanContract(raw: JsonValue | null): PlanContractResult {
  if (raw === null) return { ok: false, reason: 'PLAN_MISSING' }

  const parsed = confirmationPlanContractSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'PLAN_INVALID' }

  const plan = parsed.data
  if (!isConsistent(plan)) return { ok: false, reason: 'PLAN_INCONSISTENT' }

  return { ok: true, plan }
}

function isConsistent(plan: ConfirmationPlanContract): boolean {
  const requiredRoles = new Set<ConfirmationRole>(plan.requiredConfirmations)
  const rolesWithCommitments = new Set<ConfirmationRole>(plan.supplierCommitments.map((commitment) => commitment.role))

  for (const role of requiredRoles) {
    if (!rolesWithCommitments.has(role)) return false
  }
  for (const role of rolesWithCommitments) {
    if (!requiredRoles.has(role)) return false
  }
  return true
}
