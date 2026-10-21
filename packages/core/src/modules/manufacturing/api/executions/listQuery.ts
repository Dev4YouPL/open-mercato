import { z } from 'zod'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import {
  productionExecutionListItemSchema,
  type ListProductionExecutionsQuery,
  type ProductionExecutionListItem,
} from '../../data/validators'

export const PRODUCTION_EXECUTION_LIST_FIELDS = [
  'id',
  'organization_id',
  'tenant_id',
  'execution_number',
  'order_id',
  'product_variant_id',
  'source_location_id',
  'target_location_id',
  'created_at',
  'updated_at',
]

export const PRODUCTION_EXECUTION_SORT_FIELD_MAP = {
  executionNumber: 'execution_number',
  createdAt: 'created_at',
}

const timestamp = z.union([z.string(), z.date()])

const listRowSchema = z.object({
  id: z.string(),
  execution_number: z.string(),
  order_id: z.string().nullable().optional(),
  product_variant_id: z.string().nullable().optional(),
  source_location_id: z.string().nullable().optional(),
  target_location_id: z.string().nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
})

export function buildProductionExecutionFilters(query: ListProductionExecutionsQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = { deleted_at: { $eq: null } }

  if (query.id) filters.id = { $eq: query.id }
  if (query.search) filters.execution_number = { $ilike: buildIlikeTerm(query.search) }
  if (query.orderId) filters.order_id = { $eq: query.orderId }
  if (query.withoutOrder === 'true') filters.order_id = { $eq: null }
  if (query.withoutOrder === 'false') filters.order_id = { $ne: null }

  return filters
}

export function toProductionExecutionListItem(row: unknown): ProductionExecutionListItem {
  const parsed = listRowSchema.parse(row)

  return productionExecutionListItemSchema.parse({
    id: parsed.id,
    executionNumber: parsed.execution_number,
    orderId: parsed.order_id ?? null,
    orderNumber: null,
    orderStatus: null,
    plannedQuantity: null,
    productVariantId: parsed.product_variant_id ?? null,
    sourceLocationId: parsed.source_location_id ?? null,
    targetLocationId: parsed.target_location_id ?? null,
    createdAt: new Date(parsed.created_at).toISOString(),
    updatedAt: new Date(parsed.updated_at).toISOString(),
  })
}
