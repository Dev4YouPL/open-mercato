import { z } from 'zod'
import type { Where } from '@open-mercato/shared/lib/query/types'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SupplyCase, type SupplyCaseStatus } from '../../data/entities'

const ENTITY_ID = 'supplier_demo:supply_case' as const
const statuses = ['detected', 'proposal_ready', 'proposal_queued', 'proposal_delivered', 'counter_received', 'reply_received', 'commitment_updated', 'confirmation_queued', 'resolved', 'needs_human', 'escalated', 'blocked_recipient', 'send_failed'] as const

export const supplyCaseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(statuses).optional(),
  search: z.string().trim().max(120).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

type SupplyCaseListQuery = z.infer<typeof supplyCaseListQuerySchema>

const listFields = [
  'id',
  'sales_order_id',
  'order_number',
  'customer_display_name',
  'sku',
  'trigger',
  'status',
  'status_reason',
  'original_commitment',
  'baseline_commitment',
  'current_commitment',
  'accepted_commitment',
  'cancelled_commitment',
  'created_at',
  'updated_at',
]

const sortFieldMap = {
  id: 'id',
  orderNumber: 'order_number',
  sku: 'sku',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  updated_at: 'updated_at',
} as Record<string, string>

function isoDate(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function commitment(value: unknown): Array<{ quantity: number; date: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const quantity = Number(record.quantity)
    const date = typeof record.date === 'string' ? record.date : ''
    return Number.isFinite(quantity) && date ? [{ quantity, date }] : []
  })
}

export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['supplier_demo.supply_cases.view'] },
  },
  orm: {
    entity: SupplyCase,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: supplyCaseListQuerySchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap,
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    tiebreakSortField: 'id',
    disableListCache: true,
    buildFilters: async (query: SupplyCaseListQuery, _ctx: CrudCtx): Promise<Where<Record<string, unknown>>> => {
      const filters: Record<string, unknown> = {}
      if (query.status) filters.status = query.status
      if (query.search) {
        const value = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { order_number: { $ilike: value } },
          { sku: { $ilike: value } },
          { customer_display_name: { $ilike: value } },
        ]
      }
      return filters as Where<Record<string, unknown>>
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      salesOrderId: String(item.sales_order_id),
      orderNumber: String(item.order_number),
      customerDisplayName: typeof item.customer_display_name === 'string' ? item.customer_display_name : null,
      sku: String(item.sku),
      trigger: item.trigger,
      status: item.status,
      statusReason: typeof item.status_reason === 'string' ? item.status_reason : null,
      originalCommitment: commitment(item.original_commitment),
      baselineCommitment: commitment(item.baseline_commitment),
      currentCommitment: commitment(item.current_commitment),
      acceptedCommitment: commitment(item.accepted_commitment),
      cancelledCommitment: commitment(item.cancelled_commitment),
      createdAt: isoDate(item.created_at),
      updatedAt: isoDate(item.updated_at),
    }),
  },
})

const createOpenApi = createCrudOpenApiFactory({ defaultTag: 'Supplier Demo' })
export const supplyCaseListItemSchema = z.object({
  id: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  orderNumber: z.string(),
  customerDisplayName: z.string().nullable(),
  sku: z.string(),
  trigger: z.enum(['wms_shortfall', 'manual_disruption']),
  status: z.enum(statuses),
  statusReason: z.string().nullable(),
  originalCommitment: z.array(z.object({ quantity: z.number(), date: z.string() })),
  baselineCommitment: z.array(z.object({ quantity: z.number(), date: z.string() })),
  currentCommitment: z.array(z.object({ quantity: z.number(), date: z.string() })),
  acceptedCommitment: z.array(z.object({ quantity: z.number(), date: z.string() })),
  cancelledCommitment: z.array(z.object({ quantity: z.number(), date: z.string() })),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createOpenApi({
  resourceName: 'Supply case',
  pluralName: 'Supply cases',
  querySchema: supplyCaseListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(supplyCaseListItemSchema),
  description: 'Lists supply recovery cases in the authenticated organization.',
})

export type { SupplyCaseStatus }
