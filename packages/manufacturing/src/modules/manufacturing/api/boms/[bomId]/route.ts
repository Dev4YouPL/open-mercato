import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { z } from 'zod'
import { updateBomSchema } from '../../../data/validators'
import {
  bomDetailSchema,
  bomMutationResultSchema,
  bomDeleteResultSchema,
  bomDomainErrorSchema,
  optimisticLockConflictSchema,
  expectedVersionHeaderSchema,
  validationErrorSchema,
} from '../../openapi'
import { loadActiveDraft, loadDirectLineSummaries, emptyDirectLineSummary } from '../../../lib/bom/repository'
import type { UpdateBomCommandInput, DeleteBomCommandInput } from '../../../commands/boms'
import {
  resolveBomRequestContext,
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  readExpectedUpdatedAt,
  operationHeaders,
  toErrorResponse,
} from '../../../lib/bom/route-context'
import { toBomDetailDto, toBomMutationResultDto } from '../../../lib/bom/dto'
import { loadCatalogLabels } from '../../../lib/bom/catalog-enrichment'
import { readBomCustomFields } from '../../../lib/bom/custom-fields'

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
  const summaries = await loadDirectLineSummaries(em, { tenantId, organizationId, revisionIds: [active.revision.id] })
  const summary = summaries.get(active.revision.id) ?? emptyDirectLineSummary
  const labels = await loadCatalogLabels(ctx.container, { tenantId, organizationId }, [
    { productId: active.bom.productId, variantId: active.bom.variantId ?? null },
  ])
  const customFields = await readBomCustomFields(em, { tenantId, organizationId }, active.bom.id)
  return Response.json(toBomDetailDto(active.bom, active.revision, summary, labels, customFields))
}

export async function PUT(req: Request, routeContext: RouteContext): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context
  const params = idParamSchema.safeParse(await routeContext.params)
  if (!params.success) return Response.json({ error: 'validation_error' }, { status: 400 })

  const body = await readJsonSafe(req, null)
  const parsed = updateBomSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom' as const,
    resourceId: params.data.bomId,
    operation: 'update' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, mutationPayload: parsed.data as unknown as Record<string, unknown> })
  if (guard.blocked) return guard.blocked
  const effective = reparseGuardPayload(updateBomSchema, parsed.data, guard.modifiedPayload)
  if (!effective.ok) return effective.response

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: UpdateBomCommandInput = {
      tenantId,
      organizationId,
      bomId: params.data.bomId,
      expectedUpdatedAt: readExpectedUpdatedAt(req),
      target: effective.data.target,
      draft: effective.data.draft,
      customFields: effective.data.customFields,
    }
    const { result, logEntry } = await commandBus.execute<UpdateBomCommandInput, { bom: import('../../../data/entities').ManufacturingBom; revision: import('../../../data/entities').ManufacturingBomRevision }>(
      'manufacturing.bom.update',
      { input, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, guardInput)
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

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom' as const,
    resourceId: params.data.bomId,
    operation: 'delete' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, mutationPayload: {} })
  if (guard.blocked) return guard.blocked

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const input: DeleteBomCommandInput = { tenantId, organizationId, bomId: params.data.bomId, expectedUpdatedAt: readExpectedUpdatedAt(req) }
    const { result, logEntry } = await commandBus.execute<DeleteBomCommandInput, { bomId: string; revisionId: string; deletedAt: Date }>(
      'manufacturing.bom.delete',
      { input, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, guardInput)
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
      pathParams: idParamSchema,
      responses: [{ status: 200, description: 'BOM detail.', mediaType: 'application/json', schema: bomDetailSchema }],
      errors: [{ status: 401, description: 'Unauthenticated caller.' }, { status: 404, description: 'BOM not found.' }],
    },
    PUT: {
      operationId: 'manufacturingUpdateBom',
      summary: "Update a draft's target and/or header (label, base output).",
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      requestBody: { schema: updateBomSchema, contentType: 'application/json' },
      responses: [{ status: 200, description: 'Updated BOM detail.', mediaType: 'application/json', schema: bomMutationResultSchema }],
      errors: [
        { status: 400, description: 'Malformed body or path parameter.', schema: validationErrorSchema },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale expected-version token, target conflict, or cycle detected.', schema: optimisticLockConflictSchema },
        { status: 422, description: 'Invalid quantity/UoM evidence, or a mutation guard rejected the write.', schema: bomDomainErrorSchema },
      ],
    },
    DELETE: {
      operationId: 'manufacturingDeleteBom',
      summary: 'Soft-delete the BOM family, its active draft, and its lines atomically.',
      pathParams: idParamSchema,
      headers: expectedVersionHeaderSchema,
      responses: [{ status: 200, description: 'Deletion result.', mediaType: 'application/json', schema: bomDeleteResultSchema }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 404, description: 'BOM not found.' },
        { status: 409, description: 'Stale expected-version token.', schema: optimisticLockConflictSchema },
      ],
    },
  },
}
