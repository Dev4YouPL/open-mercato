import { z } from 'zod'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { PRODUCTION_ORDER_STATUSES, type ProductionOrderStatus } from '../../domain/orderExecutionPermissions'
import { PRODUCTION_ORDER_LIST_SORT_FIELDS } from '../../data/validators'

export const ORDER_LIST_PAGE_SIZE = 25
export const ORDERS_API_PATH = '/api/manufacturing/orders'
export const CATALOG_VARIANTS_API_PATH = '/api/catalog/variants'

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

const variantListSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string().nullish(), sku: z.string().nullish() })),
})

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

export function toVariantLabels(response: unknown): Record<string, string> {
  const parsed = variantListSchema.safeParse(response)

  if (!parsed.success) return {}

  return Object.fromEntries(
    parsed.data.items.map((variant) => {
      const name = variant.name?.trim()
      const sku = variant.sku?.trim()
      const label = name && sku && name !== sku ? `${name} (${sku})` : name || sku || variant.id

      return [variant.id, label]
    }),
  )
}

export function toVariantOptions(response: unknown): { value: string; label: string }[] {
  return Object.entries(toVariantLabels(response)).map(([value, label]) => ({ value, label }))
}
