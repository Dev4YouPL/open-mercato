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
import { resolveComponentTarget } from '../lib/bom/target-resolution'
import { nextAppendPosition, swapLinePositions } from '../lib/bom/position'
import { nextMonotonicTimestamp } from '../lib/bom/version'
import { BomDomainError, assertAggregateVersion } from '../lib/bom/errors'
import { compareDecimals } from '@open-mercato/shared/lib/decimal/exact'

type BomTarget = { productId: string; variantId?: string | null }
type QuantityInput = { value: string; unitCode?: string | null }
type ConsumptionBasis = 'variable' | 'fixed'
type SupplyMode = 'stock' | 'produce'

type LineSnapshot = {
  lineId: string
  revisionId: string
  componentProductId: string
  componentVariantId: string | null
  enteredQuantity: string
  enteredUnitCode: string
  normalizedQuantity: string
  normalizedUnitCode: string
  uomSnapshot: BomQuantityNormalizationSnapshot
  consumptionBasis: ConsumptionBasis
  yieldFactor: string
  supplyMode: SupplyMode
  position: string
}

/**
 * Yield lives in `(0, 1]` (spec "Quantity persistence"). Enforced here rather
 * than in zod so an out-of-range value returns the stable `bom.quantity_invalid`
 * 422 instead of a generic shape error or an opaque check-constraint failure.
 */
function assertYieldFactorInRange(value: string | undefined): void {
  if (value === undefined) return
  if (compareDecimals(value, '0') <= 0 || compareDecimals(value, '1') > 0) {
    throw new BomDomainError('bom.quantity_invalid', { field: 'yieldFactor' })
  }
}

function snapshotOfLine(line: ManufacturingBomLine): LineSnapshot {
  return {
    lineId: line.id,
    revisionId: line.revision.id,
    componentProductId: line.componentProductId,
    componentVariantId: line.componentVariantId ?? null,
    enteredQuantity: line.enteredQuantity,
    enteredUnitCode: line.enteredUnitCode,
    normalizedQuantity: line.normalizedQuantity,
    normalizedUnitCode: line.normalizedUnitCode,
    uomSnapshot: line.uomSnapshot,
    consumptionBasis: line.consumptionBasis,
    yieldFactor: line.yieldFactor,
    supplyMode: line.supplyMode,
    position: String(line.position),
  }
}

async function loadActiveDraftLocked(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  bomId: string,
): Promise<{ bom: ManufacturingBom; revision: ManufacturingBomRevision }> {
  const bom = await em.findOne(ManufacturingBom, { id: bomId, ...scope, deletedAt: null })
  if (!bom) throw new BomDomainError('bom.variant_product_mismatch', { reason: 'bom_not_found' })
  const revision = await em.findOne(ManufacturingBomRevision, { bom: bom.id, ...scope, status: 'draft', deletedAt: null })
  if (!revision) throw new BomDomainError('bom.variant_product_mismatch', { reason: 'draft_not_found' })
  return { bom, revision }
}

function assertFreshRevision(revision: ManufacturingBomRevision, expectedUpdatedAt?: string | null): void {
  assertAggregateVersion(revision.updatedAt, expectedUpdatedAt)
}

async function assertLineCycleSafe(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  ownerBomId: string,
  supplyMode: SupplyMode,
  componentProductId: string,
  componentVariantId: string | null,
): Promise<void> {
  if (supplyMode !== 'produce') return
  const resolution = await resolveComponentTarget(em, { ...scope, componentProductId, componentVariantId })
  if (resolution.state === 'unresolved' || resolution.state === 'stock_leaf') return
  await assertNoCandidateCycle(em, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    candidateEdges: [{ from: ownerBomId, to: resolution.childBomId }],
  })
}

/**
 * Semantic undo guard (spec "Commands, Events, Undo, and Redo": undo
 * "verifies recorded current state ... never overwrites later edits").
 *
 * An action log records the exact state the command produced. If the row no
 * longer carries that state, someone edited it afterwards and reverting would
 * silently destroy their work, so the undo is refused with the stable
 * aggregate conflict code instead of applying.
 */
function assertRecordedLineState(line: ManufacturingBomLine, expected: LineSnapshot): void {
  const current = snapshotOfLine(line)
  const changed =
    current.componentProductId !== expected.componentProductId ||
    current.componentVariantId !== expected.componentVariantId ||
    current.enteredQuantity !== expected.enteredQuantity ||
    current.enteredUnitCode !== expected.enteredUnitCode ||
    current.normalizedQuantity !== expected.normalizedQuantity ||
    current.normalizedUnitCode !== expected.normalizedUnitCode ||
    current.consumptionBasis !== expected.consumptionBasis ||
    current.yieldFactor !== expected.yieldFactor ||
    current.supplyMode !== expected.supplyMode ||
    current.position !== expected.position
  if (changed) throw new BomDomainError('bom.version_conflict', { reason: 'undo_state_changed' })
}

