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

  it('allows automatic dispatch for an interpreted agent recommendation whose I gates pass', () => {
    const record = recordWithOptions()
    record.origin = 'interpretation'
    record.evaluation!.autoGates = { I1: 'pass', I2: 'pass', I3: 'pass', I4: 'pass', I5: 'pass', I6: 'pass', I7: 'pass', I8: 'pass', I9: 'pass' }
    const recommendation = buildNegotiationRecommendation({
      record,
      source: 'agent',
      optionId: 'requested',
      decision: 'accept_requested',
      reasonCodes: ['requested_feasible_within_policy'],
    })
    expect(recommendation.gates).toMatchObject({ I1: 'pass', I9: 'pass', G10: 'pass' })
    expect(recommendation.autoEligible).toBe(true)
  })

  it('never marks a deterministic fallback auto-eligible', () => {
    const record = recordWithOptions()
    record.origin = 'interpretation'
    record.evaluation!.autoGates = { I1: 'pass', I2: 'pass', I3: 'pass', I4: 'pass', I5: 'pass', I6: 'pass', I7: 'pass', I8: 'pass', I9: 'pass' }
    const interpreted = buildNegotiationRecommendation({
      record,
      source: 'deterministic',
      optionId: 'requested',
      decision: 'accept_requested',
      reasonCodes: ['interpretation_requires_human'],
    })
    expect(interpreted.gates).toMatchObject({ G2: 'n/a', G3: 'n/a', G7: 'n/a' })
    expect(interpreted.autoEligible).toBe(false)
    const envelope = buildNegotiationRecommendation({
      record: recordWithOptions(),
      source: 'deterministic',
      optionId: 'requested',
      decision: 'accept_requested',
      reasonCodes: ['auto_negotiation_disabled'],
    })
    expect(envelope.gates).toMatchObject({ G10: 'n/a' })
    expect(envelope.autoEligible).toBe(false)
  })

  it('keeps interpreted recommendations human-only when an automatic gate fails', () => {
    const record = recordWithOptions()
    record.origin = 'interpretation'
    record.evaluation!.autoGates = { I1: 'fail', I2: 'pass', I3: 'pass', I4: 'pass', I5: 'pass', I6: 'pass', I7: 'pass', I8: 'pass', I9: 'pass' }
    const recommendation = buildNegotiationRecommendation({
      record,
      source: 'deterministic',
      optionId: 'requested',
      decision: 'accept_requested',
      reasonCodes: ['interpretation_auto_shadow'],
    })
    expect(recommendation.gates.G10).toBe('fail')
    expect(recommendation.autoEligible).toBe(false)
  })
})
