import {
  bomCreateSchema,
  bomAvailabilityUpdateSchema,
  bomListQuerySchema,
  bomReleaseSchema,
  bomUpdateSchema,
} from '../validators'

const bomId = '11111111-1111-4111-8111-111111111111'
const itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const updatedAt = '2026-10-08T13:00:00.000Z'

describe('bomReleaseSchema', () => {
  it('allows releasing an empty BOM', () => {
    expect(bomReleaseSchema.safeParse({
      id: bomId,
      expectedItems: [],
    }).success).toBe(true)
  })

  it('requires expectedItems', () => {
    expect(bomReleaseSchema.safeParse({
      id: bomId,
    }).success).toBe(false)
  })

  it('accepts timestamps with an explicit offset', () => {
    expect(bomReleaseSchema.safeParse({
      id: bomId,
      expectedItems: [{
        id: itemId,
        updatedAt: '2026-10-08T15:00:00+02:00',
      }],
    }).success).toBe(true)
  })

  it('rejects timestamps without a timezone', () => {
    expect(bomReleaseSchema.safeParse({
      id: bomId,
      expectedItems: [{
        id: itemId,
        updatedAt: '2026-10-08T13:00:00',
      }],
    }).success).toBe(false)
  })

  it.each([itemId, itemId.toUpperCase()])(
    'rejects duplicate item IDs: %s',
    (duplicateId) => {
      expect(bomReleaseSchema.safeParse({
        id: bomId,
        expectedItems: [
          { id: itemId, updatedAt },
          { id: duplicateId, updatedAt },
        ],
      }).success).toBe(false)
    },
  )

  it('rejects extra fields in the request and items', () => {
    expect(bomReleaseSchema.safeParse({
      id: bomId,
      expectedItems: [],
      status: 'released',
    }).success).toBe(false)

    expect(bomReleaseSchema.safeParse({
      id: bomId,
      expectedItems: [{
        id: itemId,
        updatedAt,
        quantity: '2',
      }],
    }).success).toBe(false)
  })
})

describe('bomListQuerySchema', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
  ])('parses isIncomplete=%s', (value, expected) => {
    expect(bomListQuerySchema.parse({
      isIncomplete: value,
    }).isIncomplete).toBe(expected)
  })

  it('allows omitting isIncomplete', () => {
    expect(bomListQuerySchema.parse({}).isIncomplete).toBeUndefined()
  })

  it.each([['true', true], ['false', false], ['1', true]])('parses availableForNewOrders=%s', (value, expected) => {
    expect(bomListQuerySchema.parse({ availableForNewOrders: value }).availableForNewOrders).toBe(expected)
  })

  it('allows omitting availableForNewOrders', () => {
    expect(bomListQuerySchema.parse({}).availableForNewOrders).toBeUndefined()
  })

  it('rejects an invalid boolean token', () => {
    expect(bomListQuerySchema.safeParse({
      isIncomplete: 'abc',
    }).success).toBe(false)
  })

  it('trims the search term', () => {
    expect(bomListQuerySchema.parse({
      search: '  Widget  ',
    }).search).toBe('Widget')
  })

  it('allows omitting search', () => {
    expect(bomListQuerySchema.parse({}).search).toBeUndefined()
  })

  it('limits search to 200 characters', () => {
    expect(bomListQuerySchema.safeParse({
      search: 'a'.repeat(200),
    }).success).toBe(true)

    expect(bomListQuerySchema.safeParse({
      search: 'a'.repeat(201),
    }).success).toBe(false)
  })
})

describe('bomAvailabilityUpdateSchema', () => {
  it('requires a UUID and boolean availability value', () => {
    expect(bomAvailabilityUpdateSchema.safeParse({ id: bomId, isAvailableForNewOrders: false }).success).toBe(true)
    expect(bomAvailabilityUpdateSchema.safeParse({ id: bomId, isAvailableForNewOrders: 'true' }).success).toBe(false)
    expect(bomAvailabilityUpdateSchema.safeParse({ id: bomId }).success).toBe(false)
    expect(bomAvailabilityUpdateSchema.safeParse({ id: bomId, isAvailableForNewOrders: true, tenantId: bomId }).success).toBe(false)
  })
})

describe('BOM release fields', () => {
  it.each([
    { status: 'released' },
    { isIncomplete: true },
    { releasedAt: updatedAt },
    { releasedByUserId: bomId },
  ])('rejects release fields in create and update: %j', (fields) => {
    expect(bomCreateSchema.safeParse({
      outputVariantId: itemId,
      baseQuantity: '1',
      ...fields,
    }).success).toBe(false)

    expect(bomUpdateSchema.safeParse({
      id: bomId,
      ...fields,
    }).success).toBe(false)
  })
})
