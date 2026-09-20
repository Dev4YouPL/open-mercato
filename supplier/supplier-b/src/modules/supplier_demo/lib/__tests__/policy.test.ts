import { describe, expect, it } from '@jest/globals'
import {
  evaluate,
  MAX_AUTO_APPROVED_INCREMENTAL_COST,
  MAX_AUTO_APPROVED_SHIFT_HOURS,
} from '../policy'

const safePlan = {
  maxShiftHours: MAX_AUTO_APPROVED_SHIFT_HOURS,
  slaProtected: true,
  incrementalCost: MAX_AUTO_APPROVED_INCREMENTAL_COST,
  highPriorityAllocationMoved: false,
}

describe('supplier demo supplier policy', () => {
  it('auto-approves exactly at the shift and cost limits', () => {
    expect(evaluate(safePlan)).toBe('auto_approved')
  })

  it('requires a human just above the shift or cost limits', () => {
    expect(evaluate({ ...safePlan, maxShiftHours: MAX_AUTO_APPROVED_SHIFT_HOURS + 0.01 })).toBe('human_required')
    expect(evaluate({ ...safePlan, incrementalCost: MAX_AUTO_APPROVED_INCREMENTAL_COST + 0.01 })).toBe('human_required')
  })

  it('requires a human for an SLA violation or high-priority impact', () => {
    expect(evaluate({ ...safePlan, slaProtected: false })).toBe('human_required')
    expect(evaluate({ ...safePlan, highPriorityAllocationMoved: true })).toBe('human_required')
  })
})

