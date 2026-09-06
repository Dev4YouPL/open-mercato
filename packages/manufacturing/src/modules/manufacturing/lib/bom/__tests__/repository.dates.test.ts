import { toEntityDate } from '../repository'

/**
 * Regression: `GET /api/manufacturing/boms` returned 500 as soon as a single
 * BOM existed. The keyset page is read through Kysely, which hands
 * `timestamptz` columns over as strings, and `em.map` validates them against
 * the entity's declared `Date` type:
 *
 *   ValidationError: Trying to set Object.createdAt of type 'Date'
 *   to '2026-08-30 13:05:11.659+00' of type 'string'
 */
describe('toEntityDate', () => {
  it('coerces a postgres timestamptz string into a Date', () => {
    const coerced = toEntityDate('2026-08-30 13:05:11.659+00')
    expect(coerced).toBeInstanceOf(Date)
    expect(Number.isNaN(coerced.getTime())).toBe(false)
    expect(coerced.toISOString()).toBe('2026-08-30T13:05:11.659Z')
  })

  it('coerces an ISO string into a Date', () => {
    expect(toEntityDate('2026-08-30T13:05:11.659Z').toISOString()).toBe('2026-08-30T13:05:11.659Z')
  })

  it('passes an existing Date through by identity', () => {
    const original = new Date('2026-08-30T13:05:11.659Z')
    expect(toEntityDate(original)).toBe(original)
  })

  it('never returns a string, so em.map type validation cannot reject it', () => {
    for (const raw of ['2026-08-30 13:05:11.659+00', '2026-01-01T00:00:00.000Z', new Date()]) {
      expect(typeof toEntityDate(raw)).not.toBe('string')
      expect(toEntityDate(raw)).toBeInstanceOf(Date)
    }
  })
})
