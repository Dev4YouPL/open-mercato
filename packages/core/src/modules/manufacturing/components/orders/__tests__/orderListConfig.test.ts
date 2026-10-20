/** @jest-environment node */

import { buildOrderListQuery, toVariantLabels, toVariantOptions } from '../orderListConfig'

const base = { page: 1, search: '', filters: {}, sorting: [] }

describe('production order list config', () => {
  it('requests the first page with the default page size', () => {
    expect(buildOrderListQuery(base)).toBe('page=1&pageSize=25')
  })

  it('passes search, filters, due range and sorting to the API', () => {
    const query = new URLSearchParams(
      buildOrderListQuery({
        page: 2,
        search: ' PO-7 ',
        filters: {
          status: 'released',
          productVariantId: 'variant-1',
          dueAt: { from: '2026-11-01', to: '2026-11-30' },
        },
        sorting: [{ id: 'dueAt', desc: false }],
      }),
    )

    expect(Object.fromEntries(query)).toEqual({
      page: '2',
      pageSize: '25',
      search: 'PO-7',
      status: 'released',
      productVariantId: 'variant-1',
      dueFrom: '2026-11-01',
      dueTo: '2026-11-30',
      sortField: 'dueAt',
      sortDir: 'asc',
    })
  })

  it('ignores unknown statuses, empty due ranges and unsortable columns', () => {
    expect(
      buildOrderListQuery({
        ...base,
        filters: { status: 'archived', dueAt: { from: undefined, to: undefined } },
        sorting: [{ id: 'productVariantId', desc: true }],
      }),
    ).toBe('page=1&pageSize=25')
  })

  it('labels variants by name and SKU, falling back to whichever exists', () => {
    expect(
      toVariantLabels({
        items: [
          { id: 'variant-1', name: 'Oak table', sku: 'TBL-OAK' },
          { id: 'variant-2', name: null, sku: 'TBL-PINE' },
          { id: 'variant-3', name: null, sku: null },
        ],
      }),
    ).toEqual({ 'variant-1': 'Oak table (TBL-OAK)', 'variant-2': 'TBL-PINE', 'variant-3': 'variant-3' })
  })

  it('turns variants into filter options and tolerates unexpected responses', () => {
    expect(toVariantOptions({ items: [{ id: 'variant-1', name: 'Oak table', sku: 'Oak table' }] })).toEqual([
      { value: 'variant-1', label: 'Oak table' },
    ])
    expect(toVariantOptions({ error: 'forbidden' })).toEqual([])
  })
})
