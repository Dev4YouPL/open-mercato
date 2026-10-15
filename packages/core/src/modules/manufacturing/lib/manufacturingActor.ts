import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export type ManufacturingActor = {
  scope: ManufacturingScope
  userId: string
}

export function resolveManufacturingActor(ctx: CommandRuntimeContext, organizationId: string): ManufacturingActor {
  const tenantId = ctx.auth?.tenantId
  const userId = ctx.auth?.sub

  if (!tenantId || !userId) {
    throw new Error('[internal] Manufacturing operations require an authenticated tenant user in the command context')
  }
  
  return { scope: { tenantId, organizationId }, userId }
}
