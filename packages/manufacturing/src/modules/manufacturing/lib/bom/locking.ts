import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'

/**
 * Organization-scoped PostgreSQL transaction advisory lock. Every BOM
 * write/undo/redo takes this before reading or mutating rows because family
 * changes can rebind variant-fallback edges even without touching a line.
 * Fail-closed: a lock/database failure aborts the command (no catch here).
 */
export async function acquireBomGraphLock(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  const db = em.getKysely()
  const key = `manufacturing:bom-graph:${tenantId}:${organizationId}`
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(db)
}
