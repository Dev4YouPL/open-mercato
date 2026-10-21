import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { BomRevisionUsageFact } from '../domain/bomDeletion'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import { ProductionOrder } from './entities'

function familyLockKey(scope: ManufacturingScope, outputVariantId: string): string {
  return `manufacturing.bom_family:${scope.tenantId}:${scope.organizationId}:${outputVariantId.toLowerCase()}`
}

export async function lockBomFamilies(
  em: EntityManager,
  scope: ManufacturingScope,
  outputVariantIds: readonly string[],
): Promise<void> {
  if (!em.isInTransaction()) throw new Error('[internal] BOM family lock requires an open transaction')
  const keys = [...new Set(outputVariantIds.map((id) => familyLockKey(scope, id)))].sort()
  for (const key of keys) await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [key])
}

export function lockBomFamily(em: EntityManager, scope: ManufacturingScope, outputVariantId: string): Promise<void> {
  return lockBomFamilies(em, scope, [outputVariantId])
}

type IsolationRow = { level: string }

export async function assertReadCommitted(em: EntityManager): Promise<void> {
  const rows = await em.execute<IsolationRow[]>(`select current_setting('transaction_isolation') as level`, [], 'all')
  if (rows[0]?.level !== 'read committed') {
    throw new Error(`[internal] BOM usage check requires READ COMMITTED, got ${String(rows[0]?.level)}`)
  }
}

export async function loadBomFamilyUsages(
  em: EntityManager,
  scope: ManufacturingScope,
  _outputVariantId: string,
  familyRevisions: ReadonlyMap<string, string>,
): Promise<BomRevisionUsageFact[]> {
  if (familyRevisions.size === 0) return []
  const orders = await findWithDecryption(
    em,
    ProductionOrder,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      bomRevisionId: { $in: [...familyRevisions.keys()] },
    },
    { fields: ['id', 'bomRevisionId', 'orderNumber', 'createdAt'], orderBy: { createdAt: 'asc', id: 'asc' }, refresh: true },
    scope,
  )
  return orders.map((order) => ({
    bomId: order.bomRevisionId,
    revision: familyRevisions.get(order.bomRevisionId) ?? '',
    sourceKind: 'production_order',
    sourceId: order.id,
    sourceNumber: order.orderNumber,
    firstUsedAt: order.createdAt,
  }))
}
