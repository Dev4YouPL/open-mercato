import { describe, expect, it } from '@jest/globals'
import { counterPayloadSchema, parseSupplyEnvelope } from '../envelope'
import { buildCounterOptions, evaluateCounter, validateCounterRules } from '../counter-evaluation'
import type { SupplierProductionSlot } from '../../data/entities'

function slot(date: string, capacityQuantity: number, allocations: Array<Record<string, unknown>> = []): SupplierProductionSlot {
  return { id: `slot-${date}`, startsAt: new Date(`${date}T12:00:00.000Z`), capacityQuantity, allocations, tenantId: 'tenant', organizationId: 'org', catalogVariantId: 'variant', deletedAt: null, createdAt: new Date(), updatedAt: new Date() } as unknown as SupplierProductionSlot
}

describe('supplier counter v2 contract and deterministic evaluation', () => {
  it('rejects unknown counter payload keys and accepts the strict requestedCommitments shape', () => {
    expect(counterPayloadSchema.safeParse({ sku: 'MAT-42', inReplyToMessageId: 'MSG-1', requestedCommitments: [{ quantity: 400, date: '2026-09-23' }], extra: true }).success).toBe(false)
    const envelope = parseSupplyEnvelope({ schemaVersion: 1, messageId: 'MSG-2', correlationId: 'SC-SO-441', messageType: 'SUPPLY_COUNTER_PROPOSAL', sender: 'manufacturer@example.test', recipient: 'supplier@example.test', payload: { sku: 'MAT-42', inReplyToMessageId: 'MSG-1', requestedCommitments: [{ quantity: 400, date: '2026-09-23' }] } })
    expect(envelope.messageType).toBe('SUPPLY_COUNTER_PROPOSAL')
  })

  it('enforces C1-C6 and T1 with UTC date semantics', () => {
    const base = { current: [{ quantity: 500, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }], originalDate: '2026-09-23', slots: [slot('2026-09-23', 500), slot('2026-09-25', 500)], negotiationTurn: 0, maxTurns: 3, today: '2026-09-20' }
    expect(validateCounterRules({ ...base, requested: [] })).toEqual({ ok: false, failed: 'C1' })
    expect(validateCounterRules({ ...base, requested: [{ quantity: 300, date: '2026-09-23' }, { quantity: 300, date: '2026-09-23' }] })).toEqual({ ok: false, failed: 'C2' })
    expect(validateCounterRules({ ...base, requested: [{ quantity: 500, date: '2026-09-23' }] })).toEqual({ ok: false, failed: 'C3' })
    expect(validateCounterRules({ ...base, requested: [{ quantity: 500, date: '2026-09-19' }, { quantity: 100, date: '2026-09-25' }] })).toEqual({ ok: false, failed: 'C4' })
    expect(validateCounterRules({ ...base, requested: [{ quantity: 500, date: '2026-09-23' }, { quantity: 100, date: '2026-09-24' }] })).toEqual({ ok: false, failed: 'C5' })
    expect(validateCounterRules({ ...base, requested: base.current })).toEqual({ ok: false, failed: 'C6' })
    expect(validateCounterRules({ ...base, negotiationTurn: 3, requested: [{ quantity: 400, date: '2026-09-23' }, { quantity: 200, date: '2026-09-25' }] })).toEqual({ ok: false, failed: 'T1' })
  })

  it('returns requested and deterministic alternatives without double-reserving a requested destination', () => {
    const input = {
      requested: [{ quantity: 400, date: '2026-09-23' }, { quantity: 200, date: '2026-09-25' }],
      current: [{ quantity: 500, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }],
      originalDate: '2026-09-23',
      warehouseReserved: 300,
      slots: [slot('2026-09-23', 500, [{ orderNumber: 'SO-442', quantity: 100, priority: 'normal', shiftableHours: 4, shiftCostPerHour: 30, slaDueAt: '2026-09-25T12:00:00.000Z' }]), slot('2026-09-25', 300), slot('2026-09-26', 300)],
      caseOrderNumber: 'SO-441',
      negotiationTurn: 0,
      maxTurns: 3,
      today: '2026-09-20',
    }
    const evaluation = evaluateCounter(input)
    expect(evaluation.rule).toEqual({ ok: true, failed: null })
    expect(evaluation.options.length).toBeGreaterThanOrEqual(1)
    expect(evaluation.options[0]?.id).toBe('requested')
    expect(evaluation.options[0]?.executionFingerprint).toHaveLength(64)
    expect(buildCounterOptions(input).every((candidate, index, options) => options.findIndex((other) => JSON.stringify(other.commitments) === JSON.stringify(candidate.commitments)) === index)).toBe(true)
  })
})

