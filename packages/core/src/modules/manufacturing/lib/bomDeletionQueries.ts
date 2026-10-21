import { createHash } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { BomDeletionDecision, BomRevisionUsageFact } from '../domain/bomDeletion'
import { decideBomDeletion, decideRevisionDeletion } from '../domain/bomDeletion'
import type { BomScope } from './bomValidation'
import { ManufacturingBom, ManufacturingBomItem } from '../data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadBomFamilyUsages } from '../data/bomUsageReader'
import { loadCatalogVariantSummaries } from './catalogVariants'

export const MAX_REPORTED_USAGES = 5
const SOURCE_KIND_FEATURES = { production_order: ['manufacturing.view'] } as const

export type BomFamilyRevision = {
  id: string
  revision: string
  status: 'draft' | 'released'
  updatedAt: Date
  itemCount: number
}

export async function loadBomFamilyRevisions(
  em: EntityManager,
  scope: BomScope,
  outputVariantId: string,
  options: { lock: boolean },
): Promise<{ active: ManufacturingBom[]; allRevisions: Map<string, string> }> {
  const all = await findWithDecryption(em, ManufacturingBom, {
    tenantId: scope.tenantId, organizationId: scope.organizationId, outputVariantId,
  }, { fields: ['id', 'revision'], refresh: true }, scope)
  const active = await findWithDecryption(em, ManufacturingBom, {
    tenantId: scope.tenantId, organizationId: scope.organizationId, outputVariantId, deletedAt: null,
  }, {
    orderBy: { id: 'asc' }, refresh: true,
    ...(options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
  }, scope)
  return { active, allRevisions: new Map(all.map((row) => [row.id, row.revision])) }
}

export async function loadActiveItemsForBoms(
  em: EntityManager,
  scope: BomScope,
  bomIds: readonly string[],
): Promise<Map<string, ManufacturingBomItem[]>> {
  const result = new Map<string, ManufacturingBomItem[]>(bomIds.map((id) => [id, []]))
  if (!bomIds.length) return result
  const items = await findWithDecryption(em, ManufacturingBomItem, {
    bom: { $in: bomIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null,
  }, { orderBy: { position: 'asc', id: 'asc' }, refresh: true }, scope)
  for (const item of items) {
    const list = result.get(item.bom.id)
    if (list) list.push(item)
  }
  return result
}

export function buildBomDeletionVersion(
  revisions: ReadonlyArray<{ id: string; updatedAt: Date }>,
  itemsByBom: ReadonlyMap<string, ReadonlyArray<{ id: string; updatedAt: Date }>>,
): string {
  const lines = revisions.flatMap((revision) => [
    `r:${revision.id.toLowerCase()}:${revision.updatedAt.toISOString()}`,
    ...(itemsByBom.get(revision.id) ?? []).map((item) => `i:${revision.id.toLowerCase()}:${item.id.toLowerCase()}:${item.updatedAt.toISOString()}`),
  ])
  lines.sort()
  return `v1:${createHash('sha256').update(lines.join('\n')).digest('hex')}`
}

export async function toReportedUsages(container: AppContainer, userId: string, scope: BomScope, usages: readonly BomRevisionUsageFact[]) {
  const rbac = container.resolve<{ userHasAllFeatures(userId: string, features: readonly string[], scope: BomScope): Promise<boolean> }>('rbacService')
  const canViewOrders = userId ? await rbac.userHasAllFeatures(userId, SOURCE_KIND_FEATURES.production_order, scope) : false
  return {
    totalUsages: usages.length,
    usages: usages.slice(0, MAX_REPORTED_USAGES).map((usage) => ({
      bomId: usage.bomId, revision: usage.revision, sourceKind: usage.sourceKind,
      sourceNumber: canViewOrders ? usage.sourceNumber : null,
    })),
  }
}

export type BomDeletionPreviewResult = {
  outputVariant: { id: string; name: string | null; sku: string | null } | null
  revision: BomFamilyRevision
  revisions: BomFamilyRevision[]
  revisionVersion: string
  bomVersion: string
  revisionDeletion: { allowed: boolean; reason: string | null; totalUsages: number; usages: Awaited<ReturnType<typeof toReportedUsages>>['usages'] }
  bomDeletion: { allowed: boolean; reason: string | null; totalUsages: number; usages: Awaited<ReturnType<typeof toReportedUsages>>['usages'] }
}

function decisionSummary(decision: BomDeletionDecision, reported: Awaited<ReturnType<typeof toReportedUsages>>) {
  return { allowed: decision.status === 'allowed', reason: decision.status === 'blocked' ? decision.reason : null, ...reported }
}

export async function loadBomDeletionPreview(em: EntityManager, container: AppContainer, userId: string, scope: BomScope, revisionId: string): Promise<BomDeletionPreviewResult> {
  const target = await findWithDecryption(em, ManufacturingBom, {
    id: revisionId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null,
  }, { refresh: true }, scope).then((rows) => rows[0])
  if (!target) throw new Error('[internal] manufacturing.bom.unavailable')
  const family = await loadBomFamilyRevisions(em, scope, target.outputVariantId, { lock: false })
  const active = family.active
  const items = await loadActiveItemsForBoms(em, scope, active.map((row) => row.id))
  const revisions = active.map((row) => ({ id: row.id, revision: row.revision, status: row.status, updatedAt: row.updatedAt, itemCount: items.get(row.id)?.length ?? 0 }))
  const revision = revisions.find((row) => row.id === target.id)
  if (!revision) throw new Error('[internal] manufacturing.bom.unavailable')
  const revisionVersion = buildBomDeletionVersion([target], new Map([[target.id, items.get(target.id) ?? []]]))
  const bomVersion = buildBomDeletionVersion(active, items)
  const usages = await loadBomFamilyUsages(em, scope as ManufacturingScope, target.outputVariantId, family.allRevisions)
  const reported = await toReportedUsages(container, userId, scope, usages)
  const revisionDecision = decideRevisionDeletion(target, usages)
  const bomDecision = decideBomDeletion(usages)
  const variants = await loadCatalogVariantSummaries(em, [target.outputVariantId], scope)
  const variant = variants.get(target.outputVariantId)
  return {
    outputVariant: variant ? { id: variant.id, name: variant.name, sku: variant.sku } : null,
    revision, revisions, revisionVersion, bomVersion,
    revisionDeletion: decisionSummary(revisionDecision, revisionDecision.status === 'blocked' ? await toReportedUsages(container, userId, scope, revisionDecision.usages) : { totalUsages: 0, usages: [] }),
    bomDeletion: decisionSummary(bomDecision, bomDecision.status === 'blocked' ? await toReportedUsages(container, userId, scope, bomDecision.usages) : { totalUsages: 0, usages: [] }),
  }
}

export async function listActiveBomRevisionIds(em: EntityManager, scope: BomScope, outputVariantId: string): Promise<string[]> {
  const rows = await findWithDecryption(em, ManufacturingBom, {
    tenantId: scope.tenantId, organizationId: scope.organizationId, outputVariantId, deletedAt: null,
  }, { fields: ['id'], refresh: true }, scope)
  return rows.map((row) => row.id)
}
