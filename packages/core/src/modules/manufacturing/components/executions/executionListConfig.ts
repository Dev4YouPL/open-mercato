import { PRODUCTION_EXECUTION_LIST_SORT_FIELDS } from '../../data/validators'

export const EXECUTION_LIST_PAGE_SIZE = 25

type SortField = (typeof PRODUCTION_EXECUTION_LIST_SORT_FIELDS)[number]

export type ExecutionListRequest = {
  page: number
  search: string
  filters: { orderLink?: unknown }
  sorting: { id: string; desc: boolean }[]
  orderId: string | null
}

function isSortField(value: string): value is SortField {
  return (PRODUCTION_EXECUTION_LIST_SORT_FIELDS as readonly string[]).includes(value)
}

export function buildExecutionListQuery({ page, search, filters, sorting, orderId }: ExecutionListRequest): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(EXECUTION_LIST_PAGE_SIZE) })
  const term = search.trim()
  const [sort] = sorting

  if (term) params.set('search', term)
  if (orderId) params.set('orderId', orderId)
  if (filters.orderLink === 'withOrder') params.set('withoutOrder', 'false')
  if (filters.orderLink === 'withoutOrder') params.set('withoutOrder', 'true')
  if (sort && isSortField(sort.id)) {
    params.set('sortField', sort.id)
    params.set('sortDir', sort.desc ? 'desc' : 'asc')
  }

  return params.toString()
}
