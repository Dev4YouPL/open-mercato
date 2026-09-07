import type { AwilixContainer } from 'awilix'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  RESOURCES_RESOURCE_ENTITY_ID,
  RESOURCES_VIEW_FEATURE,
  WORK_CENTER_RESOURCE_LIMIT,
} from './entity-ids'
import { WorkCenterDomainError } from './errors'

const logger = createLogger('manufacturing').child({ component: 'work-center-resources' })

type RbacService = {
  userHasAllFeatures?: (
    userId: string,
    features: string[],
    scope: { tenantId?: string | null; organizationId?: string | null },
  ) => Promise<boolean> | boolean
}

export type ResourceLookupScope = {
  tenantId: string
  organizationId: string
  actorId: string | null
}

type ResourceRow = { id?: unknown; is_active?: unknown }

/**
 * Resolves the generated entity id of the optional `resources` peer.
 *
 * `getEntityIds(false)` returns an empty registry rather than throwing when
 * the host has not registered one, so an absent or unregistered peer is
 * indistinguishable here from "module not enabled" — both mean the provider is
 * unavailable, which is exactly the contract.
 */
function resolveResourcesEntityId(): string | null {
  let registry: Record<string, Record<string, string>>
  try {
    registry = getEntityIds(false)
  } catch {
    return null
  }
  const id = registry?.resources?.resources_resource
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Validates a changed Work Centre membership set against the optional
 * `resources` peer.
 *
 * The call order is fixed by the spec and is security-relevant: provider
 * presence, then the caller's own `resources.view` grant, and only then a
 * scoped query. An empty target set therefore still costs an authorization
 * check — removing every member is a membership change like any other — but
 * performs no resource-id query, because there is nothing to validate.
 *
 * Every failure mode maps to a stable code and fails closed: an absent peer, a
 * missing or broken RBAC service and a failed query all become
 * `optional_provider_unavailable`, never a guessed or partially-validated
 * membership. Callers must not invoke this for an omitted or unchanged set.
 */
export async function resolveOptionalResourceReferences(
  container: AwilixContainer,
  resourceIds: readonly string[],
  scope: ResourceLookupScope,
): Promise<void> {
  const entityId = resolveResourcesEntityId()
  if (!entityId) {
    logger.warn('Resources provider unavailable for membership change', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reason: 'entity_id_unresolved',
    })
    throw new WorkCenterDomainError('optional_provider_unavailable', { reason: 'entity_id_unresolved' })
  }

  await assertResourceViewGranted(container, scope)

  // Authorization is required for every change, but an empty resulting set has
  // no reference left to validate.
  if (resourceIds.length === 0) return

  let queryEngine: QueryEngine
  try {
    queryEngine = container.resolve<QueryEngine>('queryEngine')
  } catch {
    throw new WorkCenterDomainError('optional_provider_unavailable', { reason: 'query_engine_unavailable' })
  }

  let items: ResourceRow[]
  try {
    const result = await queryEngine.query<ResourceRow>(entityId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      fields: ['id', 'is_active'],
      filters: { id: { $in: [...resourceIds] } },
      withDeleted: false,
      page: { page: 1, pageSize: WORK_CENTER_RESOURCE_LIMIT },
    })
    items = Array.isArray(result?.items) ? result.items : []
  } catch (error) {
    logger.error('Scoped resource lookup failed', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      requestedCount: resourceIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new WorkCenterDomainError('optional_provider_unavailable', { reason: 'query_failed' })
  }

  const activeById = new Map<string, boolean>()
  for (const item of items) {
    if (typeof item?.id === 'string') activeById.set(item.id, item.is_active !== false)
  }

  for (const resourceId of resourceIds) {
    // A soft-deleted row is excluded by `withDeleted: false`, so it is
    // indistinguishable from a foreign or missing one — the non-disclosing
    // contract the spec requires.
    if (!activeById.has(resourceId)) {
      throw new WorkCenterDomainError('resource_not_found', { resourceId })
    }
    if (activeById.get(resourceId) === false) {
      throw new WorkCenterDomainError('resource_inactive', { resourceId })
    }
  }
}

/**
 * `resources.view` is the peer's own published feature; Manufacturing never
 * grants it. A missing actor or a negative answer is a forbidden lookup, while
 * an unusable RBAC service degrades to provider-unavailable rather than to an
 * unauthorized read. Wildcard grants stay valid because the check goes through
 * the canonical service.
 */
async function assertResourceViewGranted(
  container: AwilixContainer,
  scope: ResourceLookupScope,
): Promise<void> {
  if (!scope.actorId) throw new WorkCenterDomainError('resource_lookup_forbidden', { reason: 'missing_actor' })

  let rbacService: RbacService | null
  try {
    rbacService = container.resolve<RbacService>('rbacService')
  } catch {
    rbacService = null
  }
  if (!rbacService || typeof rbacService.userHasAllFeatures !== 'function') {
    throw new WorkCenterDomainError('optional_provider_unavailable', { reason: 'rbac_service_unavailable' })
  }

  let granted: boolean
  try {
    granted = await rbacService.userHasAllFeatures(scope.actorId, [RESOURCES_VIEW_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    logger.error('Resource view authorization check failed', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new WorkCenterDomainError('optional_provider_unavailable', { reason: 'rbac_check_failed' })
  }

  if (!granted) throw new WorkCenterDomainError('resource_lookup_forbidden', { reason: 'feature_missing' })
}

export { RESOURCES_RESOURCE_ENTITY_ID }
