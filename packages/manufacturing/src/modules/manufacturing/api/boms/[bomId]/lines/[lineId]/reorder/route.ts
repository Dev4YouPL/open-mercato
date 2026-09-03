import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import { reorderLineSchema } from '../../../../../../data/validators'
import {
  bomLineReorderResultSchema,
  bomDomainErrorSchema,
  optimisticLockConflictSchema,
  expectedVersionHeaderSchema,
  validationErrorSchema,
} from '../../../../../openapi'
import type { ReorderLineCommandInput } from '../../../../../../commands/bomLines'
import {
  resolveBomRequestContext,
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  readExpectedUpdatedAt,
  operationHeaders,
  toErrorResponse,
} from '../../../../../../lib/bom/route-context'
import type { ManufacturingBomLine, ManufacturingBomRevision } from '../../../../../../data/entities'

const idParamSchema = z.object({ bomId: z.string().uuid(), lineId: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
}

interface RouteContext {
  params: Promise<{ bomId: string; lineId: string }>
}

export async function POST(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const body = await readJsonSafe(req, null)
  const parsed = reorderLineSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom_line' as const,
    resourceId: params.data.lineId,
    operation: 'update' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, mutationPayload: parsed.data as unknown as Record<string, unknown> })
  if (guard.blocked) return guard.blocked
  const effective = reparseGuardPayload(reorderLineSchema, parsed.data, guard.modifiedPayload)
  if (!effective.ok) return effective.response

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: ReorderLineCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      lineId: params.data.lineId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      direction: effective.data.direction,
    }
    const { result, logEntry } = await commandBus.execute<
      ReorderLineCommandInput,
      { line: ManufacturingBomLine; adjacentLine: ManufacturingBomLine | null; revision: ManufacturingBomRevision; changed: boolean }
    >('manufacturing.bom_line.reorder', { input, ctx })

    if (result.changed) await runBomMutationGuardCallbacks(guard.callbacks, guardInput)
    return Response.json(
      {
        line: { id: result.line.id, position: Number(result.line.position) },
        adjacentLine: result.adjacentLine ? { id: result.adjacentLine.id, position: Number(result.adjacentLine.position) } : null,
        updatedAt: result.revision.updatedAt.toISOString(),
        changed: result.changed,
      },
      { headers: result.changed ? operationHeaders(logEntry) : {} },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Move one BOM line up or down',
  methods: {
    POST: {
      operationId: 'manufacturingReorderBomLine',
      summary: 'Swap the selected line with its adjacent live line. A boundary no-op returns changed:false without logging an undoable action.',
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      requestBody: { schema: reorderLineSchema, contentType: 'application/json' },
      responses: [{ status: 200, description: 'Reorder result.', mediaType: 'application/json', schema: bomLineReorderResultSchema }],
      errors: [
        { status: 400, description: 'Malformed body or path parameter.', schema: validationErrorSchema },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'Line not found.' },
        { status: 409, description: 'Stale expected-version token or exhausted position space.', schema: optimisticLockConflictSchema },
        { status: 422, description: 'A mutation guard rejected the write.', schema: bomDomainErrorSchema },
      ],
    },
  },
}
