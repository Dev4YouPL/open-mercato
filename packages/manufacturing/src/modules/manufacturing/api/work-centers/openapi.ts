import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'
import { workCenterErrorCodeSchema } from '../../lib/work-centers/errors'

/** The canonical application response — camelCase in both list and detail reads. */
export const workCenterResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  resourceIds: z
    .array(z.string().uuid())
    .describe('Deterministically sorted scalar resource ids. At most 100; never resource names or state.'),
  resourceCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string().describe('ISO-8601 optimistic-lock version. Membership-only changes advance it.'),
})

/** Stable Work Centre error envelope: localized `error`, machine-readable `code`. */
export const workCenterErrorSchema = z.object({
  error: z.string(),
  code: workCenterErrorCodeSchema,
})

export const workCenterListResponseSchema = createSharedPagedListResponseSchema(workCenterResponseSchema, {
  paginationMetaOptional: true,
})

export const workCenterCreateResponseSchema = z.object({ id: z.string().uuid() })

const buildManufacturingCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Manufacturing',
  defaultCreateResponseSchema: workCenterCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated tenant and organization.`,
})

export function createWorkCenterOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildManufacturingCrudOpenApi(options)
}

export { defaultOkResponseSchema }
