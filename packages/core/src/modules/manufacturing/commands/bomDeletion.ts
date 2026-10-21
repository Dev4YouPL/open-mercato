import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import { decideBomDeletion, decideRevisionDeletion } from '../domain/bomDeletion'
import { assertReadCommitted, loadBomFamilyUsages, lockBomFamily } from '../data/bomUsageReader'
import { ManufacturingBom, ManufacturingBomItem } from '../data/entities'
import type { BomDeleteAllInput, BomDeleteInput } from '../data/validators'
import { bomDeleteAllSchema, bomDeleteSchema } from '../data/validators'
import { loadActiveBomItems, requireLockedBom, resolveBomCommandScope } from '../lib/bomCommandHelpers'
import { buildBomDeletionVersion, loadActiveItemsForBoms, loadBomFamilyRevisions, toReportedUsages } from '../lib/bomDeletionQueries'
import { runBomCommitEffects } from '../lib/bomCommitEffects'
import { snapshotBom, bomCrudEvents, bomCrudIndexer, bomItemCrudEvents, bomItemCrudIndexer } from './booms'

type Translate = (key: string) => string
type Result = { bomId: string } | { outputVariantId: string; deletedBomIds: string[] }
const snapshots = new WeakMap<object, { before: unknown; after: null }>()

function staleError(translate: Translate) {
  return new CrudHttpError(409, { error: translate('manufacturing.errors.bomChangedRefresh'), code: 'manufacturing.bom_delete.stale' })
}

async function blockedError(ctx: CommandRuntimeContext, scope: ManufacturingScope, decision: Exclude<ReturnType<typeof decideRevisionDeletion>, { status: 'allowed' }>, translate: Translate) {
  const reported = await toReportedUsages(ctx.container, ctx.auth?.sub ?? '', scope, decision.usages)
  return new CrudHttpError(409, {
    error: translate(decision.reason === 'revision_used' ? 'manufacturing.errors.bomDeleteRevisionUsed' : 'manufacturing.errors.bomDeleteBomUsed'),
    code: `manufacturing.bom_delete.${decision.reason}`,
    ...reported,
  })
}

function softDelete(bom: ManufacturingBom, items: ManufacturingBomItem[], now: Date) {
  bom.deletedAt = now
  bom.updatedAt = now
  for (const item of items) {
    item.deletedAt = now
    item.updatedAt = now
  }
}

async function runEffects(em: EntityManager, ctx: CommandRuntimeContext, boms: ManufacturingBom[], items: ManufacturingBomItem[][]) {
  const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
  await runBomCommitEffects(em, async () => {
    for (let index = 0; index < boms.length; index += 1) {
      const bom = boms[index]
      await emitCrudSideEffects({ dataEngine, action: 'deleted', entity: bom, identifiers: { id: bom.id, tenantId: bom.tenantId, organizationId: bom.organizationId }, events: bomCrudEvents, indexer: bomCrudIndexer })
      for (const item of items[index] ?? []) {
        await emitCrudSideEffects({ dataEngine, action: 'deleted', entity: item, identifiers: { id: item.id, tenantId: item.tenantId, organizationId: item.organizationId }, events: bomItemCrudEvents, indexer: bomItemCrudIndexer })
      }
    }
  })
}

async function deleteRevision(input: BomDeleteInput, ctx: CommandRuntimeContext) {
  const { translate } = await resolveTranslations()
  const scope = resolveBomCommandScope(ctx, translate('manufacturing.errors.scopeRequired'))
  const em = ctx.transactionalEm ?? ctx.container.resolve<EntityManager>('em').fork()
  let bom!: ManufacturingBom
  let items: ManufacturingBomItem[] = []
  let before: unknown = null
  await withAtomicFlush(em, [async () => {
    await assertReadCommitted(em)
    const initial = await findWithDecryption(em, ManufacturingBom, { id: input.id, ...scope, deletedAt: null }, { refresh: true }, scope).then((rows) => rows[0])
    if (!initial) throw notFound(translate('manufacturing.errors.bomUnavailable'))
    const initialVariantId = initial.outputVariantId
    await lockBomFamily(em, scope, initialVariantId)
    bom = await requireLockedBom(em, input.id, scope, translate)
    if (bom.outputVariantId !== initialVariantId) throw staleError(translate)
    await enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind: 'manufacturing.bom', resourceId: bom.id, current: bom.updatedAt, request: ctx.request })
    items = await loadActiveBomItems(em, bom.id, scope)
    if (input.expectedVersion && buildBomDeletionVersion([bom], new Map([[bom.id, items]])) !== input.expectedVersion) throw staleError(translate)
    const family = await loadBomFamilyRevisions(em, scope, initialVariantId, { lock: false })
    const usages = await loadBomFamilyUsages(em, scope, initialVariantId, family.allRevisions)
    const decision = decideRevisionDeletion(bom, usages)
    if (decision.status === 'blocked') throw await blockedError(ctx, scope, decision, translate)
    before = snapshotBom(bom, items)
  }, () => {
    softDelete(bom, items, new Date())
    em.persist(bom)
    em.persist(items)
  }], { transaction: !ctx.transactionalEm, label: 'manufacturing.boms.delete' })
  const result = { bomId: bom.id }
  snapshots.set(result, { before, after: null })
  await runEffects(em, ctx, [bom], [items])
  return result
}

