import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import { bomLinePatchSchema } from '../../../../../data/validators'
import {
  bomLineMutationResultSchema,
  bomLineDeleteResultSchema,
  bomDomainErrorSchema,
  optimisticLockConflictSchema,
  expectedVersionHeaderSchema,
  validationErrorSchema,
} from '../../../../openapi'
import { resolveComponentTarget } from '../../../../../lib/bom/target-resolution'
import type { UpdateLineCommandInput, DeleteLineCommandInput } from '../../../../../commands/bomLines'
import {
  resolveBomRequestContext,
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  readExpectedUpdatedAt,
  operationHeaders,
  toErrorResponse,
} from '../../../../../lib/bom/route-context'
import { toBomLineMutationResultDto } from '../../../../../lib/bom/dto'
import type { ManufacturingBomLine, ManufacturingBomRevision } from '../../../../../data/entities'

const idParamSchema = z.object({ bomId: z.string().uuid(), lineId: z.string().uuid() })

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
}

interface RouteContext {
  params: Promise<{ bomId: string; lineId: string }>
}

export async function PUT(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const body = await readJsonSafe(req, null)
  const parsed = bomLinePatchSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: 'validation_error', issues: ['empty_update'] }, { status: 400 })
  }

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
  const effective = reparseGuardPayload(bomLinePatchSchema, parsed.data, guard.modifiedPayload)
  if (!effective.ok) return effective.response

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: UpdateLineCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      lineId: params.data.lineId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      ...effective.data,
    }
    const { result, logEntry } = await commandBus.execute<UpdateLineCommandInput, { line: ManufacturingBomLine; revision: ManufacturingBomRevision }>(
      'manufacturing.bom_line.update',
      { input, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, guardInput)
    const resolution =
      result.line.supplyMode === 'stock'
        ? ({ state: 'stock_leaf' } as const)
        : await resolveComponentTarget(ctx.container.resolve<EntityManager>('em'), {
            tenantId,
            organizationId,
            componentProductId: result.line.componentProductId,
            componentVariantId: result.line.componentVariantId,
          })
    return Response.json(
      toBomLineMutationResultDto(result.line, resolution, result.revision.updatedAt),
      { headers: operationHeaders(logEntry) },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom_line' as const,
    resourceId: params.data.lineId,
    operation: 'delete' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, mutationPayload: {} })
  if (guard.blocked) return guard.blocked

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: DeleteLineCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      lineId: params.data.lineId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
    }
    const { result, logEntry } = await commandBus.execute<DeleteLineCommandInput, { lineId: string; revision: ManufacturingBomRevision }>(
      'manufacturing.bom_line.delete',
      { input, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, guardInput)
    return Response.json(
      { lineId: result.lineId, deletedAt: result.revision.updatedAt.toISOString(), updatedAt: result.revision.updatedAt.toISOString() },
      { headers: operationHeaders(logEntry) },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'A single BOM direct component occurrence',
  methods: {
    PUT: {
      operationId: 'manufacturingUpdateBomLine',
      summary: 'Change one direct occurrence (component, quantity, basis, yield, or supply mode).',
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      requestBody: { schema: bomLinePatchSchema, contentType: 'application/json' },
      responses: [{ status: 200, description: 'Updated line.', mediaType: 'application/json', schema: bomLineMutationResultSchema }],
      errors: [
        { status: 400, description: 'Malformed body, empty patch, or bad path parameter.', schema: validationErrorSchema },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'Line not found.' },
        { status: 409, description: 'Stale expected-version token or cycle detected.', schema: optimisticLockConflictSchema },
        { status: 422, description: 'Invalid quantity/UoM evidence, or a mutation guard rejected the write.', schema: bomDomainErrorSchema },
      ],
    },
    DELETE: {
      operationId: 'manufacturingDeleteBomLine',
      summary: 'Delete one exact occurrence.',
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      responses: [{ status: 200, description: 'Deletion result.', mediaType: 'application/json', schema: bomLineDeleteResultSchema }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'Line not found.' },
        { status: 409, description: 'Stale expected-version token.', schema: optimisticLockConflictSchema },
      ],
    },
  },
}
