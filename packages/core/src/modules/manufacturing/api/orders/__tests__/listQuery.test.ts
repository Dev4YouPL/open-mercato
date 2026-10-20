/** @jest-environment node */

import { listProductionOrdersQuerySchema } from '../../../data/validators'
import { buildProductionOrderFilters, toProductionOrderListItem } from '../listQuery'

function filtersFor(query: Record<string, string>) {
  return buildProductionOrderFilters(listProductionOrdersQuerySchema.parse(query))
}

describe('production order list query', () => {
  it('lists only non-deleted orders by default', () => {
    expect(filtersFor({})).toEqual({ deleted_at: { $eq: null } })
  })

  it('searches by order number', () => {
    expect(filtersFor({ search: 'PO-12' })).toMatchObject({ order_number: { $ilike: '%PO-12%' } })
  })

  it('filters by product variant and status', () => {
    expect(
      filtersFor({ productVariantId: '11111111-1111-4111-8111-111111111111', status: 'released' }),
    ).toMatchObject({
      product_variant_id: { $eq: '11111111-1111-4111-8111-111111111111' },
      status: { $eq: 'released' },
    })
  })

  it('filters by an inclusive due date range', () => {
    expect(filtersFor({ dueFrom: '2026-11-01', dueTo: '2026-11-30' })).toMatchObject({
      due_at: { $gte: new Date('2026-11-01T00:00:00.000Z'), $lt: new Date('2026-12-01T00:00:00.000Z') },
    })
  })

  it('rejects unknown statuses, malformed dates and page sizes above 100', () => {
    expect(listProductionOrdersQuerySchema.safeParse({ status: 'archived' }).success).toBe(false)
    expect(listProductionOrdersQuerySchema.safeParse({ dueFrom: '30.11.2026' }).success).toBe(false)
    expect(listProductionOrdersQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false)
  })

  it('maps a query engine row to the list item contract', () => {
    expect(
      toProductionOrderListItem({
        id: '11111111-1111-4111-8111-111111111111',
        order_number: 'PO-000001',
        product_variant_id: '22222222-2222-4222-8222-222222222222',
        bom_revision_id: '33333333-3333-4333-8333-333333333333',
        planned_quantity: '12.5000',
        source_location_id: '44444444-4444-4444-8444-444444444444',
        target_location_id: '55555555-5555-4555-8555-555555555555',
        due_at: null,
        status: 'draft',
        created_at: '2026-10-21T10:00:00.000Z',
        updated_at: new Date('2026-10-21T10:00:00.000Z'),
      }),
    ).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      orderNumber: 'PO-000001',
      productVariantId: '22222222-2222-4222-8222-222222222222',
      bomRevisionId: '33333333-3333-4333-8333-333333333333',
      plannedQuantity: 12.5,
      sourceLocationId: '44444444-4444-4444-8444-444444444444',
      targetLocationId: '55555555-5555-4555-8555-555555555555',
      dueAt: null,
      status: 'draft',
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    })
  })
})
