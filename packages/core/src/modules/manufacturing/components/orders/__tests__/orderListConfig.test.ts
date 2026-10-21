/** @jest-environment node */

import { buildOrderListQuery } from '../orderListConfig'

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
})
