import { z } from 'zod'
import { E } from '#generated/entities.ids.generated'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CREATE_PRODUCTION_ORDER_COMMAND_ID, type CreateProductionOrderResult } from '../../commands/productionOrders'
import { ProductionOrder } from '../../data/entities'
import {
  createProductionOrderSchema,
  listProductionOrdersQuerySchema,
  productionOrderListItemSchema,
  type ListProductionOrdersQuery,
} from '../../data/validators'
import {
  buildProductionOrderFilters,
  PRODUCTION_ORDER_LIST_FIELDS,
  PRODUCTION_ORDER_SORT_FIELD_MAP,
  toProductionOrderListItem,
} from './listQuery'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.manage'] },
}

const createdOrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
})

const crud = makeCrudRoute<unknown, unknown, ListProductionOrdersQuery>({
  metadata,
  orm: {
    entity: ProductionOrder,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.manufacturing.production_order },
  list: {
    schema: listProductionOrdersQuerySchema,
    entityId: E.manufacturing.production_order,
    fields: PRODUCTION_ORDER_LIST_FIELDS,
    sortFieldMap: PRODUCTION_ORDER_SORT_FIELD_MAP,
    defaultSort: { field: 'createdAt', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query) => buildProductionOrderFilters(query),
    transformItem: toProductionOrderListItem,
  },
  actions: {
    create: {
      commandId: CREATE_PRODUCTION_ORDER_COMMAND_ID,
      schema: createProductionOrderSchema,
      response: ({ result }: { result: CreateProductionOrderResult }) => ({
        id: result.orderId,
        orderNumber: result.orderNumber,
      }),
      status: 201,
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST

const rejectionSchema = z.object({
  error: z.string(),
  code: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})

const listResponseSchema = z.object({
  items: z.array(productionOrderListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Production orders',
  methods: {
    GET: {
      summary: 'List production orders',
      description: 'Returns production orders of the selected organization, searchable by number and filterable by product variant, status and due date.',
      query: listProductionOrdersQuerySchema,
      responses: [{ status: 200, description: 'Paginated production orders', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Create production order',
      description: 'Creates a draft production order on a released, available BOM revision and assigns its number.',
      requestBody: { schema: createProductionOrderSchema },
      responses: [{ status: 201, description: 'Production order created', schema: createdOrderSchema }],
      errors: [{ status: 422, description: 'The order breaks a creation rule', schema: rejectionSchema }],
    },
  },
}
