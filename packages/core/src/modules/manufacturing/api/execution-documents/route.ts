import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { E } from '#generated/entities.ids.generated'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ExecutionDocument } from '../../data/entities'
import { attachDocumentDetails } from '../../data/listDetails'
import {
  executionDocumentListItemSchema,
  listExecutionDocumentsQuerySchema,
  type ExecutionDocumentListItem,
  type ListExecutionDocumentsQuery,
} from '../../data/validators'
import { resolveManufacturingApiScope } from '../../lib/manufacturingApiScope'
import { buildExecutionDocumentFilters, EXECUTION_DOCUMENT_LIST_FIELDS, toExecutionDocumentListItem } from './listQuery'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.execution.view'] },
}

const crud = makeCrudRoute<unknown, unknown, ListExecutionDocumentsQuery>({
  metadata,
  orm: {
    entity: ExecutionDocument,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listExecutionDocumentsQuerySchema,
    entityId: E.manufacturing.execution_document,
    fields: EXECUTION_DOCUMENT_LIST_FIELDS,
    sortFieldMap: { postedAt: 'posted_at' },
    defaultSort: { field: 'postedAt', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query) => buildExecutionDocumentFilters(query),
    transformItem: toExecutionDocumentListItem,
  },
  hooks: {
    afterList: async (payload: { items: ExecutionDocumentListItem[] }, ctx) => {
      const scope = await resolveManufacturingApiScope(ctx)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      payload.items = await attachDocumentDetails(em, payload.items, scope)
    },
  },
})

export const GET = crud.GET

const listResponseSchema = z.object({
  items: z.array(executionDocumentListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Execution documents',
  methods: {
    GET: {
      summary: 'List execution documents',
      description: 'Returns posted execution documents with their production facts, WMS movement correlation and reversal links.',
      query: listExecutionDocumentsQuerySchema,
      responses: [{ status: 200, description: 'Execution documents in posting order', schema: listResponseSchema }],
    },
  },
}