function touchAggregate(bom: ManufacturingBom, revision: ManufacturingBomRevision): Date {
  const now = nextMonotonicTimestamp(revision.updatedAt)
  revision.updatedAt = now
  bom.updatedAt = now
  return now
}

// ---------------------------------------------------------------------------
// manufacturing.bom_line.create
// ---------------------------------------------------------------------------

export type CreateLineCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  expectedUpdatedAt?: string | null
  line: {
    component: BomTarget
    quantity: QuantityInput
    consumptionBasis?: ConsumptionBasis
    yieldFactor?: string
    supplyMode?: SupplyMode
  }
}

type LineResult = { line: ManufacturingBomLine; revision: ManufacturingBomRevision }

const createLineCommand: CommandHandler<CreateLineCommandInput, LineResult> = {
  id: 'manufacturing.bom_line.create',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const created = await withBomTransaction(ctx, scope, async (em) => {
      const { bom, revision } = await loadActiveDraftLocked(em, scope, input.bomId)
      assertFreshRevision(revision, input.expectedUpdatedAt)

      const variantId = input.line.component.variantId ?? null
      const supplyMode = input.line.supplyMode ?? 'stock'
      await assertLineCycleSafe(em, scope, bom.id, supplyMode, input.line.component.productId, variantId)

      assertYieldFactorInRange(input.line.yieldFactor)
      const resolution = await resolveBomQuantity({
        container: ctx.container,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        productId: input.line.component.productId,
        variantId,
        quantity: input.line.quantity,
      })
      const position = await nextAppendPosition(em, revision.id)
      const now = nextMonotonicTimestamp(revision.updatedAt)

      const line = em.create(ManufacturingBomLine, {
        id: randomUUID(),
        revision,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        componentProductId: input.line.component.productId,
        componentVariantId: variantId,
        enteredQuantity: resolution.enteredQuantity,
        enteredUnitCode: resolution.enteredUnitCode,
        normalizedQuantity: resolution.normalizedQuantity,
        normalizedUnitCode: resolution.normalizedUnitCode,
        uomSnapshot: resolution.snapshot,
        consumptionBasis: input.line.consumptionBasis ?? 'variable',
        yieldFactor: input.line.yieldFactor ?? '1',
        supplyMode,
        position,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(line)
      revision.updatedAt = now
      bom.updatedAt = now
      await em.flush()
      return { line, revision }
    })
    await emitBomEvent('manufacturing.bom_line.created', {
      ...scope,
      bomId: created.revision.bom.id,
      revisionId: created.revision.id,
      revisionUpdatedAt: created.revision.updatedAt.toISOString(),
      lineId: created.line.id,
    })
    return created
  },
  buildLog: ({ result, ctx }) => ({
    resourceKind: 'manufacturing.bom',
    resourceId: result.revision.bom.id,
    relatedResourceKind: 'manufacturing.bom_line',
    relatedResourceId: result.line.id,
    tenantId: result.line.tenantId,
    organizationId: result.line.organizationId,
    actorUserId: ctx.auth?.userId ?? null,
    snapshotAfter: snapshotOfLine(result.line),
    payload: { undo: { after: snapshotOfLine(result.line) } },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: LineSnapshot }>(logEntry)
    const after = payload?.after
    if (!after?.lineId || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const removed = await withBomTransaction(ctx, scope, async (em) => {
      const line = await em.findOne(ManufacturingBomLine, { id: after.lineId, ...scope, deletedAt: null }, { populate: ['revision', 'revision.bom'] as never })
      if (!line) return null
      assertRecordedLineState(line, after)
      const revision = await em.findOne(ManufacturingBomRevision, { id: line.revision.id, ...scope })
      const bom = revision ? await em.findOne(ManufacturingBom, { id: revision.bom.id, ...scope }) : null
      if (!revision || !bom) return null
      const now = nextMonotonicTimestamp(revision.updatedAt)
      line.deletedAt = now
      revision.updatedAt = now
      bom.updatedAt = now
      await em.flush()
      return { bomId: bom.id, revisionId: revision.id, revisionUpdatedAt: now.toISOString() }
    })
    if (removed) await emitBomEvent('manufacturing.bom_line.deleted', { ...scope, ...removed, lineId: after.lineId })
  },
}

// ---------------------------------------------------------------------------
// manufacturing.bom_line.update
// ---------------------------------------------------------------------------

export type UpdateLineCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  lineId: string
  expectedUpdatedAt?: string | null
  component?: BomTarget
  quantity?: QuantityInput
  consumptionBasis?: ConsumptionBasis
  yieldFactor?: string
  supplyMode?: SupplyMode
}

const updateLineCommand: CommandHandler<UpdateLineCommandInput, LineResult & { before: LineSnapshot }> = {
  id: 'manufacturing.bom_line.update',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const updated = await withBomTransaction(ctx, scope, async (em) => {
      const { bom, revision } = await loadActiveDraftLocked(em, scope, input.bomId)
      assertFreshRevision(revision, input.expectedUpdatedAt)
      const line = await em.findOne(ManufacturingBomLine, { id: input.lineId, revision: revision.id, ...scope, deletedAt: null })
      if (!line) throw new BomDomainError('bom.variant_product_mismatch', { reason: 'line_not_found' })

      const before = snapshotOfLine(line)
      const effectiveProductId = input.component?.productId ?? line.componentProductId
      const effectiveVariantId = input.component ? (input.component.variantId ?? null) : (line.componentVariantId ?? null)
      const effectiveSupplyMode = input.supplyMode ?? line.supplyMode
      const componentChanged = Boolean(input.component)
      const quantityChanged = Boolean(input.quantity)

      if (componentChanged || effectiveSupplyMode !== line.supplyMode) {
        await assertLineCycleSafe(em, scope, bom.id, effectiveSupplyMode, effectiveProductId, effectiveVariantId)
      }

      if (componentChanged || quantityChanged) {
        const quantity = input.quantity ?? { value: line.enteredQuantity, unitCode: line.enteredUnitCode }
        const resolution = await resolveBomQuantity({
          container: ctx.container,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          productId: effectiveProductId,
          variantId: effectiveVariantId,
          quantity,
        })
        line.enteredQuantity = resolution.enteredQuantity
        line.enteredUnitCode = resolution.enteredUnitCode
        line.normalizedQuantity = resolution.normalizedQuantity
        line.normalizedUnitCode = resolution.normalizedUnitCode
        line.uomSnapshot = resolution.snapshot
      }

      if (componentChanged) {
        line.componentProductId = effectiveProductId
        line.componentVariantId = effectiveVariantId
      }
      if (input.consumptionBasis) line.consumptionBasis = input.consumptionBasis
      if (input.yieldFactor) {
        assertYieldFactorInRange(input.yieldFactor)
        line.yieldFactor = input.yieldFactor
      }
      if (input.supplyMode) line.supplyMode = input.supplyMode

      const now = touchAggregate(bom, revision)
      line.updatedAt = now
      await em.flush()
      return { line, revision, before }
    })
    await emitBomEvent('manufacturing.bom_line.updated', {
      ...scope,
      bomId: updated.revision.bom.id,
      revisionId: updated.revision.id,
      revisionUpdatedAt: updated.revision.updatedAt.toISOString(),
      lineId: updated.line.id,
    })
    return updated
  },
  buildLog: ({ result, ctx }) => ({
    resourceKind: 'manufacturing.bom',
    resourceId: result.revision.bom.id,
    relatedResourceKind: 'manufacturing.bom_line',
    relatedResourceId: result.line.id,
    tenantId: result.line.tenantId,
    organizationId: result.line.organizationId,
    actorUserId: ctx.auth?.userId ?? null,
    snapshotBefore: result.before,
    snapshotAfter: snapshotOfLine(result.line),
    payload: { undo: { before: result.before, after: snapshotOfLine(result.line) } },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: LineSnapshot; after: LineSnapshot }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const restored = await withBomTransaction(ctx, scope, async (em) => {
      const line = await em.findOne(ManufacturingBomLine, { id: before.lineId, ...scope, deletedAt: null }, { populate: ['revision', 'revision.bom'] as never })
      if (!line) return null
      assertRecordedLineState(line, after)
      const revision = await em.findOne(ManufacturingBomRevision, { id: line.revision.id, ...scope })
      const bom = revision ? await em.findOne(ManufacturingBom, { id: revision.bom.id, ...scope }) : null
      if (!revision || !bom) return null
      await assertLineCycleSafe(em, scope, bom.id, before.supplyMode, before.componentProductId, before.componentVariantId)
      line.componentProductId = before.componentProductId
      line.componentVariantId = before.componentVariantId
      line.enteredQuantity = before.enteredQuantity
      line.enteredUnitCode = before.enteredUnitCode
      line.normalizedQuantity = before.normalizedQuantity
      line.normalizedUnitCode = before.normalizedUnitCode
      line.uomSnapshot = before.uomSnapshot
      line.consumptionBasis = before.consumptionBasis
      line.yieldFactor = before.yieldFactor
      line.supplyMode = before.supplyMode
      const now = touchAggregate(bom, revision)
      line.updatedAt = now
      await em.flush()
      return { bomId: bom.id, revisionId: revision.id, revisionUpdatedAt: now.toISOString() }
    })
    if (restored) await emitBomEvent('manufacturing.bom_line.updated', { ...scope, ...restored, lineId: before.lineId })
  },
}

