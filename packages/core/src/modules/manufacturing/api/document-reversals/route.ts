import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { REVERSE_EXECUTION_DOCUMENT_COMMAND_ID, type ExecutionOperationResult } from '../../commands/productionExecutions'
import { ManufacturingOperation } from '../../data/entities'
import { executionOperationResultSchema, reverseExecutionDocumentSchema } from '../../data/validators'
import { EXECUTION_OPERATION_ERRORS } from '../executionOperationErrors'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['manufacturing.corrections.manage'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: ManufacturingOperation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  actions: {
    create: {
      commandId: REVERSE_EXECUTION_DOCUMENT_COMMAND_ID,
      schema: reverseExecutionDocumentSchema,
      response: ({ result }: { result: ExecutionOperationResult }) => result,
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Document reversals',
  methods: {
    POST: {
      summary: 'Reverse an execution document',
      description:
        'Posts the opposite document from the snapshot of the source document. A document can be reversed once. Idempotent per operationId.',
      requestBody: { schema: reverseExecutionDocumentSchema },
      responses: [{ status: 201, description: 'Reversal posted', schema: executionOperationResultSchema }],
      errors: EXECUTION_OPERATION_ERRORS,
    },
  },
}
