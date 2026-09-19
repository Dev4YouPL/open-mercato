import { describe, expect, it } from '@jest/globals'
import { buildNegotiationRecommendation, createNegotiationRecord } from '../../negotiation-record'

function recordWithOptions() {
  const record = createNegotiationRecord()
  record.counterRule = { ok: true, failed: null }
  record.evaluation = {
    id: '11111111-1111-4111-8111-111111111111',
    evaluatedAt: '2026-09-19T10:00:00.000Z',
    turnAtEvaluation: 0,
    maxTurns: 3,
    reasonCodes: ['requested_feasible_within_policy'],
    options: [{
      id: 'requested',
      commitments: [{ quantity: 400, date: '2026-09-23' }],
      feasible: true,
      policyDecision: 'auto_approved',
      incrementalCost: 0,
      maxShiftHours: 0,
      slaProtected: true,
      highPriorityAllocationMoved: false,
      movedAllocations: [],
      executionFingerprint: 'requested-fingerprint',
      distance: 0,
    }],
  }
  return record
}

describe('supplier negotiation record', () => {
  it('builds a bounded human-review recommendation from an existing option', () => {
    const recommendation = buildNegotiationRecommendation({
      record: recordWithOptions(),
      source: 'agent',
      optionId: 'requested',
      decision: 'accept_requested',
      reasonCodes: ['requested_feasible_within_policy'],
    })
    expect(recommendation).toMatchObject({
      source: 'agent',
      optionId: 'requested',
      executionFingerprint: 'requested-fingerprint',
      autoEligible: true,
      gates: { G1: 'pass', G2: 'pass', G3: 'pass', G4: 'pass', G5: 'pass', G6: 'pass', G7: 'pass', G8: 'pass', G9: 'pass' },
    })
  })

  it('rejects recommendations that are not one of the evaluated options', () => {
    expect(() => buildNegotiationRecommendation({
      record: recordWithOptions(),
      source: 'deterministic',
      optionId: 'alt_best_effort',
      decision: 'propose_alternative',
      reasonCodes: ['fallback'],
    })).toThrow('option was not found')
  })
})