// ---------------------------------------------------------------------------
// manufacturing.bom_line.delete
// ---------------------------------------------------------------------------

export type DeleteLineCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  lineId: string
  expectedUpdatedAt?: string | null
}

const deleteLineCommand: CommandHandler<DeleteLineCommandInput, { lineId: string; revision: ManufacturingBomRevision; before: LineSnapshot }> = {
  id: 'manufacturing.bom_line.delete',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const deleted = await withBomTransaction(ctx, scope, async (em) => {
      const { bom, revision } = await loadActiveDraftLocked(em, scope, input.bomId)
      assertFreshRevision(revision, input.expectedUpdatedAt)
      const line = await em.findOne(ManufacturingBomLine, { id: input.lineId, revision: revision.id, ...scope, deletedAt: null })
      if (!line) throw new BomDomainError('bom.variant_product_mismatch', { reason: 'line_not_found' })
      const before = snapshotOfLine(line)
      const now = touchAggregate(bom, revision)
      line.deletedAt = now
      line.updatedAt = now
      await em.flush()
      return { lineId: line.id, revision, before }
    })
    await emitBomEvent('manufacturing.bom_line.deleted', {
      ...scope,
      bomId: deleted.revision.bom.id,
      revisionId: deleted.revision.id,
      revisionUpdatedAt: deleted.revision.updatedAt.toISOString(),
      lineId: deleted.lineId,
    })
    return deleted
  },
  buildLog: ({ result, ctx }) => ({
    resourceKind: 'manufacturing.bom',
    resourceId: result.revision.bom.id,
    relatedResourceKind: 'manufacturing.bom_line',
    relatedResourceId: result.lineId,
    tenantId: result.revision.tenantId,
    organizationId: result.revision.organizationId,
    actorUserId: ctx.auth?.userId ?? null,
    snapshotBefore: result.before,
    payload: { undo: { before: result.before } },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: LineSnapshot }>(logEntry)
    const before = payload?.before
    if (!before || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const recreated = await withBomTransaction(ctx, scope, async (em) => {
      const line = await em.findOne(ManufacturingBomLine, { id: before.lineId, ...scope }, { populate: ['revision', 'revision.bom'] as never })
      if (!line || !line.deletedAt) return null
      assertRecordedLineState(line, before)
      const revision = await em.findOne(ManufacturingBomRevision, { id: line.revision.id, ...scope })
      const bom = revision ? await em.findOne(ManufacturingBom, { id: revision.bom.id, ...scope }) : null
      if (!revision || !bom) return null
      const conflict = await em.findOne(ManufacturingBomLine, { revision: revision.id, position: before.position, deletedAt: null, id: { $ne: line.id } } as never)
      if (conflict) throw new BomDomainError('bom.position_exhausted')
      await assertLineCycleSafe(em, scope, bom.id, before.supplyMode, before.componentProductId, before.componentVariantId)
      line.deletedAt = null
      const now = touchAggregate(bom, revision)
      line.updatedAt = now
      await em.flush()
      return { bomId: bom.id, revisionId: revision.id, revisionUpdatedAt: now.toISOString() }
    })
    if (recreated) await emitBomEvent('manufacturing.bom_line.created', { ...scope, ...recreated, lineId: before.lineId })
  },
}

