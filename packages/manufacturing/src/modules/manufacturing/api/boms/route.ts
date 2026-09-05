import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { listBomsQuerySchema, createBomSchema } from '../../data/validators'
import {
  bomListResponseSchema,
  bomMutationResultSchema,
  bomDomainErrorSchema,
  listBadRequestSchema,
  validationErrorSchema,
} from '../openapi'
import { listActiveDrafts } from '../../lib/bom/repository'
import { BomDomainError } from '../../lib/bom/errors'
import type { CreateBomCommandInput } from '../../commands/boms'
import {
  resolveBomRequestContext,
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  operationHeaders,
  toErrorResponse,
} from '../../lib/bom/route-context'
import { toBomListItemDto, toBomMutationResultDto } from '../../lib/bom/dto'
import { loadCatalogLabels } from '../../lib/bom/catalog-enrichment'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['manufacturing.bom.view'] },
  POST: { requireAuth: true, requireFeatures: ['manufacturing.bom.manage'] },
}

export async function GET(req: Request): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId } = context

  const url = new URL(req.url)
  const parsed = listBomsQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    productId: url.searchParams.get('productId') ?? undefined,
    variantId: url.searchParams.get('variantId') ?? undefined,
  })
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  try {
    const em = ctx.container.resolve<import('@mikro-orm/postgresql').EntityManager>('em')
    const page = await listActiveDrafts(em, {
      tenantId,
      organizationId,
      limit: parsed.data.limit ?? 25,
      cursorToken: parsed.data.cursor,
      productId: parsed.data.productId,
      variantId: parsed.data.variantId,
    })
    if (page.staleCursor) throw new BomDomainError('bom.cursor_invalid')
    const labels = await loadCatalogLabels(
      ctx.container,
      { tenantId, organizationId },
      page.items.map((item) => ({ productId: item.bom.productId, variantId: item.bom.variantId ?? null })),
    )
    return Response.json({
      items: page.items.map((item) => toBomListItemDto(item, labels)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(req: Request): Promise<Response> {
  const context = await resolveBomRequestContext(req)
  if (context instanceof Response) return context
  const { ctx, tenantId, organizationId, userId } = context

  const body = await readJsonSafe(req, null)
  const parsed = createBomSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardInput = {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom' as const,
    operation: 'create' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
  }
  const guard = await runBomMutationGuards(ctx, { ...guardInput, resourceId: null, mutationPayload: parsed.data as unknown as Record<string, unknown> })
  if (guard.blocked) return guard.blocked
  const effective = reparseGuardPayload(createBomSchema, parsed.data, guard.modifiedPayload)
  if (!effective.ok) return effective.response

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute<CreateBomCommandInput, { bom: import('../../data/entities').ManufacturingBom; revision: import('../../data/entities').ManufacturingBomRevision }>(
      'manufacturing.bom.create',
      { input: { tenantId, organizationId, ...effective.data }, ctx },
    )
    await runBomMutationGuardCallbacks(guard.callbacks, { ...guardInput, resourceId: result.bom.id })
    return Response.json(toBomMutationResultDto(result.bom, result.revision), {
      status: 201,
      headers: operationHeaders(logEntry),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Direct-level BOM draft families',
  methods: {
    GET: {
      operationId: 'manufacturingListBoms',
      summary: 'List direct-level BOM draft families (keyset pagination).',
      query: listBomsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Paged list of BOM families and their active draft.',
          mediaType: 'application/json',
          schema: bomListResponseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 400, description: 'Missing organization scope, an invalid query, or a rejected cursor. Carries either the validation-error shape or the domain-error shape with code bom.cursor_invalid.', schema: listBadRequestSchema },
      ],
    },
    POST: {
      operationId: 'manufacturingCreateBom',
      summary: 'Create a BOM family and its first editable draft (revision 1) atomically.',
      requestBody: { schema: createBomSchema, contentType: 'application/json' },
      responses: [
        {
          status: 201,
          description: 'Created family and draft revision.',
          mediaType: 'application/json',
          schema: bomMutationResultSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Malformed body.', schema: validationErrorSchema },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 409, description: 'Exact live family target already exists.', schema: bomDomainErrorSchema },
        { status: 422, description: 'Invalid quantity/UoM evidence, or a mutation guard rejected the write.', schema: bomDomainErrorSchema },
      ],
    },
  },
}