async function deleteAll(input: BomDeleteAllInput, ctx: CommandRuntimeContext) {
  const { translate } = await resolveTranslations()
  const scope = resolveBomCommandScope(ctx, translate('manufacturing.errors.scopeRequired'))
  const em = ctx.transactionalEm ?? ctx.container.resolve<EntityManager>('em').fork()
  let revisions: ManufacturingBom[] = []
  let itemsByBom = new Map<string, ManufacturingBomItem[]>()
  let before: unknown = null
  await withAtomicFlush(em, [async () => {
    await assertReadCommitted(em)
    await lockBomFamily(em, scope, input.outputVariantId)
    const family = await loadBomFamilyRevisions(em, scope, input.outputVariantId, { lock: true })
    if (!family.active.length) throw notFound(translate('manufacturing.errors.bomUnavailable'))
    revisions = family.active
    itemsByBom = await loadActiveItemsForBoms(em, scope, revisions.map((revision) => revision.id))
    if (buildBomDeletionVersion(revisions, itemsByBom) !== input.expectedVersion) throw staleError(translate)
    const usages = await loadBomFamilyUsages(em, scope, input.outputVariantId, family.allRevisions)
    const decision = decideBomDeletion(usages)
    if (decision.status === 'blocked') throw await blockedError(ctx, scope, decision, translate)
    before = { outputVariantId: input.outputVariantId, revisions: revisions.map((revision) => snapshotBom(revision, itemsByBom.get(revision.id) ?? [])) }
  }, () => {
    const now = new Date()
    for (const revision of revisions) {
      const items = itemsByBom.get(revision.id) ?? []
      softDelete(revision, items, now)
      em.persist(revision)
      em.persist(items)
    }
  }], { transaction: !ctx.transactionalEm, label: 'manufacturing.boms.delete_all' })
  const result = { outputVariantId: input.outputVariantId, deletedBomIds: revisions.map((revision) => revision.id) }
  snapshots.set(result, { before, after: null })
  await runEffects(em, ctx, revisions, revisions.map((revision) => itemsByBom.get(revision.id) ?? []))
  return result
}

const deleteBomCommand: CommandHandler<BomDeleteInput, { bomId: string }> = {
  id: 'manufacturing.boms.delete', isUndoable: false,
  execute(input, ctx) { return deleteRevision(bomDeleteSchema.parse(input), ctx) },
  captureAfter() { return null },
  async buildLog({ result }) {
    const snap = snapshots.get(result)
    if (!snap) return null
    const bom = snap.before as ReturnType<typeof snapshotBom>
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('manufacturing.audit.bom.delete'), resourceKind: 'manufacturing.bom', resourceId: bom.id, tenantId: bom.tenantId, organizationId: bom.organizationId, snapshotBefore: snap.before, snapshotAfter: null }
  },
}

const deleteAllBomCommand: CommandHandler<BomDeleteAllInput, Extract<Result, { outputVariantId: string }>> = {
  id: 'manufacturing.boms.delete_all', isUndoable: false,
  execute(input, ctx) { return deleteAll(bomDeleteAllSchema.parse(input), ctx) },
  captureAfter() { return null },
  async buildLog({ result }) {
    const snap = snapshots.get(result)
    if (!snap) return null
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('manufacturing.audit.bom.delete_all'), resourceKind: 'manufacturing.bom_family', resourceId: result.outputVariantId, tenantId: (snap.before as { revisions: Array<{ tenantId: string }> }).revisions[0]?.tenantId, organizationId: (snap.before as { revisions: Array<{ organizationId: string }> }).revisions[0]?.organizationId, snapshotBefore: snap.before, snapshotAfter: null }
  },
}

registerCommand(deleteBomCommand)
registerCommand(deleteAllBomCommand)
export { deleteBomCommand, deleteAllBomCommand }
