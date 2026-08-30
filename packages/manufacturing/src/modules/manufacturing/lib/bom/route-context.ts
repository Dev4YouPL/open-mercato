import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { BomDomainError } from './errors'

export type BomRequestContext = {
  ctx: CommandRuntimeContext
  auth: NonNullable<AuthContext>
  tenantId: string
  organizationId: string
  userId: string
}

/**
 * Resolves auth + a concrete organization scope for a manufacturing BOM
 * route. Deliberately built on the shared-package auth/DI primitives only,
 * so this package's zero-core-import boundary holds for API routes, not
 * only for commands.
 */
export async function resolveBomRequestContext(req: Request): Promise<BomRequestContext | Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const container = await createRequestContainer()
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }
  return { ctx, auth, tenantId: auth.tenantId, organizationId, userId: auth.sub }
}

export async function runBomMutationGuards(
  ctx: CommandRuntimeContext,
  input: Omit<MutationGuardInput, 'requestMethod' | 'requestHeaders'> & { requestMethod: string; requestHeaders: Headers },
): Promise<Response | null> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
  const result = await runMutationGuards(guards, input, { userFeatures: resolveUserFeatures(ctx) })
  if (!result.ok) {
    return Response.json(result.errorBody ?? { error: 'Blocked' }, { status: result.errorStatus ?? 422 })
  }
  if (result.afterSuccessCallbacks?.length && input.resourceId) {
    for (const { guard, metadata } of result.afterSuccessCallbacks) {
      if (!guard.afterSuccess) continue
      try {
        await guard.afterSuccess({
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          userId: input.userId,
          resourceKind: input.resourceKind,
          resourceId: input.resourceId,
          operation: input.operation,
          requestMethod: input.requestMethod,
          requestHeaders: input.requestHeaders,
          metadata,
        })
      } catch {
        // committed writes still return successfully; callback failures are non-fatal
      }
    }
  }
  return null
}

function resolveUserFeatures(ctx: CommandRuntimeContext): string[] {
  const features = (ctx.auth as { features?: unknown } | null)?.features
  return Array.isArray(features) ? (features as string[]) : []
}

export function readExpectedUpdatedAt(req: Request): string | undefined {
  const value = req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)
  return value && value.trim().length > 0 ? value.trim() : undefined
}

export function operationHeaders(logEntry: { id?: string; undoToken?: string | null; commandId?: string; actionLabel?: string | null; resourceKind?: string | null; resourceId?: string | null; createdAt?: Date | string } | null | undefined): HeadersInit {
  if (!logEntry?.undoToken || !logEntry?.id || !logEntry?.commandId) return {}
  return {
    'x-om-operation': serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'manufacturing.bom',
      resourceId: logEntry.resourceId ?? null,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
    }),
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof BomDomainError) {
    return Response.json({ error: error.code, code: error.code, ...error.details }, { status: error.status })
  }
  if (error && typeof error === 'object' && 'status' in error && 'body' in error) {
    const httpError = error as { status: number; body: unknown }
    return Response.json(httpError.body, { status: httpError.status })
  }
  return Response.json({ error: '[internal] Unexpected manufacturing error' }, { status: 500 })
}
