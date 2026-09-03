import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { ManufacturingBom, ManufacturingBomLine, ManufacturingBomRevision } from '../data/entities'
import { requireBomScope, withBomTransaction } from '../lib/bom/command-context'
import { resolveBomQuantity, type BomQuantityNormalizationSnapshot } from '../lib/bom/quantity'
import { assertNoCandidateCycle } from '../lib/bom/graph-service'
import { emitBomEvent } from '../lib/bom/emit'
import { nextMonotonicTimestamp } from '../lib/bom/version'
import { BomDomainError, assertAggregateVersion } from '../lib/bom/errors'
import {
  readBomCustomFields,
  restoreBomCustomFields,
  writeBomCustomFields,
  type CustomFieldSnapshot,
} from '../lib/bom/custom-fields'

type BomTarget = { productId: string; variantId?: string | null }
type QuantityInput = { value: string; unitCode?: string | null }

async function assertTargetAvailable(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; productId: string; variantId: string | null; excludeBomId?: string },
): Promise<void> {
  const where: Record<string, unknown> = {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    productId: params.productId,
    variantId: params.variantId,
    deletedAt: null,
  }
  if (params.excludeBomId) where.id = { $ne: params.excludeBomId }
  const existing = await em.findOne(ManufacturingBom, where as never)
  if (existing) throw new BomDomainError('bom.target_conflict')
}

type BomSnapshot = {
  bomId: string
  revisionId: string
  productId: string
  variantId: string | null
  revisionNumber: number
  revisionLabel: string | null
  baseOutputEnteredQuantity: string
  baseOutputEnteredUnitCode: string
  baseOutputNormalizedQuantity: string
  baseOutputNormalizedUnitCode: string
  baseOutputUomSnapshot: BomQuantityNormalizationSnapshot
  customFields?: CustomFieldSnapshot
}

function snapshotOf(
  bom: ManufacturingBom,
  revision: ManufacturingBomRevision,
  customFields?: CustomFieldSnapshot,
): BomSnapshot {
  return {
    ...(customFields ? { customFields } : {}),
    bomId: bom.id,
    revisionId: revision.id,
    productId: bom.productId,
    variantId: bom.variantId ?? null,
    revisionNumber: revision.revisionNumber,
    revisionLabel: revision.revisionLabel ?? null,
    baseOutputEnteredQuantity: revision.baseOutputEnteredQuantity,
    baseOutputEnteredUnitCode: revision.baseOutputEnteredUnitCode,
    baseOutputNormalizedQuantity: revision.baseOutputNormalizedQuantity,
    baseOutputNormalizedUnitCode: revision.baseOutputNormalizedUnitCode,
    baseOutputUomSnapshot: revision.baseOutputUomSnapshot,
  }
}

/**
 * Semantic undo guard (spec "Commands, Events, Undo, and Redo": undo
 * "verifies recorded current state ... never overwrites later edits").
 *
 * Custom fields are deliberately excluded: they live outside the aggregate
 * tables and outside the graph lock, so they are compared and reverted by
 * their own snapshot helper rather than gating the domain revert.
 */
function assertRecordedBomState(
  bom: ManufacturingBom,
  revision: ManufacturingBomRevision,
  expected: BomSnapshot,
): void {
  const current = snapshotOf(bom, revision)
  const changed =
    current.productId !== expected.productId ||
    current.variantId !== expected.variantId ||
    current.revisionId !== expected.revisionId ||
    current.revisionNumber !== expected.revisionNumber ||
    current.revisionLabel !== expected.revisionLabel ||
    current.baseOutputEnteredQuantity !== expected.baseOutputEnteredQuantity ||
    current.baseOutputEnteredUnitCode !== expected.baseOutputEnteredUnitCode ||
    current.baseOutputNormalizedQuantity !== expected.baseOutputNormalizedQuantity ||
    current.baseOutputNormalizedUnitCode !== expected.baseOutputNormalizedUnitCode
  if (changed) throw new BomDomainError('bom.version_conflict', { reason: 'undo_state_changed' })
}

/**
 * Re-validates the whole live produce graph after a restore. A revert that
 * re-targets a family or brings a soft-deleted one back can close a cycle that
 * did not exist when the action was recorded, so every restore path pays for
 * one full check under the graph lock it already holds.
 */
async function assertRestoredGraphAcyclic(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  await assertNoCandidateCycle(em, { ...scope, candidateEdges: [] })
}

// ---------------------------------------------------------------------------
// manufacturing.bom.create
// ---------------------------------------------------------------------------

export type CreateBomCommandInput = {
  tenantId: string
  organizationId: string
  target: BomTarget
  revisionLabel?: string | null
  baseOutput: QuantityInput
  customFields?: Record<string, unknown>
}

