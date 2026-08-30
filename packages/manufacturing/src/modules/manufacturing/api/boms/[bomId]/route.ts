import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { z } from 'zod'
import { updateBomSchema } from '../../../data/validators'
import { loadActiveDraft } from '../../../lib/bom/repository'
import { ManufacturingBomLine } from '../../../data/entities'
import type { UpdateBomCommandInput, DeleteBomCommandInput } from '../../../commands/boms'
import { resolveBomRequestContext, runBomMutationGuards, readExpectedUpdatedAt, operationHeaders, toErrorResponse } from '../../../lib/bom/route-context'
import { toBomDetailDto, toBomMutationResultDto } from '../../../lib/bom/dto'
import { loadCatalogLabels } from '../../../lib/bom/catalog-enrichment'

const idParamSchema = z.object({ bomId: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.bom.view'] },
  PUT: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
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

  const em = ctx.container.resolve<EntityManager>('em')
  const active = await loadActiveDraft(em, { tenantId, organizationId, bomId: params.data.bomId })
  if (!active) return Response.json({ error: 'not_found' }, { status: 404 })
  const lineCount = await em.count(ManufacturingBomLine, { revision: active.revision.id, deletedAt: null })
  const unresolvedProduceCount = await em.count(ManufacturingBomLine, {
    revision: active.revision.id,
    deletedAt: null,
    supplyMode: 'produce',
  })
  const labels = await loadCatalogLabels(ctx.container, { tenantId, organizationId }, [
    { productId: active.bom.productId, variantId: active.bom.variantId ?? null },
  ])
  return Response.json(toBomDetailDto(active.bom, active.revision, { count: lineCount, unresolvedProduceCount }, labels))
}

export async function PUT(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsed = updateBomSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardResponse = await runBomMutationGuards(ctx, {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom',
    resourceId: params.data.bomId,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  })
  if (guardResponse) return guardResponse

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: UpdateBomCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      target: parsed.data.target,
      draft: parsed.data.draft,
    }
    const { result, logEntry } = await commandBus.execute<UpdateBomCommandInput, { bom: import('../../../data/entities').ManufacturingBom; revision: import('../../../data/entities').ManufacturingBomRevision }>(
      'manufacturing.bom.update',
      { input, ctx },
    )
    return Response.json(toBomMutationResultDto(result.bom, result.revision), { headers: operationHeaders(logEntry) })
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

  const guardResponse = await runBomMutationGuards(ctx, {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom',
    resourceId: params.data.bomId,
    operation: 'delete',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: {},
  })
  if (guardResponse) return guardResponse

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: DeleteBomCommandInput = { tenantId, organizationId, bomId: params.data.bomId, expectedUpdatedAt: readExpectedUpdatedAt(req) }
    const { result, logEntry } = await commandBus.execute<DeleteBomCommandInput, { bomId: string; revisionId: string; deletedAt: Date }>(
      'manufacturing.bom.delete',
      { input, ctx },
    )
    return Response.json(
      { id: result.bomId, deletedAt: result.deletedAt.toISOString(), updatedAt: result.deletedAt.toISOString() },
      { headers: operationHeaders(logEntry) },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'A single BOM family and its active draft',
  methods: {
    GET: {
      operationId: 'manufacturingGetBom',
      summary: 'Fetch a BOM family, its active draft header, target enrichment, and direct-line summary.',
      responses: [{ status: 200, description: 'BOM detail.', mediaType: 'application/json' }],
      errors: [{ status: 401, description: 'Unauthenticated caller.' }, { status: 404, description: 'BOM not found.' }],
    },
    PUT: {
      operationId: 'manufacturingUpdateBom',
      summary: "Update a draft's target and/or header (label, base output).",
      responses: [{ status: 200, description: 'Updated BOM detail.', mediaType: 'application/json' }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale expected-version token, target conflict, or cycle detected.' },
        { status: 422, description: 'Invalid quantity/UoM evidence.' },
      ],
    },
    DELETE: {
      operationId: 'manufacturingDeleteBom',
      summary: 'Soft-delete the BOM family, its active draft, and its lines atomically.',
      responses: [{ status: 200, description: 'Deletion result.', mediaType: 'application/json' }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale expected-version token.' },
      ],
    },
  },
}
