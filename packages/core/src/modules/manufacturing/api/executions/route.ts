import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { E } from '#generated/entities.ids.generated'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  CREATE_PRODUCTION_EXECUTION_COMMAND_ID,
  type CreateProductionExecutionResult,
} from '../../commands/productionExecutions'
import { ProductionExecution } from '../../data/entities'
import { attachOrderDetails } from '../../data/listDetails'
import {
  createProductionExecutionSchema,
  listProductionExecutionsQuerySchema,
  productionExecutionListItemSchema,
  type ListProductionExecutionsQuery,
  type ProductionExecutionListItem,
} from '../../data/validators'
import { resolveManufacturingApiScope } from '../../lib/manufacturingApiScope'
import {
  buildProductionExecutionFilters,
  PRODUCTION_EXECUTION_LIST_FIELDS,
  PRODUCTION_EXECUTION_SORT_FIELD_MAP,
  toProductionExecutionListItem,
} from './listQuery'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.execution.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.execution.manage'] },
}

const createdExecutionSchema = z.object({
  id: z.string().uuid(),
  executionNumber: z.string(),
})

const crud = makeCrudRoute<unknown, unknown, ListProductionExecutionsQuery>({
  metadata,
  orm: {
    entity: ProductionExecution,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.manufacturing.production_execution },
  list: {
    schema: listProductionExecutionsQuerySchema,
    entityId: E.manufacturing.production_execution,
    fields: PRODUCTION_EXECUTION_LIST_FIELDS,
    sortFieldMap: PRODUCTION_EXECUTION_SORT_FIELD_MAP,
    defaultSort: { field: 'createdAt', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query) => buildProductionExecutionFilters(query),
    transformItem: toProductionExecutionListItem,
  },
  hooks: {
    afterList: async (payload: { items: ProductionExecutionListItem[] }, ctx) => {
      const scope = await resolveManufacturingApiScope(ctx)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      payload.items = await attachOrderDetails(em, payload.items, scope)
    },
  },
  actions: {
    create: {
      commandId: CREATE_PRODUCTION_EXECUTION_COMMAND_ID,
      schema: createProductionExecutionSchema,
      response: ({ result }: { result: CreateProductionExecutionResult }) => ({
        id: result.executionId,
        executionNumber: result.executionNumber,
      }),
      status: 201,
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST

const listResponseSchema = z.object({
  items: z.array(productionExecutionListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

const rejectionSchema = z.object({
  error: z.string(),
  code: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Production executions',
  methods: {
    GET: {
      summary: 'List production executions',
      description: 'Returns production executions with the production order context when an execution belongs to an order.',
      query: listProductionExecutionsQuerySchema,
      responses: [{ status: 200, description: 'Paginated production executions', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Create production execution',
      description: 'Creates an execution for a production order, or a standalone execution with its own product and locations.',
      requestBody: { schema: createProductionExecutionSchema },
      responses: [{ status: 201, description: 'Production execution created', schema: createdExecutionSchema }],
      errors: [{ status: 422, description: 'The execution breaks a creation rule', schema: rejectionSchema }],
    },
  },
}
