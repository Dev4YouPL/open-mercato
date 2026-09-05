import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { z } from 'zod'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { BomDomainError } from './errors'

const logger = createLogger('manufacturing')

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

export type BomGuardInput = Omit<MutationGuardInput, 'requestMethod' | 'requestHeaders'> & {
  requestMethod: string
  requestHeaders: Headers
}

export type BomGuardAfterCallback = { guard: MutationGuard; metadata: Record<string, unknown> | null }

export type BomGuardOutcome = {
  /** Non-null when a guard rejected the mutation; return it unchanged. */
  blocked: Response | null
  /** The payload after guard transforms, present only when a guard changed it. */
  modifiedPayload: Record<string, unknown> | null
  /** Deferred post-success hooks. Run them only after the command commits. */
  callbacks: BomGuardAfterCallback[]
}

/**
 * Runs the registered mutation guards for one BOM write.
 *
 * The platform contract has three halves and a route must honour all of them
 * (spec "Custom routes"): a rejection short-circuits, a transformed payload
 * reaches the command *re-validated*, and `afterSuccess` fires only once the
 * write has actually committed and a real resource ID exists. This helper
 * therefore never runs the callbacks itself — see
 * `runBomMutationGuardCallbacks`.
 */
export async function runBomMutationGuards(
  ctx: CommandRuntimeContext,
  input: BomGuardInput,
): Promise<BomGuardOutcome> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
  const result = await runMutationGuards(guards, input, { userFeatures: resolveUserFeatures(ctx) })
  if (!result.ok) {
    return {
      blocked: Response.json(result.errorBody ?? { error: 'Blocked' }, { status: result.errorStatus ?? 422 }),
      modifiedPayload: null,
      callbacks: [],
    }
  }
  return {
    blocked: null,
    modifiedPayload: result.modifiedPayload ?? null,
    callbacks: result.afterSuccessCallbacks ?? [],
  }
}

/**
 * Re-validates a guard-transformed payload against the same schema the raw
 * request body was parsed with, so a guard can never smuggle a shape the
 * command was never designed to accept. A guard that produces an invalid
 * payload is a server-side fault, hence 422 rather than 400.
 */
export function reparseGuardPayload<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  parsed: z.infer<TSchema>,
  modifiedPayload: Record<string, unknown> | null,
): { ok: true; data: z.infer<TSchema> } | { ok: false; response: Response } {
  if (!modifiedPayload) return { ok: true, data: parsed }
  const reparsed = schema.safeParse(modifiedPayload)
  if (!reparsed.success) {
    return {
      ok: false,
      response: Response.json(
        { error: 'guard_payload_invalid', code: 'guard_payload_invalid', issues: reparsed.error.issues },
        { status: 422 },
      ),
    }
  }
  return { ok: true, data: reparsed.data }
}

/**
 * Post-commit guard hooks. Called with the committed resource's real ID —
 * which on create only exists after the command returns. A hook failure is
 * logged and swallowed: the write is already durable, so failing the response
 * would invite a duplicate retry.
 */
export async function runBomMutationGuardCallbacks(
  callbacks: BomGuardAfterCallback[],
  input: Omit<BomGuardInput, 'resourceId' | 'mutationPayload'> & { resourceId: string },
): Promise<void> {
  for (const { guard, metadata } of callbacks) {
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
    } catch (error) {
      logger.error('Manufacturing mutation guard afterSuccess failed', {
        guardId: guard.id,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        operation: input.operation,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
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
  logger.error('Unhandled manufacturing BOM route error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  return Response.json({ error: '[internal] Unexpected manufacturing error' }, { status: 500 })
}
