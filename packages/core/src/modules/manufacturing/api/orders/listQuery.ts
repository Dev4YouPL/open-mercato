import { z } from 'zod'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { productionOrderListItemSchema, type ListProductionOrdersQuery, type ProductionOrderListItem } from '../../data/validators'

export const PRODUCTION_ORDER_LIST_FIELDS = [
  'id',
  'organization_id',
  'tenant_id',
  'order_number',
  'product_variant_id',
  'bom_revision_id',
  'planned_quantity',
  'source_location_id',
  'target_location_id',
  'due_at',
  'status',
  'created_at',
  'updated_at',
]

export const PRODUCTION_ORDER_SORT_FIELD_MAP = {
  orderNumber: 'order_number',
  status: 'status',
  dueAt: 'due_at',
  plannedQuantity: 'planned_quantity',
  createdAt: 'created_at',
}

const DAY_MS = 24 * 60 * 60 * 1000

const listRowSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  product_variant_id: z.string(),
  bom_revision_id: z.string(),
  planned_quantity: z.union([z.string(), z.number()]),
  source_location_id: z.string(),
  target_location_id: z.string(),
  due_at: z.union([z.string(), z.date()]).nullable().optional(),
  status: z.string(),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
})

function toIsoString(value: string | Date): string {
  return new Date(value).toISOString()
}

function startOfUtcDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

export function buildProductionOrderFilters(query: ListProductionOrdersQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = { deleted_at: { $eq: null } }
  const dueAt: Record<string, Date> = {}

  if (query.id) filters.id = { $eq: query.id }
  if (query.search) filters.order_number = { $ilike: buildIlikeTerm(query.search) }
  if (query.productVariantId) filters.product_variant_id = { $eq: query.productVariantId }
  if (query.status) filters.status = { $eq: query.status }
  if (query.dueFrom) dueAt.$gte = startOfUtcDay(query.dueFrom)
  if (query.dueTo) dueAt.$lt = new Date(startOfUtcDay(query.dueTo).getTime() + DAY_MS)
  if (Object.keys(dueAt).length > 0) filters.due_at = dueAt

  return filters
}

export function toProductionOrderListItem(row: unknown): ProductionOrderListItem {
  const parsed = listRowSchema.parse(row)

  return productionOrderListItemSchema.parse({
    id: parsed.id,
    orderNumber: parsed.order_number,
    productVariantId: parsed.product_variant_id,
    bomRevisionId: parsed.bom_revision_id,
    plannedQuantity: Number(parsed.planned_quantity),
    sourceLocationId: parsed.source_location_id,
    targetLocationId: parsed.target_location_id,
    dueAt: parsed.due_at ? toIsoString(parsed.due_at) : null,
    status: parsed.status,
    createdAt: toIsoString(parsed.created_at),
    updatedAt: toIsoString(parsed.updated_at),
  })
}
