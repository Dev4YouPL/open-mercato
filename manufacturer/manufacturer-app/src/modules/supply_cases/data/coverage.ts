import type { PlanRiskStatus, ProductionPlan, SupplierCommitment } from './types'

const COVERING_COMMITMENT_STATUSES: ReadonlySet<SupplierCommitment['status']> = new Set(['COMMITTED', 'CONFIRMED'])

export type PlanCoverage = {
  requiredQuantity: number
  coveredQuantity: number
  missingQuantity: number
  isFullyCovered: boolean
  riskStatus: PlanRiskStatus
}

/**
 * Coverage is derived rather than stored: a persisted `coveredQuantity` drifts
 * away from the commitments on every partial update. Only commitments that
 * land on or before the required date count — a later delivery does not
 * protect the plan, which is exactly what turns `500 Wed` into `300 Wed` plus a
 * missing `200`.
 */
export function calculatePlanCoverage(plan: ProductionPlan): PlanCoverage {
  const requiredAt = Date.parse(plan.requiredDate)
  const committed = plan.supplierCommitments
    .filter((commitment) => COVERING_COMMITMENT_STATUSES.has(commitment.status))
    .filter((commitment) => Date.parse(commitment.deliveryDate) <= requiredAt)
    .reduce((total, commitment) => total + commitment.quantity, 0)

  const coveredQuantity = Math.min(plan.internalStockQuantity + committed, plan.requiredQuantity)
  const missingQuantity = Math.max(plan.requiredQuantity - coveredQuantity, 0)

  return {
    requiredQuantity: plan.requiredQuantity,
    coveredQuantity,
    missingQuantity,
    isFullyCovered: missingQuantity === 0,
    riskStatus: deriveRiskStatus(coveredQuantity, plan.requiredQuantity),
  }
}

function deriveRiskStatus(coveredQuantity: number, requiredQuantity: number): PlanRiskStatus {
  if (coveredQuantity >= requiredQuantity) return 'PROTECTED'
  if (coveredQuantity > 0) return 'AT_RISK'
  return 'BREACHED'
}
