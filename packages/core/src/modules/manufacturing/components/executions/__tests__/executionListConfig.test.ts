/** @jest-environment node */

import { buildExecutionListQuery } from '../executionListConfig'

const base = { page: 1, search: '', filters: {}, sorting: [], orderId: null }

describe('execution list query', () => {
  it('requests the first page by default', () => {
    expect(buildExecutionListQuery(base)).toBe('page=1&pageSize=25')
  })

  it('passes search, the order from the URL and sorting', () => {
    expect(
      Object.fromEntries(
        new URLSearchParams(
          buildExecutionListQuery({ ...base, search: ' EX-3 ', orderId: 'order-1', sorting: [{ id: 'executionNumber', desc: false }] }),
        ),
      ),
    ).toEqual({ page: '1', pageSize: '25', search: 'EX-3', orderId: 'order-1', sortField: 'executionNumber', sortDir: 'asc' })
  })

  it.each([
    ['withOrder', 'false'],
    ['withoutOrder', 'true'],
  ])('maps the %s filter to withoutOrder=%s', (orderLink, withoutOrder) => {
    expect(new URLSearchParams(buildExecutionListQuery({ ...base, filters: { orderLink } })).get('withoutOrder')).toBe(withoutOrder)
  })
})
