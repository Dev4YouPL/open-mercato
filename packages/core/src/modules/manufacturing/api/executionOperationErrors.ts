import { z } from 'zod'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'

export const EXECUTION_OPERATION_ERRORS: OpenApiResponseDoc[] = [
  {
    status: 422,
    description: 'Known rejection by Manufacturing or WMS; stored durably for this operationId',
    schema: z.object({ error: z.string(), code: z.string() }),
  },
  {
    status: 409,
    description: 'An earlier operation of the same kind on this execution has an unknown result',
    schema: z.object({ error: z.string(), code: z.literal('operation_blocked'), blockingOperationId: z.string().uuid() }),
  },
  {
    status: 503,
    description: 'The inventory result is unknown; retry with the same operationId',
    schema: z.object({ error: z.string(), code: z.literal('operation_outcome_unknown'), operationId: z.string().uuid() }),
  },
]
