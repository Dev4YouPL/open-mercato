import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { WorkCenterDomainError, type WorkCenterErrorCode } from './errors'
import type { WorkCenterScope } from './repository'

export const WORK_CENTER_RESOURCE_KIND = 'manufacturing.work_center'
export const WORK_CENTER_MANAGE_FEATURE = 'manufacturing.work_center.manage'

type RbacService = {
  userHasAllFeatures?: (
    userId: string,
    features: string[],
    scope: { tenantId?: string | null; organizationId?: string | null },
  ) => Promise<boolean> | boolean
}

export function requireWorkCenterScope(
  ctx: CommandRuntimeContext,
  input: { tenantId?: string | null; organizationId?: string | null },
): WorkCenterScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new WorkCenterDomainError('work_center_not_found', { reason: 'missing_scope' })
  }
  return { tenantId, organizationId }
}

export function forkEntityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

/**
 * Undo and redo run through the audit-log endpoints, whose own features gate
 * only the log. Work Centre state may not change unless the caller *currently*
 * holds Manufacturing manage in the target scope, so every reversal re-checks
 * it here before writing — audit-log access never inherits the mutation grant.
 */
export async function assertCurrentManageGrant(
  container: AwilixContainer,
  actorId: string | null,
  scope: WorkCenterScope,
  failureCode: Extract<WorkCenterErrorCode, 'work_center_undo_forbidden' | 'work_center_redo_forbidden'>,
): Promise<void> {
  if (!actorId) throw new WorkCenterDomainError(failureCode, { reason: 'missing_actor' })
  let rbacService: RbacService | null
  try {
    rbacService = container.resolve<RbacService>('rbacService')
  } catch {
    rbacService = null
  }
  if (!rbacService || typeof rbacService.userHasAllFeatures !== 'function') {
    throw new WorkCenterDomainError(failureCode, { reason: 'rbac_service_unavailable' })
  }
  let granted: boolean
  try {
    granted = await rbacService.userHasAllFeatures(actorId, [WORK_CENTER_MANAGE_FEATURE], scope)
  } catch {
    throw new WorkCenterDomainError(failureCode, { reason: 'rbac_check_failed' })
  }
  if (!granted) throw new WorkCenterDomainError(failureCode, { reason: 'feature_missing' })
}

/**
 * Version an undo or redo writes.
 *
 * Deliberately derived from the version it is reverting rather than from the
 * wall clock: `CommandHandler.undo` returns void and the CommandBus's undo
 * trace only swaps the original snapshots, so it never records what the undo
 * actually wrote. A redo therefore has to be able to *predict* the exact
 * version its preceding undo produced in order to prove the record is still in
 * that state — a scalar-only comparison would accept an unrelated
 * update-and-revert. One millisecond past the reverted version keeps the token
 * strictly increasing while staying fully deterministic.
 */
export function reversalVersion(revertedFrom: Date | string): Date {
  const base = revertedFrom instanceof Date ? revertedFrom.getTime() : new Date(revertedFrom).getTime()
  return new Date(base + 1)
}
