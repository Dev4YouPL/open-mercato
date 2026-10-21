import { z } from 'zod'
import { E } from '#generated/entities.ids.generated'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { RECORD_EXECUTION_OPERATION_COMMAND_ID, type ExecutionOperationResult } from '../../commands/productionExecutions'
import { ManufacturingOperation } from '../../data/entities'
import {
  executionOperationListItemSchema,
  executionOperationResultSchema,
  listExecutionOperationsQuerySchema,
  recordExecutionOperationSchema,
  type ListExecutionOperationsQuery,
} from '../../data/validators'
import { EXECUTION_OPERATION_ERRORS } from '../executionOperationErrors'
import { buildExecutionOperationFilters, EXECUTION_OPERATION_LIST_FIELDS, toExecutionOperationListItem } from './listQuery'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.execution.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.execution.manage'] },
}

const crud = makeCrudRoute<unknown, unknown, ListExecutionOperationsQuery>({
  metadata,
  orm: {
    entity: ManufacturingOperation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listExecutionOperationsQuerySchema,
    entityId: E.manufacturing.manufacturing_operation,
    fields: EXECUTION_OPERATION_LIST_FIELDS,
    sortFieldMap: { createdAt: 'created_at' },
    defaultSort: { field: 'createdAt', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query) => buildExecutionOperationFilters(query),
    transformItem: toExecutionOperationListItem,
  },
  actions: {
    create: {
      commandId: RECORD_EXECUTION_OPERATION_COMMAND_ID,
      schema: recordExecutionOperationSchema,
      response: ({ result }: { result: ExecutionOperationResult }) => result,
      status: 201,
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST

const listResponseSchema = z.object({
  items: z.array(executionOperationListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Execution operations',
  methods: {
    GET: {
      summary: 'List execution operations',
      description: 'Returns operations of an execution; with unresolved=true only operations still in progress or with an unknown result.',
      query: listExecutionOperationsQuerySchema,
      responses: [{ status: 200, description: 'Execution operations', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Record an execution operation',
      description:
        'Issues material, returns material or confirms production on an execution. Idempotent per operationId: retrying with the same id and payload returns the stored outcome.',
      requestBody: { schema: recordExecutionOperationSchema },
      responses: [{ status: 201, description: 'Operation posted', schema: executionOperationResultSchema }],
      errors: EXECUTION_OPERATION_ERRORS,
    },
  },
}
