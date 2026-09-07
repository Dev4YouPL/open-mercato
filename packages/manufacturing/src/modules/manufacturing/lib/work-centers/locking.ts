import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'

/**
 * Per-aggregate PostgreSQL transaction advisory lock.
 *
 * Deliberately keyed by tenant + organization + Work Centre UUID rather than
 * the organization-wide key BOM uses: Work Centres are independent aggregates,
 * so two edits to different Work Centres must not serialize on one lock. Every
 * update, delete, undo and redo takes it inside the write transaction, before
 * the fresh scoped read that feeds the optimistic-lock comparison.
 *
 * Fail-closed: a lock or database failure aborts the command (no catch here).
 */
export async function acquireWorkCenterLock(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  workCenterId: string,
): Promise<void> {
  const db = em.getKysely()
  const key = `manufacturing:work-center:${tenantId}:${organizationId}:${workCenterId}`
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(db)
}