// Demo fixture after the initial replan: SO-442 (300) moved from Wednesday to Friday;
// SO-443 (50, high priority) remains on Wednesday and Saturday is genuinely free.
const demoCase = {
  current: [{ quantity: 400, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }],
  originalDate: '2026-09-23',
  warehouseReserved: 300,
  caseOrderNumber: 'SO-441',
  negotiationTurn: 0,
  maxTurns: 3,
  today: '2026-09-20',
}
const so442 = { orderNumber: 'SO-442', quantity: 300, priority: 'normal', shiftableHours: 4, shiftCostPerHour: 30, slaDueAt: '2026-09-25T12:00:00.000Z' }
const so443 = { orderNumber: 'SO-443', quantity: 50, priority: 'high', shiftableHours: 6, shiftCostPerHour: 30, slaDueAt: '2026-09-25T12:00:00.000Z' }
const demoSlots = [slot('2026-09-23', 450, [so443]), slot('2026-09-25', 400, [so442]), slot('2026-09-26', 100)]

describe('supplier counter options (regressions)', () => {
  it('accepts 400 Wednesday / 100 Saturday without moving an allocation', () => {
    const evaluation = evaluateCounter({ ...demoCase, requested: [{ quantity: 400, date: '2026-09-23' }, { quantity: 100, date: '2026-09-26' }], slots: demoSlots })
    expect(evaluation.options).toHaveLength(1)
    expect(evaluation.options[0]).toMatchObject({ id: 'requested', feasible: true, policyDecision: 'auto_approved', movedAllocations: [], incrementalCost: 0, distance: 0 })
    expect(evaluation.reasonCodes).toEqual(['requested_feasible_within_policy'])
  })

  it('requires a human when 450 Wednesday / 50 Friday moves high-priority SO-443', () => {
    const evaluation = evaluateCounter({ ...demoCase, requested: [{ quantity: 450, date: '2026-09-23' }, { quantity: 50, date: '2026-09-25' }], slots: demoSlots })
    expect(evaluation.options[0]).toMatchObject({ id: 'requested', feasible: true, policyDecision: 'human_required', incrementalCost: 180, maxShiftHours: 6, highPriorityAllocationMoved: true })
    expect(evaluation.options[0]?.movedAllocations).toEqual([expect.objectContaining({ orderNumber: 'SO-443', quantity: 50, fromDate: '2026-09-23', toDate: '2026-09-25', shiftHours: 6 })])
    expect(evaluation.reasonCodes).toEqual(['requested_needs_human_approval'])
  })

  it('offers 450 Wednesday / 50 Friday as best effort for an infeasible 500 Wednesday request', () => {
    const evaluation = evaluateCounter({ ...demoCase, requested: [{ quantity: 500, date: '2026-09-23' }], slots: demoSlots })
    expect(evaluation.options[0]).toMatchObject({ id: 'requested', feasible: false, policyDecision: 'human_required' })
    const alternative = evaluation.options.find((option) => option.id === 'alt_best_effort')
    expect(alternative).toMatchObject({ feasible: true, policyDecision: 'human_required' })
    expect(alternative?.commitments).toEqual([{ quantity: 450, date: '2026-09-23' }, { quantity: 50, date: '2026-09-25' }])
    expect(evaluation.options.find((option) => option.id === 'alt_within_policy')).toBeUndefined()
    expect(evaluation.options.some((option) => JSON.stringify(option.commitments) === JSON.stringify(demoCase.current))).toBe(false)
  })

  it('uses the declared shift window, never moves a non-shiftable allocation, and applies the cumulative cost', () => {
    const shiftable = { ...so442, orderNumber: 'SO-9', quantity: 50, priority: 'normal' as const }
    const requested = [{ quantity: 450, date: '2026-09-23' }, { quantity: 50, date: '2026-09-25' }]
    const slots = [slot('2026-09-23', 450, [shiftable]), slot('2026-09-25', 400)]
    const option = evaluateCounter({ ...demoCase, requested, slots }).options[0]
    expect(option).toMatchObject({ feasible: true, maxShiftHours: 4, incrementalCost: 120, policyDecision: 'auto_approved' })
    // 400 PLN already spent on this case: +120 exceeds the 500 PLN policy limit.
    expect(evaluateCounter({ ...demoCase, requested, slots, cumulativeCost: 400 }).options[0]?.policyDecision).toBe('human_required')
    const pinned = [slot('2026-09-23', 450, [{ ...shiftable, shiftableHours: 0 }]), slot('2026-09-25', 400)]
    expect(evaluateCounter({ ...demoCase, requested, slots: pinned }).options[0]).toMatchObject({ feasible: false, movedAllocations: [] })
  })
})
