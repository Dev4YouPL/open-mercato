import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export function resolveManufacturingScope(ctx: CommandRuntimeContext, errorMessage: string): ManufacturingScope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId

  if (!tenantId || !organizationId) throw forbidden(errorMessage)

  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)

  return { tenantId, organizationId }
}
