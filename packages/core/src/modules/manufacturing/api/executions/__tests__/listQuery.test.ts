/** @jest-environment node */

import { listProductionExecutionsQuerySchema } from '../../../data/validators'
import { buildProductionExecutionFilters, toProductionExecutionListItem } from '../listQuery'

function filtersFor(query: Record<string, string>) {
  return buildProductionExecutionFilters(listProductionExecutionsQuerySchema.parse(query))
}

describe('production execution list query', () => {
  it('searches by execution number and filters by order', () => {
    expect(filtersFor({ search: 'EX-1', orderId: '11111111-1111-4111-8111-111111111111' })).toEqual({
      deleted_at: { $eq: null },
      execution_number: { $ilike: '%EX-1%' },
      order_id: { $eq: '11111111-1111-4111-8111-111111111111' },
    })
  })

  it('filters executions with or without an order', () => {
    expect(filtersFor({ withoutOrder: 'true' })).toMatchObject({ order_id: { $eq: null } })
    expect(filtersFor({ withoutOrder: 'false' })).toMatchObject({ order_id: { $ne: null } })
  })

  it('maps a standalone row and leaves order details empty until enrichment', () => {
    expect(
      toProductionExecutionListItem({
        id: '11111111-1111-4111-8111-111111111111',
        execution_number: 'EX-000001',
        order_id: null,
        product_variant_id: '22222222-2222-4222-8222-222222222222',
        source_location_id: null,
        target_location_id: null,
        created_at: '2026-10-22T10:00:00.000Z',
        updated_at: '2026-10-22T10:00:00.000Z',
      }),
    ).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      executionNumber: 'EX-000001',
      orderId: null,
      orderNumber: null,
      orderStatus: null,
      plannedQuantity: null,
      productVariantId: '22222222-2222-4222-8222-222222222222',
      sourceLocationId: null,
      targetLocationId: null,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: '2026-10-22T10:00:00.000Z',
    })
  })
})