// ---------------------------------------------------------------------------
// manufacturing.bom_line.reorder
// ---------------------------------------------------------------------------

export type ReorderLineCommandInput = {
  tenantId: string
  organizationId: string
  bomId: string
  lineId: string
  expectedUpdatedAt?: string | null
  direction: 'up' | 'down'
}

type ReorderResult = {
  line: ManufacturingBomLine
  adjacentLine: ManufacturingBomLine | null
  revision: ManufacturingBomRevision
  changed: boolean
}

const reorderLineCommand: CommandHandler<ReorderLineCommandInput, ReorderResult> = {
  id: 'manufacturing.bom_line.reorder',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireBomScope(ctx, input)
    const reordered = await withBomTransaction(ctx, scope, async (em) => {
      const { bom, revision } = await loadActiveDraftLocked(em, scope, input.bomId)
      assertFreshRevision(revision, input.expectedUpdatedAt)
      const line = await em.findOne(ManufacturingBomLine, { id: input.lineId, revision: revision.id, ...scope, deletedAt: null })
      if (!line) throw new BomDomainError('bom.variant_product_mismatch', { reason: 'line_not_found' })

      const comparator = input.direction === 'up' ? { $lt: line.position } : { $gt: line.position }
      const orderBy = input.direction === 'up' ? { position: 'desc' as const } : { position: 'asc' as const }
      const adjacent = await em.findOne(
        ManufacturingBomLine,
        { revision: revision.id, ...scope, deletedAt: null, position: comparator, id: { $ne: line.id } } as never,
        { orderBy },
      )
      if (!adjacent) {
        return { line, adjacentLine: null, revision, changed: false }
      }

      await swapLinePositions(em, { revisionId: revision.id, line, adjacent })
      const now = touchAggregate(bom, revision)
      line.updatedAt = now
      adjacent.updatedAt = now
      await em.flush()
      return { line, adjacentLine: adjacent, revision, changed: true }
    })
    if (reordered.changed) {
      await emitBomEvent('manufacturing.bom_line.reordered', {
        ...scope,
        bomId: reordered.revision.bom.id,
        revisionId: reordered.revision.id,
        revisionUpdatedAt: reordered.revision.updatedAt.toISOString(),
        lineId: reordered.line.id,
        adjacentLineId: reordered.adjacentLine?.id ?? null,
        changed: true,
      })
    }
    return reordered
  },
  buildLog: ({ result, ctx }) => {
    if (!result.changed || !result.adjacentLine) return null
    return {
      resourceKind: 'manufacturing.bom',
      resourceId: result.revision.bom.id,
      relatedResourceKind: 'manufacturing.bom_line',
      relatedResourceId: result.line.id,
      tenantId: result.line.tenantId,
      organizationId: result.line.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotAfter: { lineId: result.line.id, adjacentLineId: result.adjacentLine.id, linePosition: String(result.line.position), adjacentPosition: String(result.adjacentLine.position) },
      payload: {
        undo: {
          lineId: result.line.id,
          adjacentLineId: result.adjacentLine.id,
          linePosition: String(result.line.position),
          adjacentPosition: String(result.adjacentLine.position),
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ lineId: string; adjacentLineId: string; linePosition: string; adjacentPosition: string }>(logEntry)
    if (!payload || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    const swapped = await withBomTransaction(ctx, scope, async (em) => {
      const line = await em.findOne(ManufacturingBomLine, { id: payload.lineId, ...scope, deletedAt: null }, { populate: ['revision', 'revision.bom'] as never })
      const adjacent = await em.findOne(ManufacturingBomLine, { id: payload.adjacentLineId, ...scope, deletedAt: null })
      if (!line || !adjacent) return null
      if (String(line.position) !== String(payload.adjacentPosition) || String(adjacent.position) !== String(payload.linePosition)) {
        throw new BomDomainError('bom.version_conflict', { reason: 'undo_state_changed' })
      }
      const revision = await em.findOne(ManufacturingBomRevision, { id: line.revision.id, ...scope })
      const bom = revision ? await em.findOne(ManufacturingBom, { id: revision.bom.id, ...scope }) : null
      if (!revision || !bom) return null
      await swapLinePositions(em, { revisionId: revision.id, line, adjacent })
      const now = touchAggregate(bom, revision)
      line.updatedAt = now
      adjacent.updatedAt = now
      await em.flush()
      return { bomId: bom.id, revisionId: revision.id, revisionUpdatedAt: now.toISOString() }
    })
    if (swapped) {
      await emitBomEvent('manufacturing.bom_line.reordered', {
        ...swapped,
        ...scope,
        lineId: payload.lineId,
        adjacentLineId: payload.adjacentLineId,
        changed: true,
      })
    }
  },
}

registerCommand(createLineCommand)
registerCommand(updateLineCommand)
registerCommand(deleteLineCommand)
registerCommand(reorderLineCommand)

export { createLineCommand, updateLineCommand, deleteLineCommand, reorderLineCommand }
