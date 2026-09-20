import { describe, expect, it } from '@jest/globals'
import { evaluateFeasibility } from '../feasibility'

const wed = '2026-09-23'
const fri = '2026-09-25'
const proposed = [{ quantity: 400, date: wed }, { quantity: 100, date: fri }]
// Wed slot: SO-442 was moved away by the replan; Fri slot holds SO-442's 300.
const slots = [
  { date: wed, capacityQuantity: 400, allocatedQuantity: 0 },
  { date: fri, capacityQuantity: 400, allocatedQuantity: 300 },
]

describe('supplier acceptance feasibility', () => {
  it('accepts 400 Wed / cancels 100 Fri and books only the production part', () => {
    const result = evaluateFeasibility({ proposed, accepted: [{ quantity: 400, date: wed }], cancelled: [{ quantity: 100, date: fri }], originalDate: wed, warehouseReserved: 300, slots, today: '2026-09-19' })
    expect(result).toEqual({ ok: true, production: [{ date: wed, quantity: 100 }], freedCapacity: [{ date: fri, quantity: 100 }] })
  })

  it('accepts the Level 3 variant without any production booking', () => {
    const level3 = [{ quantity: 300, date: wed }, { quantity: 200, date: fri }]
    const fullWed = [{ date: wed, capacityQuantity: 400, allocatedQuantity: 300 }, { date: fri, capacityQuantity: 400, allocatedQuantity: 0 }]
    const result = evaluateFeasibility({ proposed: level3, accepted: [{ quantity: 300, date: wed }], cancelled: [{ quantity: 200, date: fri }], originalDate: wed, warehouseReserved: 300, slots: fullWed, today: '2026-09-19' })
    expect(result).toEqual({ ok: true, production: [], freedCapacity: [{ date: fri, quantity: 200 }] })
  })

  it.each([
    ['F1', { accepted: [], cancelled: [{ quantity: 500, date: wed }] }],
    ['F1', { accepted: [{ quantity: 399.5, date: wed }], cancelled: [{ quantity: 100, date: fri }] }],
    ['F2', { accepted: [{ quantity: 400, date: wed }], cancelled: [{ quantity: 100, date: '2026-09-24' }] }],
    ['F2', { accepted: [{ quantity: 200, date: wed }, { quantity: 200, date: wed }], cancelled: [{ quantity: 100, date: fri }] }],
    // Totals balance (500) but the per-date split does not.
    ['F3', { accepted: [{ quantity: 450, date: wed }], cancelled: [{ quantity: 50, date: fri }] }],
    ['F3', { accepted: [{ quantity: 400, date: wed }], cancelled: [] }],
  ])('rejects with %s', (rule, input) => {
    const result = evaluateFeasibility({ proposed, originalDate: wed, warehouseReserved: 300, slots, today: '2026-09-19', ...input })
    expect(result).toMatchObject({ ok: false, rule, reason: `acceptance_infeasible_${rule}` })
  })

  it('rejects an accepted tranche in the past (F4)', () => {
    const result = evaluateFeasibility({ proposed, accepted: [{ quantity: 400, date: wed }], cancelled: [{ quantity: 100, date: fri }], today: '2026-09-24' })
    expect(result).toMatchObject({ ok: false, rule: 'F4' })
  })

  it('rejects production that no longer fits the slot (F5)', () => {
    const busy = [{ date: wed, capacityQuantity: 400, allocatedQuantity: 350 }, slots[1]]
    const result = evaluateFeasibility({ proposed, accepted: [{ quantity: 400, date: wed }], cancelled: [{ quantity: 100, date: fri }], originalDate: wed, warehouseReserved: 300, slots: busy, today: '2026-09-19' })
    expect(result).toMatchObject({ ok: false, rule: 'F5' })
  })
})
