import { z } from 'zod'

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

import { resolveBomCommandScope } from './bomCommandHelpers'
import type { BomScope } from './bomValidation'

const operationLogSchema = z.object({
  id: z.string().min(1),
  commandId: z.string().min(1),
  undoToken: z.string().min(1),
  actionLabel: z.string().nullish(),
  resourceKind: z.string().nullish(),
  resourceId: z.string().nullish(),
  createdAt: z.union([z.date(), z.string()]).nullish(),
})

export async function resolveBomActionContext(
  req: Request,
  translate: (key: string) => string,
): Promise<{ container: AppContainer; ctx: CommandRuntimeContext; scope: BomScope; userId: string }> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('manufacturing.errors.unauthorized') })
  }
  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (organizationScope.selectionRejected) {
    throw new CrudHttpError(403, { error: translate('manufacturing.errors.forbidden') })
  }
  const organizationId = organizationScope.selectedId ?? auth.orgId
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('manufacturing.errors.scopeRequired') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationId,
    organizationIds: organizationScope.filterIds ?? [organizationId],
    request: req,
  }
  return {
    container,
    ctx,
    scope: resolveBomCommandScope(ctx, translate('manufacturing.errors.scopeRequired')),
    userId: auth.sub,
  }
}

export function attachOperationHeader(response: Response, logEntry: unknown): void {
  const parsed = operationLogSchema.safeParse(logEntry)
  if (!parsed.success) return
  const log = parsed.data
  const executedAt = log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt ?? new Date().toISOString()
  response.headers.set('x-om-operation', serializeOperationMetadata({
    id: log.id,
    undoToken: log.undoToken,
    commandId: log.commandId,
    actionLabel: log.actionLabel ?? null,
    resourceKind: log.resourceKind ?? null,
    resourceId: log.resourceId ?? null,
    executedAt,
  }))
}
