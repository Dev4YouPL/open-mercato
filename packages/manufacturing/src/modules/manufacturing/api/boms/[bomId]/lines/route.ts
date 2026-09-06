import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import { listBomLinesQuerySchema, bomLineInputSchema } from '../../../../data/validators'
import {
  bomLineListResponseSchema,
  bomLineMutationResultSchema,
  bomDomainErrorSchema,
  optimisticLockConflictSchema,
  expectedVersionHeaderSchema,
  validationErrorSchema,
} from '../../../openapi'
import { loadActiveDraft, listLines } from '../../../../lib/bom/repository'
import { componentTargetKey, resolveComponentTarget, resolveComponentTargets } from '../../../../lib/bom/target-resolution'
import type { CreateLineCommandInput } from '../../../../commands/bomLines'
import {
  resolveBomRequestContext,
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  readExpectedUpdatedAt,
  operationHeaders,
  toErrorResponse,
} from '../../../../lib/bom/route-context'
import { toBomLineDto, toBomLineMutationResultDto } from '../../../../lib/bom/dto'
import { loadCatalogLabels } from '../../../../lib/bom/catalog-enrichment'
import type { ManufacturingBomLine, ManufacturingBomRevision } from '../../../../data/entities'

const idParamSchema = z.object({ bomId: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.bom.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
}

interface RouteContext {
  params: Promise<{ bomId: string }>
}

export async function GET(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const url = new URL(req.url)
  const parsed = listBomLinesQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  })
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const em = ctx.container.resolve<EntityManager>('em')
  const active = await loadActiveDraft(em, { tenantId, organizationId, bomId: params.data.bomId })
  if (!active) return Response.json({ error: 'not_found' }, { status: 404 })

  const page = await listLines(em, {
    tenantId,
    organizationId,
    bomId: params.data.bomId,
    revisionId: active.revision.id,
    revisionUpdatedAt: active.revision.updatedAt,
    limit: parsed.data.limit ?? 50,
    cursorToken: parsed.data.cursor,
  })
  if (page.staleCursor) {
    return Response.json({ error: 'bom.version_conflict', code: 'bom.version_conflict' }, { status: 409 })
  }

  const labels = await loadCatalogLabels(
    ctx.container,
    { tenantId, organizationId },
    page.items.map((line) => ({ productId: line.componentProductId, variantId: line.componentVariantId ?? null })),
  )
  const produceLines = page.items.filter((line) => line.supplyMode !== 'stock')
  const resolutions = await resolveComponentTargets(em, {
    tenantId,
    organizationId,
    targets: produceLines.map((line) => ({
      componentProductId: line.componentProductId,
      componentVariantId: line.componentVariantId ?? null,
    })),
  })
  const items = page.items.map((line) => {
    if (line.supplyMode === 'stock') return toBomLineDto(line, { state: 'stock_leaf' }, labels)
    const key = componentTargetKey({
      componentProductId: line.componentProductId,
      componentVariantId: line.componentVariantId ?? null,
    })
    return toBomLineDto(line, resolutions.get(key) ?? { state: 'unresolved' }, labels)
  })

  return Response.json({ items, nextCursor: page.nextCursor, hasMore: page.hasMore, snapshotUpdatedAt: active.revision.updatedAt.toISOString() })
}

export async function POST(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const body = await readJsonSafe(req, null)
  const parsed = bomLineInputSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom_line' as const,
    operation: 'create' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, resourceId: null, mutationPayload: parsed.data as unknown as Record<string, unknown> })
  if (guard.blocked) return guard.blocked
  const effective = reparseGuardPayload(bomLineInputSchema, parsed.data, guard.modifiedPayload)
  if (!effective.ok) return effective.response

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: CreateLineCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      line: effective.data,
    }
    const { result, logEntry } = await commandBus.execute<CreateLineCommandInput, { line: ManufacturingBomLine; revision: ManufacturingBomRevision }>(
      'manufacturing.bom_line.create',
      { input, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, { ...guardInput, resourceId: result.line.id })
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
      { status: 201, headers: operationHeaders(logEntry) },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Direct component occurrences of a BOM draft',
  methods: {
    GET: {
      operationId: 'manufacturingListBomLines',
      summary: 'List direct component occurrences of the active draft (keyset pagination bound to the revision token).',
      pathParams: idParamSchema,
      query: listBomLinesQuerySchema,
      responses: [{ status: 200, description: 'Paged line list.', mediaType: 'application/json', schema: bomLineListResponseSchema }],
      errors: [
        { status: 400, description: 'Malformed query or path parameter.', schema: validationErrorSchema },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale line cursor after an aggregate mutation.', schema: bomDomainErrorSchema },
      ],
    },
    POST: {
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      requestBody: { schema: bomLineInputSchema, contentType: 'application/json' },
      operationId: 'manufacturingCreateBomLine',
      summary: 'Append one direct component occurrence to the active draft.',
      responses: [{ status: 201, description: 'Created line.', mediaType: 'application/json', schema: bomLineMutationResultSchema }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale expected-version token or cycle detected.' },
        { status: 422, description: 'Invalid quantity/UoM evidence.' },
      ],
    },
  },
}
