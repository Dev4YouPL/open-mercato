import { z } from 'zod'
import type { Where } from '@open-mercato/shared/lib/query/types'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { SupplierRfq } from '../../data/entities'

const ENTITY_ID = 'supplier_demo:supplier_rfq' as const
const statuses = ['pending_interpretation', 'needs_human', 'ready_for_approval', 'approved', 'rejected', 'send_held', 'sent', 'send_failed'] as const

export const rfqListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(statuses).optional(),
  search: z.string().trim().max(120).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

type RfqListQuery = z.infer<typeof rfqListQuerySchema>
const listFields = ['id', 'correlation_id', 'subject', 'sender_email', 'sku', 'requested_quantity', 'requested_delivery_date', 'status', 'operator_decision', 'send_status', 'computed_offer', 'last_error', 'created_at', 'updated_at']

export const { metadata, GET } = makeCrudRoute({
  metadata: { GET: { requireAuth: true, requireFeatures: ['supplier_demo.rfqs.view'] } },
  orm: { entity: SupplierRfq, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  list: {
    schema: rfqListQuerySchema,
    entityId: ENTITY_ID,
    fields: listFields,
    sortFieldMap: { id: 'id', sku: 'sku', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at', updated_at: 'updated_at' },
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    tiebreakSortField: 'id',
    disableListCache: true,
    buildFilters: async (query: RfqListQuery, _ctx: CrudCtx): Promise<Where<Record<string, unknown>>> => {
      const filters: Record<string, unknown> = {}
      if (query.status) filters.status = query.status
      if (query.search) {
        const value = `%${escapeLikePattern(query.search)}%`
        filters.$or = [{ correlation_id: { $ilike: value } }, { subject: { $ilike: value } }, { sku: { $ilike: value } }]
      }
      return filters as Where<Record<string, unknown>>
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      correlationId: String(item.correlation_id),
      subject: String(item.subject),
      senderEmail: typeof item.sender_email === 'string' ? item.sender_email : null,
      sku: String(item.sku),
      requestedQuantity: typeof item.requested_quantity === 'number' ? item.requested_quantity : Number(item.requested_quantity ?? 0) || null,
      requestedDeliveryDate: typeof item.requested_delivery_date === 'string' ? item.requested_delivery_date : null,
      status: item.status,
      operatorDecision: item.operator_decision,
      sendStatus: item.send_status,
      computedOffer: item.computed_offer && typeof item.computed_offer === 'object' ? item.computed_offer : null,
      lastError: typeof item.last_error === 'string' ? item.last_error : null,
      createdAt: item.created_at instanceof Date ? item.created_at.toISOString() : null,
      updatedAt: item.updated_at instanceof Date ? item.updated_at.toISOString() : null,
    }),
  },
})

const createOpenApi = createCrudOpenApiFactory({ defaultTag: 'Supplier Demo RFQ' })
export const rfqListItemSchema = z.object({
  id: z.string().uuid(), correlationId: z.string(), subject: z.string(), senderEmail: z.string().nullable(), sku: z.string(), requestedQuantity: z.number().nullable(), requestedDeliveryDate: z.string().nullable(), status: z.enum(statuses), operatorDecision: z.string(), sendStatus: z.string(), computedOffer: z.record(z.string(), z.unknown()).nullable(), lastError: z.string().nullable(), createdAt: z.string().nullable(), updatedAt: z.string().nullable(),
})
export const openApi = createOpenApi({ resourceName: 'Supplier RFQ', pluralName: 'Supplier RFQs', querySchema: rfqListQuerySchema, listResponseSchema: createPagedListResponseSchema(rfqListItemSchema), description: 'Lists inbound supplier RFQs in the authenticated organization.' })
