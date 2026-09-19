import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

type AuthenticatedRoute = { scope: { tenantId: string; organizationId: string; userId: string } }
type RouteFailure = { response: Response }
type GuardResult = Awaited<ReturnType<typeof runRouteMutationGuards>>
type PreparedMutation = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  ctx: CommandRuntimeContext
  guardResult: Extract<GuardResult, { ok: true }>
}

export const routeAuthSchema = {
  async resolve(req: Request): Promise<AuthenticatedRoute | RouteFailure> {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth.sub) return { response: Response.json({ error: 'Unauthorized' }, { status: 401 }) as Response }
    if (!auth.orgId) return { response: Response.json({ error: 'Organization scope required' }, { status: 400 }) as Response }
    return { scope: { tenantId: auth.tenantId, organizationId: auth.orgId, userId: String(auth.sub) } }
  },
}

export async function createMutationContext(
  req: Request,
  resourceKind: string,
  operation: 'create' | 'update' | 'custom',
  mutationPayload: Record<string, unknown>,
  resourceId?: string,
): Promise<PreparedMutation | RouteFailure> {
  const resolved = await routeAuthSchema.resolve(req)
  if ('response' in resolved) return resolved
  const container = await createRequestContainer()
  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: {
      userId: resolved.scope.userId,
      tenantId: resolved.scope.tenantId,
      organizationId: resolved.scope.organizationId,
    },
    input: { resourceKind, resourceId: resourceId ?? null, operation, mutationPayload },
  })
  if (!guardResult.ok) return { response: guardResult.response }
  const ctx: CommandRuntimeContext = {
    container,
    auth: {
      sub: resolved.scope.userId,
      tenantId: resolved.scope.tenantId,
      orgId: resolved.scope.organizationId,
    },
    organizationScope: {
      selectedId: resolved.scope.organizationId,
      filterIds: [resolved.scope.organizationId],
      allowedIds: [resolved.scope.organizationId],
      tenantId: resolved.scope.tenantId,
    },
    selectedOrganizationId: resolved.scope.organizationId,
    organizationIds: [resolved.scope.organizationId],
    request: req,
    systemActor: false,
  }
  return { container, ctx, guardResult }
}

export async function readBody(req: Request): Promise<unknown> {
  return readJsonSafe(req)
}

export function commandErrorResponse(error: unknown): Response {
  if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
  return Response.json({ error: 'Request failed' }, { status: 500 })
}

export function responseFromCommand(result: { result: unknown }, status: number): Response {
  return Response.json(result.result, { status })
}
