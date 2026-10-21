import { bomAvailabilityResponseSchema, parseBomAvailabilityError } from '../bomAvailabilityClient'

const bomId = '33333333-3333-4333-8333-333333333333'

describe('bomAvailabilityResponseSchema', () => {
  it('parses successful availability responses', () => {
    expect(bomAvailabilityResponseSchema.safeParse({
      id: bomId,
      isAvailableForNewOrders: false,
      updatedAt: '2026-10-20T10:00:00.000Z',
    }).success).toBe(true)
  })
})

describe('parseBomAvailabilityError', () => {
  it('recognizes the not released conflict', () => {
    expect(parseBomAvailabilityError({
      status: 409,
      body: { code: 'manufacturing.bom_availability.not_released' },
    })).toEqual({ status: 409, code: 'manufacturing.bom_availability.not_released' })
  })

  it('returns falsey for other error shapes', () => {
    expect(parseBomAvailabilityError(new Error('failed'))).toBeNull()
    expect(parseBomAvailabilityError({ status: 500 })).toEqual({ status: 500 })
  })
})
