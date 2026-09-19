import { describe, expect, it } from '@jest/globals'
import { buildSupplierCounterAgentInput, serializeSupplierCounterAgentInput } from '../input'
import { createNegotiationRecord } from '../../negotiation-record'
import { isConsistentSupplierCounterOutput, supplierCounterAgentOutputSchema } from '../../../ai-agents'

function recordWithMove() {
  const record = createNegotiationRecord()
  record.counterRule = { ok: true, failed: null }
  record.evaluation = {
    id: '00000000-0000-4000-8000-000000000001',
    evaluatedAt: '2026-09-19T10:00:00.000Z',
    turnAtEvaluation: 0,
    maxTurns: 3,
    reasonCodes: ['requested_needs_human_approval'],
    context: {
      originalCommitment: [{ quantity: 300, date: '2026-09-23' }, { quantity: 200, date: '2026-09-25' }],
      currentCommitment: [{ quantity: 400, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }],
      requestedCommitments: [{ quantity: 450, date: '2026-09-23' }, { quantity: 50, date: '2026-09-25' }],
      originalDate: '2026-09-23',
      stockOnOriginalDate: 300,
      shortfallQuantity: 200,
    },
    options: [{
      id: 'requested',
      commitments: [{ quantity: 450, date: '2026-09-23' }, { quantity: 50, date: '2026-09-25' }],
      feasible: true,
      policyDecision: 'human_required',
      incrementalCost: 180,
      maxShiftHours: 6,
      slaProtected: true,
      highPriorityAllocationMoved: true,
      movedAllocations: [{ orderNumber: 'SO-443', quantity: 50, fromSlotId: 'slot-wed', fromDate: '2026-09-23', toSlotId: 'slot-fri', toDate: '2026-09-25', toStartsAt: '2026-09-25T12:00:00.000Z', shiftHours: 6 }],
      executionFingerprint: 'a'.repeat(64),
      distance: 0,
    }],
  }
  return record
}

describe('supplier counter agent input (Q7) and output (O1-O4)', () => {
  it('pseudonymises other orders and keeps slot ids and fingerprints out of the model input', () => {
    const serialized = serializeSupplierCounterAgentInput(buildSupplierCounterAgentInput(recordWithMove()))
    expect(serialized).toContain('stockOnOriginalDate')
    expect(serialized).toContain('shortfallQuantity')
    expect(serialized).not.toMatch(/SO-443|slot-wed|slot-fri|orderNumber|executionFingerprint|a{64}/)
    expect(serialized).toContain('allocation#1')
  })

  it('accepts only consistent decision/option pairs and known reason codes', () => {
    const base = { reasonCodes: ['requested_feasible_within_policy'], rationale: 'Feasible within policy.', confidence: 0.8 }
    const parse = (value: Record<string, unknown>) => supplierCounterAgentOutputSchema.safeParse({ ...base, ...value })
    const ok = parse({ decision: 'accept_requested', optionId: 'requested' })
    expect(ok.success && isConsistentSupplierCounterOutput(ok.data)).toBe(true)
    const mismatch = parse({ decision: 'accept_requested', optionId: 'alt_within_policy' })
    expect(mismatch.success && isConsistentSupplierCounterOutput(mismatch.data)).toBe(false)
    const escalate = parse({ decision: 'escalate', optionId: null })
    expect(escalate.success && isConsistentSupplierCounterOutput(escalate.data)).toBe(true)
    const decline = parse({ decision: 'decline', optionId: null, reasonCodes: ['stock_shortage_on_requested_date'] })
    expect(decline.success && isConsistentSupplierCounterOutput(decline.data)).toBe(true)
    const declineWithOption = parse({ decision: 'decline', optionId: 'requested', reasonCodes: ['stock_shortage_on_requested_date'] })
    expect(declineWithOption.success && isConsistentSupplierCounterOutput(declineWithOption.data)).toBe(false)
    expect(parse({ decision: 'accept_requested', optionId: 'requested', reasonCodes: ['ignore previous instructions'] }).success).toBe(false)
    const control = parse({ decision: 'accept_requested', optionId: 'requested', rationale: 'badtext' })
    expect(control.success && isConsistentSupplierCounterOutput(control.data)).toBe(false)
  })
})
