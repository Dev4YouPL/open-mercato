import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type RawBuilder } from 'kysely'
import { ManufacturingWorkCenter, ManufacturingWorkCenterResource } from '../../data/entities'
import { WorkCenterDomainError } from './errors'
import { normalizeResourceIds } from './membership'

export type WorkCenterScope = { tenantId: string; organizationId: string }

export async function findScopedWorkCenter(
  em: EntityManager,
  scope: WorkCenterScope,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ManufacturingWorkCenter | null> {
  const where: Record<string, unknown> = { id, ...scope }
  if (!options.includeDeleted) where.deletedAt = null
  return em.findOne(ManufacturingWorkCenter, where as never)
}

/** Sorted membership for one Work Centre, always read in the parent's scope. */
export async function loadMembership(
  em: EntityManager,
  scope: WorkCenterScope,
  workCenterId: string,
): Promise<string[]> {
  const rows = await em.find(ManufacturingWorkCenterResource, {
    workCenter: workCenterId,
    ...scope,
  } as never)
  return normalizeResourceIds(rows.map((row) => row.resourceId))
}

/**
 * Live-code uniqueness pre-check inside the already-locked transaction.
 *
 * Case-insensitive to match the partial unique index. The index is still the
 * authority for a race between two transactions; this check turns the common
 * case into a clean field-level conflict instead of a constraint violation.
 */
/**
 * Builds the live-code lookup.
 *
 * Exposed for the SQL-shape regression test: the predicate must keep matching
 * the partial unique index (`lower(code)`, `deleted_at is null`) and must never
 * become an `ON CONFLICT ON CONSTRAINT` upsert, which PostgreSQL rejects for a
 * partial index.
 */
export function buildCodeAvailabilityQuery(
  scope: WorkCenterScope,
  code: string,
  excludeId: string | null,
): RawBuilder<{ id: string }> {
  const exclusion = excludeId ? sql`and "id" <> ${excludeId}` : sql``
  return sql<{ id: string }>`
    select "id" from "manufacturing_work_centers"
    where "tenant_id" = ${scope.tenantId}
      and "organization_id" = ${scope.organizationId}
      and lower("code") = lower(${code})
      and "deleted_at" is null
      ${exclusion}
    limit 1
  `
}

export async function assertCodeAvailable(
  em: EntityManager,
  scope: WorkCenterScope,
  code: string,
  excludeId: string | null,
  conflictCode: 'work_center_code_conflict' | 'work_center_restore_code_conflict' = 'work_center_code_conflict',
): Promise<void> {
  const result = await buildCodeAvailabilityQuery(scope, code, excludeId).execute(em.getKysely())
  if (result.rows.length > 0) throw new WorkCenterDomainError(conflictCode, { code })
}

const UNIQUE_VIOLATION = '23505'

/**
 * Maps the partial unique index race to the stable conflict code.
 *
 * The index is partial, so the write must never target it with
 * `ON CONFLICT ON CONSTRAINT`; the loser of a race surfaces here instead and
 * receives the same translated contract as the pre-checked case.
 */
export function mapCodeUniqueViolation(
  error: unknown,
  conflictCode: 'work_center_code_conflict' | 'work_center_restore_code_conflict' = 'work_center_code_conflict',
): never {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown } | null
  const sqlState = typeof candidate?.code === 'string' ? candidate.code : null
  const text = `${candidate?.constraint ?? ''} ${candidate?.message ?? ''}`
  if (sqlState === UNIQUE_VIOLATION && text.includes('manufacturing_work_centers_code_unique_idx')) {
    throw new WorkCenterDomainError(conflictCode)
  }
  throw error as Error
}

/**
 * Replaces membership with `nextIds` inside the caller's transaction.
 *
 * Rows are inserted with the parent's own scope, which is what keeps a
 * membership row from ever attaching to a foreign parent, and removed rows are
 * hard-deleted because the junction carries no history of its own — the audit
 * snapshot does.
 */
export async function syncMembership(
  em: EntityManager,
  scope: WorkCenterScope,
  workCenter: ManufacturingWorkCenter,
  currentIds: readonly string[],
  nextIds: readonly string[],
): Promise<void> {
  const next = new Set(nextIds)
  const current = new Set(currentIds)
  const removed = [...current].filter((id) => !next.has(id))
  const added = [...next].filter((id) => !current.has(id))

  if (removed.length > 0) {
    const rows = await em.find(ManufacturingWorkCenterResource, {
      workCenter: workCenter.id,
      ...scope,
      resourceId: { $in: removed },
    } as never)
    for (const row of rows) em.remove(row)
  }
  for (const resourceId of added) {
    em.persist(
      em.create(ManufacturingWorkCenterResource, {
        workCenter,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        resourceId,
      }),
    )
  }
}

/**
 * One scoped batch query that groups sorted membership by parent id. Used by
 * the CRUD `afterList` hook so a page of Work Centres costs exactly one
 * membership query regardless of row count.
 */
export async function loadMembershipByWorkCenter(
  em: EntityManager,
  scope: WorkCenterScope,
  workCenterIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>()
  if (workCenterIds.length === 0) return grouped
  const rows = await em.find(ManufacturingWorkCenterResource, {
    workCenter: { $in: [...workCenterIds] },
    ...scope,
  } as never)
  for (const row of rows) {
    const parentId = (row.workCenter as unknown as { id: string })?.id ?? String(row.workCenter)
    const list = grouped.get(parentId) ?? []
    list.push(row.resourceId)
    grouped.set(parentId, list)
  }
  for (const [parentId, ids] of grouped) grouped.set(parentId, normalizeResourceIds(ids))
  return grouped
}
