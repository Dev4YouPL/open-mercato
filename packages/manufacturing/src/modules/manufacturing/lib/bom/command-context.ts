import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { acquireBomGraphLock } from './locking'
import { BomDomainError } from './errors'

export function requireBomScope(ctx: CommandRuntimeContext, input: { tenantId?: string | null; organizationId?: string | null }) {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new BomDomainError('bom.uom_invalid', { reason: 'missing_scope' })
  }
  return { tenantId, organizationId }
}

/**
 * Every BOM write/undo/redo runs its work inside one MikroORM transaction
 * that has already taken the organization-scoped graph advisory lock — the
 * spec's mandated lock order (see lib/bom/locking.ts). When the caller
 * supplies `ctx.transactionalEm` (composition with a surrounding operation)
 * that existing transaction is reused instead of opening a new one.
 */
export async function withBomTransaction<T>(
  ctx: CommandRuntimeContext,
  scope: { tenantId: string; organizationId: string },
  work: (em: EntityManager) => Promise<T>,
): Promise<T> {
  if (ctx.transactionalEm) {
    await acquireBomGraphLock(ctx.transactionalEm, scope.tenantId, scope.organizationId)
    return work(ctx.transactionalEm)
  }
  const rootEm = ctx.container.resolve<EntityManager>('em')
  const em = rootEm.fork()
  return em.transactional(async (tx) => {
    await acquireBomGraphLock(tx, scope.tenantId, scope.organizationId)
    return work(tx)
  })
}