type CreateBomResult = { bom: ManufacturingBom; revision: ManufacturingBomRevision }

const createBomCommand: CommandHandler<CreateBomCommandInput, CreateBomResult> = {
  id: 'manufacturing.bom.create',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const created = await withBomTransaction(ctx, scope, async (em) => {
      const variantId = input.target.variantId ?? null
      await assertTargetAvailable(em, { ...scope, productId: input.target.productId, variantId })

      const resolution = await resolveBomQuantity({
        container: ctx.container,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        productId: input.target.productId,
        variantId,
        quantity: input.baseOutput,
      })

      const now = nextMonotonicTimestamp(null)
      const bom = em.create(ManufacturingBom, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        productId: input.target.productId,
        variantId,
        nextRevisionNumber: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      bom.nextRevisionNumber = 2

      const revision = em.create(ManufacturingBomRevision, {
        id: randomUUID(),
        bom,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        revisionNumber: 1,
        revisionLabel: input.revisionLabel ?? null,
        status: 'draft',
        baseOutputEnteredQuantity: resolution.enteredQuantity,
        baseOutputEnteredUnitCode: resolution.enteredUnitCode,
        baseOutputNormalizedQuantity: resolution.normalizedQuantity,
        baseOutputNormalizedUnitCode: resolution.normalizedUnitCode,
        baseOutputUomSnapshot: resolution.snapshot,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      em.persist(bom)
      em.persist(revision)
      await em.flush()
      return { bom, revision }
    })
    await writeBomCustomFields(ctx, scope, created.bom.id, input.customFields)
    await emitBomEvent('manufacturing.bom.created', {
      ...scope,
      bomId: created.bom.id,
      revisionId: created.revision.id,
      revisionUpdatedAt: created.revision.updatedAt.toISOString(),
    })
    return created
  },
  buildLog: ({ input, result, ctx }) => {
    const snapshot = snapshotOf(result.bom, result.revision, input.customFields ?? {})
    return {
      resourceKind: 'manufacturing.bom',
      resourceId: result.bom.id,
      tenantId: result.bom.tenantId,
      organizationId: result.bom.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotAfter: snapshot,
      payload: { undo: { after: snapshot } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: BomSnapshot }>(logEntry)
    const after = payload?.after
    const bomId = logEntry?.resourceId ?? after?.bomId ?? null
    if (!bomId || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const removed = await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: bomId, ...scope, deletedAt: null })
      if (!bom) return null
      const revision = await em.findOne(ManufacturingBomRevision, { bom: bom.id, ...scope, status: 'draft', deletedAt: null })
      if (after && revision) assertRecordedBomState(bom, revision, after)
      const now = nextMonotonicTimestamp(bom.updatedAt)
      bom.deletedAt = now
      bom.updatedAt = now
      if (revision) {
        revision.deletedAt = now
        revision.updatedAt = now
      }
      await em.flush()
      return revision ? { revisionId: revision.id, revisionUpdatedAt: now.toISOString() } : null
    })
    if (removed) await emitBomEvent('manufacturing.bom.deleted', { ...scope, bomId, ...removed })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: BomSnapshot }>(logEntry)
    const snapshot = payload?.after
    if (!snapshot || !logEntry?.tenantId || !logEntry?.organizationId) throw new BomDomainError('bom.target_conflict')
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const restored = await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: snapshot.bomId, ...scope })
      const revision = bom ? await em.findOne(ManufacturingBomRevision, { id: snapshot.revisionId, ...scope }) : null
      if (!bom || !revision) throw new BomDomainError('bom.target_conflict')
      await assertTargetAvailable(em, { ...scope, productId: bom.productId, variantId: bom.variantId ?? null, excludeBomId: bom.id })
      const now = nextMonotonicTimestamp(bom.updatedAt)
      bom.deletedAt = null
      bom.updatedAt = now
      revision.deletedAt = null
      revision.updatedAt = now
      await em.flush()
      await assertRestoredGraphAcyclic(em, scope)
      return { bom, revision }
    })
    await emitBomEvent('manufacturing.bom.created', {
      ...scope,
      bomId: restored.bom.id,
      revisionId: restored.revision.id,
      revisionUpdatedAt: restored.revision.updatedAt.toISOString(),
    })
    return restored
  },
}

// ---------------------------------------------------------------------------
// manufacturing.bom.update
// ---------------------------------------------------------------------------

export type UpdateBomCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  expectedUpdatedAt?: string | null
  target?: BomTarget
  draft?: { revisionLabel?: string | null; baseOutput?: QuantityInput }
  customFields?: Record<string, unknown>
}

