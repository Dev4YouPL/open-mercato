import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { RESUME_EXECUTION_OPERATION_COMMAND_ID, type ExecutionOperationResult } from '../../commands/productionExecutions'
import { ManufacturingOperation } from '../../data/entities'
import { executionOperationResultSchema, resumeExecutionOperationSchema } from '../../data/validators'
import { EXECUTION_OPERATION_ERRORS } from '../executionOperationErrors'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['manufacturing.execution.manage'] },
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
      commandId: RESUME_EXECUTION_OPERATION_COMMAND_ID,
      schema: resumeExecutionOperationSchema,
      response: ({ result }: { result: ExecutionOperationResult }) => result,
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Operation resumptions',
  methods: {
    POST: {
      summary: 'Retry an operation by id',
      description:
        'Finishes an operation whose inventory result is unknown, using the movement stored with it. A finished operation returns its stored outcome.',
      requestBody: { schema: resumeExecutionOperationSchema },
      responses: [{ status: 201, description: 'Operation posted', schema: executionOperationResultSchema }],
      errors: EXECUTION_OPERATION_ERRORS,
    },
  },
}
