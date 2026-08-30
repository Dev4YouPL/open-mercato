import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { listBomsQuerySchema, createBomSchema } from '../../data/validators'
import { listActiveDrafts } from '../../lib/bom/repository'
import type { CreateBomCommandInput } from '../../commands/boms'
import { resolveBomRequestContext, runBomMutationGuards, operationHeaders, toErrorResponse } from '../../lib/bom/route-context'
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

  const body = await req.json().catch(() => null)
  const parsed = createBomSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'validation_error', issues: parsed.error.issues }, { status: 400 })

  const guardResponse = await runBomMutationGuards(ctx, {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'manufacturing.bom',
    resourceId: null,
    operation: 'create',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  })
  if (guardResponse) return guardResponse

  try {
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute<CreateBomCommandInput, { bom: import('../../data/entities').ManufacturingBom; revision: import('../../data/entities').ManufacturingBomRevision }>(
      'manufacturing.bom.create',
      { input: { tenantId, organizationId, ...parsed.data }, ctx },
    )
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
      responses: [{ status: 200, description: 'Paged list of BOM families and their active draft.', mediaType: 'application/json' }],
      errors: [{ status: 401, description: 'Unauthenticated caller.' }, { status: 400, description: 'Missing organization scope.' }],
    },
    POST: {
      operationId: 'manufacturingCreateBom',
      summary: 'Create a BOM family and its first editable draft (revision 1) atomically.',
      responses: [{ status: 201, description: 'Created family and draft revision.', mediaType: 'application/json' }],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks manufacturing.bom.manage.' },
        { status: 409, description: 'Exact live family target already exists.' },
        { status: 422, description: 'Invalid quantity/UoM evidence.' },
      ],
    },
  },
}
