export const MAX_AUTO_APPROVED_SHIFT_HOURS = 4
export const MAX_AUTO_APPROVED_INCREMENTAL_COST = 500

export type SupplierPolicyDecision = 'auto_approved' | 'human_required'

export type SupplierPolicyInput = {
  maxShiftHours: number
  slaProtected: boolean
  incrementalCost: number
  highPriorityAllocationMoved: boolean
}

export function evaluate(input: SupplierPolicyInput): SupplierPolicyDecision {
  const autoApproved = input.maxShiftHours <= MAX_AUTO_APPROVED_SHIFT_HOURS
    && input.slaProtected
    && input.incrementalCost <= MAX_AUTO_APPROVED_INCREMENTAL_COST
    && !input.highPriorityAllocationMoved
  return autoApproved ? 'auto_approved' : 'human_required'
}

