import { z } from 'zod'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { PRODUCTION_ORDER_STATUSES, type ProductionOrderStatus } from '../../domain/orderExecutionPermissions'
import { PRODUCTION_ORDER_LIST_SORT_FIELDS } from '../../data/validators'

export const ORDER_LIST_PAGE_SIZE = 25
export const ORDERS_API_PATH = '/api/manufacturing/orders'

export const ORDER_STATUS_BADGES: StatusMap<ProductionOrderStatus> = {
  draft: 'neutral',
  released: 'info',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'error',
}

type SortField = (typeof PRODUCTION_ORDER_LIST_SORT_FIELDS)[number]

export type OrderListSorting = { id: string; desc: boolean }[]

export type OrderListFilterValues = {
  status?: unknown
  productVariantId?: unknown
  dueAt?: unknown
}

export type OrderListRequest = {
  page: number
  search: string
  filters: OrderListFilterValues
  sorting: OrderListSorting
}

const dueRangeSchema = z.object({ from: z.string().optional(), to: z.string().optional() })

function isSortField(value: string): value is SortField {
  return (PRODUCTION_ORDER_LIST_SORT_FIELDS as readonly string[]).includes(value)
}

function isOrderStatus(value: unknown): value is ProductionOrderStatus {
  return typeof value === 'string' && (PRODUCTION_ORDER_STATUSES as readonly string[]).includes(value)
}

export function buildOrderListQuery({ page, search, filters, sorting }: OrderListRequest): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(ORDER_LIST_PAGE_SIZE) })
  const term = search.trim()
  const dueRange = dueRangeSchema.safeParse(filters.dueAt)
  const [sort] = sorting

  if (term) params.set('search', term)
  if (isOrderStatus(filters.status)) params.set('status', filters.status)
  if (typeof filters.productVariantId === 'string' && filters.productVariantId) {
    params.set('productVariantId', filters.productVariantId)
  }
  if (dueRange.success && dueRange.data.from) params.set('dueFrom', dueRange.data.from)
  if (dueRange.success && dueRange.data.to) params.set('dueTo', dueRange.data.to)
  if (sort && isSortField(sort.id)) {
    params.set('sortField', sort.id)
    params.set('sortDir', sort.desc ? 'desc' : 'asc')
  }

  return params.toString()
}
