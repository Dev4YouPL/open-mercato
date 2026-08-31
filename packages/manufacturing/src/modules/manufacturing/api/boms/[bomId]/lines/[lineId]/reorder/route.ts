import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import { reorderLineSchema } from '../../../../../../data/validators'
import type { ReorderLineCommandInput } from '../../../../../../commands/bomLines'
import { resolveBomRequestContext, runBomMutationGuards, readExpectedUpdatedAt, operationHeaders, toErrorResponse } from '../../../../../../lib/bom/route-context'
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

  const guardResponse = await runBomMutationGuards(ctx, {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom_line',
    resourceId: params.data.lineId,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  })
  if (guardResponse) return guardResponse

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: ReorderLineCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      lineId: params.data.lineId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      direction: parsed.data.direction,
    }
    const { result, logEntry } = await commandBus.execute<
      ReorderLineCommandInput,
      { line: ManufacturingBomLine; adjacentLine: ManufacturingBomLine | null; revision: ManufacturingBomRevision; changed: boolean }
    >('manufacturing.bom_line.reorder', { input, ctx })

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
      responses: [{ status: 200, description: 'Reorder result.', mediaType: 'application/json' }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'Line not found.' },
        { status: 409, description: 'Stale expected-version token or exhausted position space.' },
      ],
    },
  },
}
