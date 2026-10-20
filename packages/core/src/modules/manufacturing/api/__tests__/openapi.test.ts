import {
  bomListItemSchema,
  bomResponseSchema,
} from '../openapi'
import { bomAvailabilityReasonSchema } from '../../lib/bomAvailability'

const bomRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  outputVariantId: '44444444-4444-4444-8444-444444444444',
  baseQuantity: '1.000000',
  revision: '1',
  status: 'released',
  isAvailableForNewOrders: true,
  isIncomplete: false,
  releasedAt: '2026-10-16T09:38:12.484Z',
  releasedByUserId: '77777777-7777-4777-8777-777777777777',
  createdAt: '2026-10-16T09:34:28.598Z',
  updatedAt: '2026-10-16T09:38:12.484Z',
}

const listDecoration = {
  outputVariant: {
    id: bomRecord.outputVariantId,
    name: 'Finished product',
    sku: 'OUTPUT-01',
    isActive: true,
    isDeleted: false,
  },
  availability: {
    isAvailable: true,
    reason: null,
  },
}

describe('BOM response schemas', () => {
  it('accepts a BOM decorated with list fields when reading a single record', () => {
    const parsed = bomResponseSchema.safeParse({
      ...bomRecord,
      ...listDecoration,
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(bomRecord)
  })

  it('accepts additive response fields in list items', () => {
    expect(bomListItemSchema.safeParse({
      ...bomRecord,
      ...listDecoration,
      _extension: { flag: true },
    }).success).toBe(true)
  })

  it('requires the raw availability flag and accepts withdrawn availability', () => {
    const { isAvailableForNewOrders: _availability, ...withoutAvailability } = bomRecord
    expect(bomResponseSchema.safeParse(withoutAvailability).success).toBe(false)
    expect(bomAvailabilityReasonSchema.safeParse('withdrawn').success).toBe(true)
  })
})