const updateBomCommand: CommandHandler<UpdateBomCommandInput, CreateBomResult> = {
  id: 'manufacturing.bom.update',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const customFieldsBefore = input.customFields
      ? await readBomCustomFields(ctx.container.resolve<EntityManager>('em').fork(), scope, input.bomId)
      : undefined
    const updated = await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: input.bomId, ...scope, deletedAt: null })
      if (!bom) throw new BomDomainError('bom.target_conflict', { reason: 'not_found' })
      const revision = await em.findOne(ManufacturingBomRevision, { bom: bom.id, ...scope, status: 'draft', deletedAt: null })
      if (!revision) throw new BomDomainError('bom.target_conflict', { reason: 'not_found' })

      assertAggregateVersion(revision.updatedAt, input.expectedUpdatedAt)

      const before = snapshotOf(bom, revision)
      const effectiveProductId = input.target?.productId ?? bom.productId
      const effectiveVariantId = input.target ? (input.target.variantId ?? null) : (bom.variantId ?? null)
      const effectiveQuantity: QuantityInput = input.draft?.baseOutput ?? {
        value: revision.baseOutputEnteredQuantity,
        unitCode: revision.baseOutputEnteredUnitCode,
      }
      const targetChanged = effectiveProductId !== bom.productId || effectiveVariantId !== (bom.variantId ?? null)
      const quantityChanged = Boolean(input.draft?.baseOutput)

      if (targetChanged) {
        await assertTargetAvailable(em, { ...scope, productId: effectiveProductId, variantId: effectiveVariantId, excludeBomId: bom.id })
      }

      if (targetChanged || quantityChanged) {
        const resolution = await resolveBomQuantity({
          container: ctx.container,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          productId: effectiveProductId,
          variantId: effectiveVariantId,
          quantity: effectiveQuantity,
        })
        revision.baseOutputEnteredQuantity = resolution.enteredQuantity
        revision.baseOutputEnteredUnitCode = resolution.enteredUnitCode
        revision.baseOutputNormalizedQuantity = resolution.normalizedQuantity
        revision.baseOutputNormalizedUnitCode = resolution.normalizedUnitCode
        revision.baseOutputUomSnapshot = resolution.snapshot
      }

      if (targetChanged) {
        await assertNoCandidateCycle(em, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          candidateEdges: [],
          targetOverrides: new Map([[bom.id, { productId: effectiveProductId, variantId: effectiveVariantId }]]),
        })
        bom.productId = effectiveProductId
        bom.variantId = effectiveVariantId
      }

      if (input.draft && 'revisionLabel' in input.draft) {
        revision.revisionLabel = input.draft.revisionLabel ?? null
      }

      const now = nextMonotonicTimestamp(revision.updatedAt)
      revision.updatedAt = now
      bom.updatedAt = now
      await em.flush()
      return { bom, revision, before } as CreateBomResult & { before: BomSnapshot }
    })
    await writeBomCustomFields(ctx, scope, updated.bom.id, input.customFields)
    const withBefore = updated as CreateBomResult & { before?: BomSnapshot }
    if (customFieldsBefore && withBefore.before) withBefore.before.customFields = customFieldsBefore
    await emitBomEvent('manufacturing.bom.updated', {
      ...scope,
      bomId: updated.bom.id,
      revisionId: updated.revision.id,
      revisionUpdatedAt: updated.revision.updatedAt.toISOString(),
    })
    return updated
  },
  buildLog: ({ input, result, ctx }) => {
    const withBefore = result as CreateBomResult & { before?: BomSnapshot }
    const after = snapshotOf(
      result.bom,
      result.revision,
      input.customFields ? { ...withBefore.before?.customFields, ...input.customFields } : undefined,
    )
    return {
      resourceKind: 'manufacturing.bom',
      resourceId: result.bom.id,
      tenantId: result.bom.tenantId,
      organizationId: result.bom.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotBefore: withBefore.before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: withBefore.before ?? null, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: BomSnapshot | null; after: BomSnapshot | null }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    // The domain revert runs first because it is the half that can legitimately
    // refuse — state changed since, or the revert would close a cycle. Reverting
    // the out-of-aggregate custom fields ahead of it would leave them rolled
    // back against a draft that was never reverted.
    let revertedAt: string | null = null
    await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: before.bomId, ...scope, deletedAt: null })
      const revision = bom ? await em.findOne(ManufacturingBomRevision, { id: before.revisionId, ...scope, deletedAt: null }) : null
      if (!bom || !revision) return
      assertRecordedBomState(bom, revision, after)
      const targetChanged = before.productId !== bom.productId || before.variantId !== (bom.variantId ?? null)
      if (targetChanged) {
        await assertTargetAvailable(em, { ...scope, productId: before.productId, variantId: before.variantId, excludeBomId: bom.id })
        await assertNoCandidateCycle(em, {
          ...scope,
          candidateEdges: [],
          targetOverrides: new Map([[bom.id, { productId: before.productId, variantId: before.variantId }]]),
        })
      }
      bom.productId = before.productId
      bom.variantId = before.variantId
      revision.revisionLabel = before.revisionLabel
      revision.baseOutputEnteredQuantity = before.baseOutputEnteredQuantity
      revision.baseOutputEnteredUnitCode = before.baseOutputEnteredUnitCode
      revision.baseOutputNormalizedQuantity = before.baseOutputNormalizedQuantity
      revision.baseOutputNormalizedUnitCode = before.baseOutputNormalizedUnitCode
      revision.baseOutputUomSnapshot = before.baseOutputUomSnapshot
      const now = nextMonotonicTimestamp(revision.updatedAt)
      revision.updatedAt = now
      bom.updatedAt = now
      revertedAt = now.toISOString()
      await em.flush()
    })
    if (revertedAt) {
      await restoreBomCustomFields(ctx, scope, before.bomId, before.customFields, after.customFields)
      await emitBomEvent('manufacturing.bom.updated', {
        ...scope,
        bomId: before.bomId,
        revisionId: before.revisionId,
        revisionUpdatedAt: revertedAt,
      })
    }
  },
}

