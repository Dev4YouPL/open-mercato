import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  supplyCaseDetailResponseSchema,
  supplyCaseListQuerySchema,
  supplyCaseListResponseSchema,
} from '../data/read-model'
import {
  activityActorTypeSchema,
  activityKindSchema,
  activityParamsSchema,
  activityStatusSchema,
} from '../data/activity'

export const supplyCasesTag = 'Supply Cases'

export const supplyCasesErrorSchema = z.object({
  error: z.string(),
})

const listDoc: OpenApiMethodDoc = {
  summary: 'List scoped supply cases',
  description: 'Returns a paginated operational queue with derived plan coverage.',
  tags: [supplyCasesTag],
  query: supplyCaseListQuerySchema,
  responses: [
    { status: 200, description: 'Supply case queue.', schema: supplyCaseListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid filters or organization scope.', schema: supplyCasesErrorSchema },
    { status: 401, description: 'Authentication required.', schema: supplyCasesErrorSchema },
    { status: 403, description: 'Supply case access denied.', schema: supplyCasesErrorSchema },
    { status: 500, description: 'Unexpected server error.', schema: supplyCasesErrorSchema },
  ],
}

const detailDoc: OpenApiMethodDoc = {
  summary: 'Read a scoped supply case',
  description: 'Returns a safe operational projection of a supply case and its related records.',
  tags: [supplyCasesTag],
  responses: [
    { status: 200, description: 'Supply case detail.', schema: supplyCaseDetailResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Organization scope is required.', schema: supplyCasesErrorSchema },
    { status: 401, description: 'Authentication required.', schema: supplyCasesErrorSchema },
    { status: 403, description: 'Supply case access denied.', schema: supplyCasesErrorSchema },
    { status: 404, description: 'Supply case not found in the current scope.', schema: supplyCasesErrorSchema },
    { status: 500, description: 'Unexpected server error.', schema: supplyCasesErrorSchema },
  ],
}

export const listOpenApi: OpenApiRouteDoc = {
  tag: supplyCasesTag,
  summary: 'Supply case queue',
  methods: { GET: listDoc },
}

export const detailOpenApi: OpenApiRouteDoc = {
  tag: supplyCasesTag,
  summary: 'Supply case detail',
  pathParams: z.object({ id: z.string().min(1) }),
  methods: { GET: detailDoc },
}

const activityItemSchema = z.object({
  id: z.string(),
  caseId: z.string().nullable(),
  caseCorrelationId: z.string().nullable(),
  kind: activityKindSchema,
  status: activityStatusSchema,
  actorType: activityActorTypeSchema,
  titleKey: z.string(),
  detailKey: z.string().nullable(),
  params: activityParamsSchema,
  occurredAt: z.string(),
  recordedAt: z.string(),
  groupKey: z.string().nullable(),
  isStale: z.boolean(),
  evidence: z.object({ type: z.enum(['inbound_message', 'case', 'workflow']), href: z.string() }).nullable(),
  technicalDetail: z.object({ type: z.enum(['workflow_instance', 'agent_run']), href: z.string() }).nullable(),
})

export const activityOpenApi: OpenApiRouteDoc = {
  tag: supplyCasesTag,
  summary: 'Read human-readable supply activity',
  methods: {
    GET: {
      summary: 'Read scoped activity entries',
      description: 'Returns durable business activity for the selected organization or one supply case.',
      tags: [supplyCasesTag],
      query: z.object({
        caseId: z.string().min(1).max(200).optional(),
        cursor: z.string().min(1).max(512).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      responses: [
        { status: 200, description: 'Scoped activity page.', schema: z.object({ items: z.array(activityItemSchema), nextCursor: z.string().nullable(), asOf: z.string() }) },
      ],
      errors: [
        { status: 400, description: 'Invalid query or organization scope.', schema: supplyCasesErrorSchema },
        { status: 401, description: 'Authentication required.', schema: supplyCasesErrorSchema },
        { status: 403, description: 'Supply case access denied.', schema: supplyCasesErrorSchema },
        { status: 404, description: 'Supply case not found in the current scope.', schema: supplyCasesErrorSchema },
        { status: 500, description: 'Unexpected server error.', schema: supplyCasesErrorSchema },
      ],
    },
  },
}
