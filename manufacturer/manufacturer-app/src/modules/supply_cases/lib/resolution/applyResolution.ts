import type { PlanCoverage } from '../../data/coverage'
import { calculatePlanCoverage } from '../../data/coverage'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type { ConfirmationPlanContract, ProductionPlan, SupplierCommitment, SupplyCase } from '../../data/types'

export type ApplyResolutionOutcome =
  | { status: 'RESOLVED'; supplyCase: SupplyCase; plan: ProductionPlan; coverage: PlanCoverage }
  | { status: 'NEEDS_ATTENTION'; supplyCase: SupplyCase; plan: ProductionPlan; coverage: PlanCoverage }

/**
 * Steps 2-5 of the spec's commit sequence, run against a case the command has
 * already moved to `APPLYING_RESOLUTION` (step 1, done by the caller under an
 * optimistic lock so two racing dispatches cannot both reach here).
 *
 * The plan mutation and the coverage/riskStatus recompute are folded into a
 * SINGLE `productionPlans.update` call rather than the three separate writes
 * the spec numbers (2, 3, 4): the JSON store's `update` is already one atomic
 * mutate, so splitting it into three would only ADD crash windows between
 * them without buying back any safety the single write does not already have.
 * What the spec's resumability argument actually requires — every write here
 * computes the plan's TARGET state from the snapshot, never a delta, so a
 * retry after a crash reproduces the same result — still holds for the merged
 * write.
 *
 * Only the final case write (step 5, the commit point) is separate, because it
 * is gated by the green gate computed from the plan write's own result.
 */
export async function applyResolution(
  store: SupplyCasesStore,
  scope: StoreScope,
  applyingCase: SupplyCase,
  plan: ConfirmationPlanContract,
  now: () => string,
): Promise<ApplyResolutionOutcome> {
  if (!applyingCase.productionPlanId) {
    throw new Error('[internal] a case entering apply_confirmed must carry a productionPlanId')
  }

  const productionPlan = await store.productionPlans.requireById(scope, applyingCase.productionPlanId)

  const untouched = productionPlan.supplierCommitments.filter(
    (commitment) => !planNamesSupplier(plan, commitment.supplierEmail),
  )
  const replaced: SupplierCommitment[] = plan.supplierCommitments.map((commitment) => ({
    supplierEmail: commitment.supplierEmail,
    quantity: commitment.quantity,
    deliveryDate: commitment.deliveryDate,
    status: commitment.intent === 'COMMIT' ? 'CONFIRMED' : 'CANCELLED',
  }))

  const candidatePlan: ProductionPlan = {
    ...productionPlan,
    supplierCommitments: [...untouched, ...replaced],
    internalStockQuantity: plan.internalStockAllocation,
  }
  const coverage = calculatePlanCoverage(candidatePlan)

  const updatedPlan = await store.productionPlans.update(scope, productionPlan.id, {
    supplierCommitments: candidatePlan.supplierCommitments,
    internalStockQuantity: candidatePlan.internalStockQuantity,
    riskStatus: coverage.riskStatus,
  })

  if (coverage.isFullyCovered) {
    const resolvedCase = await store.supplyCases.compareAndSwap(scope, applyingCase.id, applyingCase.updatedAt, {
      status: 'RESOLVED',
      needsAttentionReason: null,
      resolvedAt: now(),
      actualAdditionalCost: plan.additionalCost,
    })
    return { status: 'RESOLVED', supplyCase: resolvedCase, plan: updatedPlan, coverage }
  }

  const attentionCase = await store.supplyCases.compareAndSwap(scope, applyingCase.id, applyingCase.updatedAt, {
    status: 'NEEDS_ATTENTION',
    // TODO(spec 2026-09-19-supply-cases-phase-4 § Bramka zieloności): COVERAGE_SHORTFALL awaits owner approval; ANALYSIS_FAILED is imprecise here.
    needsAttentionReason: 'ANALYSIS_FAILED',
  })
  return { status: 'NEEDS_ATTENTION', supplyCase: attentionCase, plan: updatedPlan, coverage }
}

function planNamesSupplier(plan: ConfirmationPlanContract, supplierEmail: string): boolean {
  const normalized = supplierEmail.trim().toLowerCase()
  return plan.supplierCommitments.some((commitment) => commitment.supplierEmail.trim().toLowerCase() === normalized)
}
