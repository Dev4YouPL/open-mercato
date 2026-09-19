import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { APPLY_SOURCING_DECISION_COMMAND_ID, type SourcingDecisionResult } from '../../../commands/sourcing'
import { initialOptionIdSchema } from '../../../data/initial-impact'
import type { SupplyCasesStore } from '../../../data/repositories'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['supply_cases.decisions.apply'] },
}

const bodySchema = z.object({
  proposalId: z.string().min(1),
  factsHash: z.string().min(1),
  kind: z.enum(['SELECT', 'REJECT', 'EDIT']),
  selectedOptionId: initialOptionIdSchema.nullable(),
  reason: z.string().trim().min(1).nullable(),
  idempotencyKey: z.string().min(1),
}).strict()

export const openApi: OpenApiRouteDoc = {
  tag: 'Supply Cases',
  summary: 'Apply an initial sourcing decision',
  pathParams: z.object({ id: z.string().min(1) }),
  methods: {
    POST: {
      summary: 'Apply a guarded sourcing decision',
      tags: ['Supply Cases'],
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Decision accepted.', schema: z.object({ status: z.string(), caseId: z.string() }).passthrough() }],
      errors: [
        { status: 400, description: 'Invalid decision.', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Decision permission required.', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'The case or proposal changed.', schema: z.object({ error: z.string() }).passthrough() },
        { status: 428, description: 'Optimistic-lock version required.', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!auth.orgId) return Response.json({ error: 'organization_scope_required' }, { status: 400 })
  const expectedUpdatedAt = request.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)?.trim()
  if (!expectedUpdatedAt) return Response.json({ error: 'optimistic_lock_required' }, { status: 428 })

  try {
    const id = z.string().min(1).parse(context.params.id)
    const input = bodySchema.parse(await request.json())
    const container = await createRequestContainer()
    const commandBus = container.resolve<CommandBus>('commandBus')
    const commandContext: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      systemActor: false,
    }
    const { result } = await commandBus.execute<Record<string, unknown>, SourcingDecisionResult>(
      APPLY_SOURCING_DECISION_COMMAND_ID,
      { input: { caseId: id, expectedUpdatedAt, ...input }, ctx: commandContext },
    )
    return Response.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'invalid_sourcing_decision' }, { status: 400 })
    if (isCrudHttpError(error)) {
      if (error.status === 409) {
        const container = await createRequestContainer()
        const store = container.resolve<SupplyCasesStore>('supplyCasesStore')
        const current = await store.supplyCases.findById(
          { tenantId: auth.tenantId, organizationId: auth.orgId },
          context.params.id,
        )
        return Response.json({
          ...error.body,
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
          currentUpdatedAt: current?.updatedAt ?? expectedUpdatedAt,
          expectedUpdatedAt,
        }, { status: 409 })
      }
      return Response.json(error.body, { status: error.status })
    }
    return Response.json({ error: 'internal_error' }, { status: 500 })
  }
}
