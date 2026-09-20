import { describe, expect, it } from '@jest/globals'
import { planBaselineCommitment, replan } from '../planner'

describe('supplier demo baseline planner', () => {
  it('splits the shortfall across the earliest available slots', () => {
    const result = planBaselineCommitment({
      requiredQuantity: 500,
      reservedQuantity: 300,
      expectedDeliveryAt: '2026-09-23',
      today: '2026-09-18',
      slots: [
        { startsAt: '2026-09-23T12:00:00.000Z', capacityQuantity: 300, allocations: [{ quantity: 300 }] },
        { startsAt: '2026-09-25T12:00:00.000Z', capacityQuantity: 300 },
      ],
    })
    expect(result).toEqual({
      ok: true,
      commitments: [
        { quantity: 300, date: '2026-09-23' },
        { quantity: 200, date: '2026-09-25' },
      ],
    })
  })

  it('fails closed for past commitments and missing capacity', () => {
    expect(planBaselineCommitment({
      requiredQuantity: 10,
      reservedQuantity: 0,
      expectedDeliveryAt: '2026-09-17',
      today: '2026-09-18',
      slots: [{ startsAt: '2026-09-19', capacityQuantity: 10 }],
    })).toEqual({ ok: false, reason: 'commitment_in_past' })
    expect(planBaselineCommitment({
      requiredQuantity: 10,
      reservedQuantity: 0,
      expectedDeliveryAt: '2026-09-18',
      today: '2026-09-18',
      slots: [{ startsAt: '2026-09-19', capacityQuantity: 9 }],
    })).toEqual({ ok: false, reason: 'no_capacity' })
  })

  it('moves the deterministic normal-priority allocation and replans 400/100', () => {
    const result = replan({
      requiredQuantity: 500,
      reservedQuantity: 300,
      expectedDeliveryAt: '2026-09-23T12:00:00.000Z',
      baselineCommitment: [
        { quantity: 300, date: '2026-09-23' },
        { quantity: 200, date: '2026-09-25' },
      ],
      slots: [
        {
          id: 'slot-wed',
          startsAt: '2026-09-23T12:00:00.000Z',
          capacityQuantity: 400,
          allocations: [{
            orderNumber: 'SO-442',
            quantity: 300,
            priority: 'normal',
            slaDueAt: '2026-09-25T12:00:00.000Z',
            shiftableHours: 4,
            shiftCostPerHour: 30,
          }],
        },
        {
          id: 'slot-fri',
          startsAt: '2026-09-25T12:00:00.000Z',
          capacityQuantity: 400,
          allocations: [],
        },
      ],
    })

    expect(result.commitments).toEqual([
      { quantity: 400, date: '2026-09-23' },
      { quantity: 100, date: '2026-09-25' },
    ])
    expect(result.movedAllocations).toEqual([expect.objectContaining({ orderNumber: 'SO-442', shiftHours: 4 })])
    expect(result.incrementalCost).toBe(120)
    expect(result.slaProtected).toBe(true)
  })

  it('keeps the baseline and does not move a high-priority allocation', () => {
    const result = replan({
      requiredQuantity: 500,
      reservedQuantity: 300,
      expectedDeliveryAt: '2026-09-23T12:00:00.000Z',
      baselineCommitment: [
        { quantity: 300, date: '2026-09-23' },
        { quantity: 200, date: '2026-09-25' },
      ],
      slots: [{
        startsAt: '2026-09-23T12:00:00.000Z',
        capacityQuantity: 400,
        allocations: [{ orderNumber: 'SO-442', quantity: 300, priority: 'high', shiftableHours: 4, shiftCostPerHour: 30 }],
      }, {
        startsAt: '2026-09-25T12:00:00.000Z',
        capacityQuantity: 400,
        allocations: [],
      }],
    })

    expect(result.commitments).toEqual([
      { quantity: 300, date: '2026-09-23' },
      { quantity: 200, date: '2026-09-25' },
    ])
    expect(result.movedAllocations).toEqual([])
    expect(result.highPriorityAllocationMoved).toBe(true)
    expect(result.incrementalCost).toBe(0)
  })

  it('does not flag a high-priority allocation when normal-priority moves already improve the commitment', () => {
    const result = replan({
      requiredQuantity: 500,
      reservedQuantity: 300,
      expectedDeliveryAt: '2026-09-23T12:00:00.000Z',
      baselineCommitment: [
        { quantity: 300, date: '2026-09-23' },
        { quantity: 200, date: '2026-09-25' },
      ],
      slots: [{
        id: 'slot-wed',
        startsAt: '2026-09-23T12:00:00.000Z',
        capacityQuantity: 500,
        allocations: [
          { orderNumber: 'SO-440', quantity: 100, priority: 'high', shiftableHours: 4, shiftCostPerHour: 30, slaDueAt: '2026-09-23T18:00:00.000Z' },
          { orderNumber: 'SO-442', quantity: 300, priority: 'normal', shiftableHours: 4, shiftCostPerHour: 30, slaDueAt: '2026-09-25T12:00:00.000Z' },
        ],
      }, {
        id: 'slot-fri',
        startsAt: '2026-09-25T12:00:00.000Z',
        capacityQuantity: 400,
        allocations: [],
      }],
    })

    expect(result.commitments[0]).toEqual({ quantity: 400, date: '2026-09-23' })
    expect(result.movedAllocations.map((move) => move.orderNumber)).toEqual(['SO-442'])
    expect(result.highPriorityAllocationMoved).toBe(false)
  })
})