// ---------------------------------------------------------------------------
// manufacturing.bom.delete
// ---------------------------------------------------------------------------

export type DeleteBomCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  expectedUpdatedAt?: string | null
}

type DeleteBomResult = {
  bomId: string
  revisionId: string
  deletedAt: Date
  tenantId: string
  organizationId: string
}

const deleteBomCommand: CommandHandler<DeleteBomCommandInput, DeleteBomResult> = {
  id: 'manufacturing.bom.delete',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const deleted = await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: input.bomId, ...scope, deletedAt: null })
      if (!bom) throw new BomDomainError('bom.target_conflict', { reason: 'not_found' })
      const revision = await em.findOne(ManufacturingBomRevision, { bom: bom.id, ...scope, status: 'draft', deletedAt: null })
      if (!revision) throw new BomDomainError('bom.target_conflict', { reason: 'not_found' })
      assertAggregateVersion(revision.updatedAt, input.expectedUpdatedAt)
      const lines = await em.find(ManufacturingBomLine, { revision: revision.id, ...scope, deletedAt: null })
      const now = nextMonotonicTimestamp(revision.updatedAt)
      bom.deletedAt = now
      bom.updatedAt = now
      revision.deletedAt = now
      revision.updatedAt = now
      for (const line of lines) line.deletedAt = now
      await em.flush()
      return { bomId: bom.id, revisionId: revision.id, deletedAt: now, ...scope }
    })
    await emitBomEvent('manufacturing.bom.deleted', {
      ...scope,
      bomId: deleted.bomId,
      revisionId: deleted.revisionId,
      revisionUpdatedAt: deleted.deletedAt.toISOString(),
    })
    return deleted
  },
  buildLog: ({ result, ctx }) => ({
    resourceKind: 'manufacturing.bom',
    resourceId: result.bomId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    actorUserId: ctx.auth?.userId ?? null,
    snapshotAfter: result,
    payload: { undo: { after: result } },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: DeleteBomResult }>(logEntry)
    const bomId = logEntry?.resourceId ?? payload?.after?.bomId ?? null
    if (!bomId || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const markedAt = payload?.after?.deletedAt
    const restored = await withBomTransaction(ctx, scope, async (em) => {
      const bom = await em.findOne(ManufacturingBom, { id: bomId, ...scope })
      if (!bom || !bom.deletedAt) return null
      const markedTime = markedAt ? new Date(markedAt).getTime() : null
      if (markedTime !== null && bom.deletedAt.getTime() !== markedTime) return null
      await assertTargetAvailable(em, { ...scope, productId: bom.productId, variantId: bom.variantId ?? null, excludeBomId: bom.id })
      const revision = await em.findOne(ManufacturingBomRevision, { bom: bom.id, ...scope })
      const lines = revision ? await em.find(ManufacturingBomLine, { revision: revision.id, ...scope }) : []
      const now = nextMonotonicTimestamp(bom.updatedAt)
      bom.deletedAt = null
      bom.updatedAt = now
      if (revision) {
        revision.deletedAt = null
        revision.updatedAt = now
      }
      for (const line of lines) {
        if (line.deletedAt && markedTime !== null && line.deletedAt.getTime() === markedTime) line.deletedAt = null
      }
      await em.flush()
      await assertRestoredGraphAcyclic(em, scope)
      return revision ? { revisionId: revision.id, revisionUpdatedAt: now.toISOString() } : null
    })
    if (restored) await emitBomEvent('manufacturing.bom.created', { ...scope, bomId, ...restored })
  },
}

registerCommand(createBomCommand)
registerCommand(updateBomCommand)
registerCommand(deleteBomCommand)

export { createBomCommand, updateBomCommand, deleteBomCommand }
