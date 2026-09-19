import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const retryBodySchema = z.object({ updatedAt: z.string().datetime() })
export const retryResponseSchema = z.object({ caseId: z.string().uuid(), status: z.string() })
export const reportDisruptionBodySchema = z.object({
  salesOrderId: z.string().uuid(),
  availableQuantity: z.number().int().min(0),
})
export const reportDisruptionResponseSchema = z.object({ caseId: z.string().uuid(), status: z.string() })
const errorSchema = z.object({ error: z.string(), code: z.string().optional() })

export const retryOpenApi: OpenApiRouteDoc = {
  tag: 'Supplier Demo',
  summary: 'Retry a failed supply case proposal',
  methods: {
    POST: {
      summary: 'Retry a supply case',
      requestBody: { schema: retryBodySchema },
      responses: [{ status: 202, description: 'Retry queued', schema: retryResponseSchema }],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Manage permission required', schema: errorSchema },
        { status: 404, description: 'Supply case not found', schema: errorSchema },
        { status: 409, description: 'Supply case version conflict', schema: errorSchema },
        { status: 422, description: 'Supply case is not retryable', schema: errorSchema },
      ],
    } satisfies OpenApiMethodDoc,
  },
}

export const reportDisruptionOpenApi: OpenApiRouteDoc = {
  tag: 'Supplier Demo',
  summary: 'Report a manual supply disruption',
  methods: {
    POST: {
      summary: 'Open a supply case from a manual disruption report',
      requestBody: { schema: reportDisruptionBodySchema },
      responses: [{ status: 201, description: 'Supply case opened', schema: reportDisruptionResponseSchema }],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Manage permission required', schema: errorSchema },
        { status: 404, description: 'Sales order not found in scope', schema: errorSchema },
        { status: 409, description: 'Supply case already exists', schema: errorSchema },
        { status: 422, description: 'Disruption cannot be reported for this order', schema: errorSchema },
      ],
    } satisfies OpenApiMethodDoc,
  },
}
