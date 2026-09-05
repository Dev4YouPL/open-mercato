import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { ManufacturingWorkCenter } from '../data/entities'
import { WORK_CENTER_ENTITY_ID } from '../lib/work-centers/entity-ids'
import { WorkCenterDomainError } from '../lib/work-centers/errors'
import { acquireWorkCenterLock } from '../lib/work-centers/locking'
import { isSameMembership, normalizeAndAssertResourceIds } from '../lib/work-centers/membership'
import { resolveOptionalResourceReferences } from '../lib/work-centers/resource-provider'
import {
  assertCodeAvailable,
  findScopedWorkCenter,
  loadMembership,
  mapCodeUniqueViolation,
  syncMembership,
  type WorkCenterScope,
} from '../lib/work-centers/repository'
import { emitWorkCenterEvent } from '../lib/work-centers/emit'
import { withLocalizedWorkCenterErrors } from '../lib/work-centers/http-errors'
import { nextMonotonicTimestamp } from '../lib/bom/version'
import {
  WORK_CENTER_RESOURCE_KIND,
  assertCurrentManageGrant,
  forkEntityManager,
  requireWorkCenterScope,
  reversalVersion,
} from '../lib/work-centers/command-context'

/** Complete aggregate snapshot recorded in the audit log and compared by undo/redo. */
export type WorkCenterSnapshot = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  resourceIds: string[]
  updatedAt: string
  deletedAt: string | null
}

function snapshotOf(workCenter: ManufacturingWorkCenter, resourceIds: string[]): WorkCenterSnapshot {
  return {
    id: workCenter.id,
    code: workCenter.code,
    name: workCenter.name,
    description: workCenter.description ?? null,
    isActive: workCenter.isActive,
    resourceIds: [...resourceIds],
    updatedAt: workCenter.updatedAt.toISOString(),
    deletedAt: workCenter.deletedAt ? workCenter.deletedAt.toISOString() : null,
  }
}

/**
 * Exact-state comparison for a reversal.
 *
 * Every field participates, the version included: a reversal may only act on a
 * record still in precisely the state its recorded counterpart produced, so an
 * intervening edit — even one that happens to restore the same scalars —
 * refuses instead of silently overwriting later work.
 */
function assertExactState(current: WorkCenterSnapshot, expected: WorkCenterSnapshot): void {
  const matches =
    current.id === expected.id &&
    current.code === expected.code &&
    current.name === expected.name &&
    current.description === expected.description &&
    current.isActive === expected.isActive &&
    current.updatedAt === expected.updatedAt &&
    current.deletedAt === expected.deletedAt &&
    isSameMembership(current.resourceIds, expected.resourceIds)
  if (!matches) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'state_changed' })
}

function actorOf(ctx: CommandRuntimeContext): string | null {
  return ctx.auth?.sub ?? null
}

const indexerConfig = { entityType: WORK_CENTER_ENTITY_ID, cacheAliases: [] as string[] }

function identifiersOf(workCenter: ManufacturingWorkCenter, scope: WorkCenterScope) {
  return { id: workCenter.id, organizationId: scope.organizationId, tenantId: scope.tenantId }
}

/**
 * Runs one Work Centre mutation with the canonical topology.
 *
 * `runCrudCommandWrite` owns the transaction (via `withAtomicFlush({
 * transaction: true })`) and fires index/cache side effects only after it
 * commits, so nothing here opens an outer transaction around it — doing so
 * would let those effects escape ahead of the real commit. `prepare` runs as
 * the first phase, inside the transaction and after the advisory lock, and
 * mutates nothing; `apply` is the write phase.
 */
async function runWorkCenterWrite<T>(args: {
  ctx: CommandRuntimeContext
  scope: WorkCenterScope
  action: 'created' | 'updated' | 'deleted'
  prepare: (em: EntityManager) => Promise<T>
  apply: (em: EntityManager, prepared: T) => Promise<void>
  target: () => ManufacturingWorkCenter
}): Promise<T> {
  const em = forkEntityManager(args.ctx)
  let prepared: T | undefined
  await runCrudCommandWrite({
    ctx: args.ctx,
    entityId: WORK_CENTER_ENTITY_ID,
    action: args.action,
    scope: args.scope,
    transaction: true,
    em,
    indexer: indexerConfig,
    phases: [
      async ({ em: tx }) => {
        prepared = await args.prepare(tx)
      },
      async ({ em: tx }) => {
        await args.apply(tx, prepared as T)
      },
    ],
    sideEffect: () => {
      const entity = args.target()
      return { entity, identifiers: identifiersOf(entity, args.scope) }
    },
  })
  return prepared as T
}

/**
 * Loads a Work Centre for a guarded mutation: advisory lock first, then a fresh
 * scoped read, then the canonical command-level version comparison against that
 * locked row. Reading before the lock would compare an ORM identity-map value
 * that a concurrent winner may already have superseded.
 */
async function lockAndLoad(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: WorkCenterScope,
  id: string,
  expectedUpdatedAt: string | null | undefined,
): Promise<{ workCenter: ManufacturingWorkCenter; resourceIds: string[] }> {
  await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, id)
  const workCenter = await findScopedWorkCenter(em, scope, id)
  if (!workCenter) {
    enforceRecordGoneIsConflict({
      resourceKind: WORK_CENTER_RESOURCE_KIND,
      resourceId: id,
      expected: expectedUpdatedAt ?? null,
      request: ctx.request ?? null,
    })
    throw new WorkCenterDomainError('work_center_not_found', { id })
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: WORK_CENTER_RESOURCE_KIND,
    resourceId: workCenter.id,
    current: workCenter.updatedAt,
    expected: expectedUpdatedAt ?? null,
    request: ctx.request ?? null,
  })
  const resourceIds = await loadMembership(em, scope, workCenter.id)
  return { workCenter, resourceIds }
}

/**
 * Decides whether a membership change is requested and, when it is, pays for
 * the optional provider.
 *
 * An omitted set and a set equal to the stored one are both membership no-ops
 * and never resolve the provider. Every real change does — a removal-only
 * change and an empty resulting set included — because dropping a member is as
 * much a membership mutation as adding one.
 */
async function resolveMembershipChange(
  ctx: CommandRuntimeContext,
  scope: WorkCenterScope,
  currentIds: string[],
  requested: readonly string[] | undefined,
): Promise<{ changed: boolean; nextIds: string[] }> {
  if (requested === undefined) return { changed: false, nextIds: currentIds }
  const nextIds = normalizeAndAssertResourceIds(requested)
  if (isSameMembership(currentIds, nextIds)) return { changed: false, nextIds: currentIds }
  await resolveOptionalResourceReferences(ctx.container, nextIds, { ...scope, actorId: actorOf(ctx) })
  return { changed: true, nextIds }
}

// ---------------------------------------------------------------------------
// manufacturing.work_center.create
// ---------------------------------------------------------------------------

export type CreateWorkCenterCommandInput = {
  tenantId?: string | null
  organizationId?: string | null
  code: string
  name: string
  description?: string | null
  isActive?: boolean
  resourceIds?: string[]
}

export type WorkCenterCommandResult = {
  workCenter: ManufacturingWorkCenter
  resourceIds: string[]
  membershipChanged: boolean
  before?: WorkCenterSnapshot | null
}

const createWorkCenterCommand: CommandHandler<CreateWorkCenterCommandInput, WorkCenterCommandResult> = {
  id: 'manufacturing.work_center.create',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireWorkCenterScope(ctx, input)
    // Allocated up front so create shares the per-record lock key with every
    // later update, delete, undo and redo of the same aggregate.
    const workCenterId = randomUUID()
    let created: ManufacturingWorkCenter | null = null

    const prepared = await runWorkCenterWrite({
      ctx,
      scope,
      action: 'created',
      target: () => created as ManufacturingWorkCenter,
      prepare: async (em) => {
        await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, workCenterId)
        // Omitted and empty are the same unassigned authoring request: neither
        // resolves the optional provider nor requires resources.view.
        const nextIds = normalizeAndAssertResourceIds(input.resourceIds ?? [])
        if (nextIds.length > 0) {
          await resolveOptionalResourceReferences(ctx.container, nextIds, { ...scope, actorId: actorOf(ctx) })
        }
        await assertCodeAvailable(em, scope, input.code, null)
        return { nextIds }
      },
      apply: async (em, { nextIds }) => {
        const now = new Date()
        const workCenter = em.create(ManufacturingWorkCenter, {
          id: workCenterId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(workCenter)
        created = workCenter
        await syncMembership(em, scope, workCenter, [], nextIds)
      },
    }).catch((error) => mapCodeUniqueViolation(error))

    const workCenter = created as unknown as ManufacturingWorkCenter
    await emitWorkCenterEvent('manufacturing.work_center.created', {
      id: workCenter.id,
      ...scope,
      updatedAt: workCenter.updatedAt.toISOString(),
    })
    return { workCenter, resourceIds: prepared.nextIds, membershipChanged: prepared.nextIds.length > 0 }
  },
  buildLog: ({ result, ctx }) => {
    const after = snapshotOf(result.workCenter, result.resourceIds)
    return {
      resourceKind: WORK_CENTER_RESOURCE_KIND,
      resourceId: result.workCenter.id,
      tenantId: result.workCenter.tenantId,
      organizationId: result.workCenter.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: WorkCenterSnapshot }>(logEntry)
    const after = payload?.after
    if (!after || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_undo_forbidden')

    let target: ManufacturingWorkCenter | null = null
    const version = reversalVersion(after.updatedAt)
    await runWorkCenterWrite({
      ctx,
      scope,
      action: 'deleted',
      target: () => target as ManufacturingWorkCenter,
      prepare: async (em) => {
        await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, after.id)
        const workCenter = await findScopedWorkCenter(em, scope, after.id)
        if (!workCenter) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'record_gone' })
        const resourceIds = await loadMembership(em, scope, workCenter.id)
        assertExactState(snapshotOf(workCenter, resourceIds), after)
        target = workCenter
        return { workCenter }
      },
      // Membership rows survive the soft delete, so undoing a create needs no
      // provider lookup: nothing about the set changes.
      apply: async (_em, { workCenter }) => {
        workCenter.deletedAt = version
        workCenter.isActive = false
        workCenter.updatedAt = version
      },
    })

    await emitWorkCenterEvent('manufacturing.work_center.deleted', {
      id: after.id,
      ...scope,
      updatedAt: version.toISOString(),
      deletedAt: version.toISOString(),
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ after: WorkCenterSnapshot }>(logEntry)
    const after = payload?.after
    if (!after || !logEntry?.tenantId || !logEntry?.organizationId) {
      throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'missing_snapshot' })
    }
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_redo_forbidden')

    // The state the preceding undo must have produced, version included.
    const undoneVersion = reversalVersion(after.updatedAt)
    const expected: WorkCenterSnapshot = {
      ...after,
      isActive: false,
      updatedAt: undoneVersion.toISOString(),
      deletedAt: undoneVersion.toISOString(),
    }
    const version = reversalVersion(undoneVersion)
    let target: ManufacturingWorkCenter | null = null

    await runWorkCenterWrite({
      ctx,
      scope,
      action: 'created',
      target: () => target as ManufacturingWorkCenter,
      prepare: async (em) => {
        await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, after.id)
        const workCenter = await findScopedWorkCenter(em, scope, after.id, { includeDeleted: true })
        if (!workCenter) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'record_gone' })
        const resourceIds = await loadMembership(em, scope, workCenter.id)
        assertExactState(snapshotOf(workCenter, resourceIds), expected)
        await assertCodeAvailable(em, scope, after.code, workCenter.id, 'work_center_restore_code_conflict')
        target = workCenter
        return { workCenter }
      },
      apply: async (_em, { workCenter }) => {
        workCenter.deletedAt = null
        workCenter.isActive = after.isActive
        workCenter.updatedAt = version
      },
    }).catch((error) => mapCodeUniqueViolation(error, 'work_center_restore_code_conflict'))

    const workCenter = target as unknown as ManufacturingWorkCenter
    await emitWorkCenterEvent('manufacturing.work_center.created', {
      id: after.id,
      ...scope,
      updatedAt: version.toISOString(),
    })
    return { workCenter, resourceIds: after.resourceIds, membershipChanged: false }
  },
}

// ---------------------------------------------------------------------------
// manufacturing.work_center.update
// ---------------------------------------------------------------------------

export type UpdateWorkCenterCommandInput = {
  tenantId?: string | null
  organizationId?: string | null
  id: string
  code?: string
  name?: string
  description?: string | null
  isActive?: boolean
  resourceIds?: string[]
  expectedUpdatedAt?: string | null
}

const updateWorkCenterCommand: CommandHandler<UpdateWorkCenterCommandInput, WorkCenterCommandResult> = {
  id: 'manufacturing.work_center.update',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireWorkCenterScope(ctx, input)
    let target: ManufacturingWorkCenter | null = null

    const prepared = await runWorkCenterWrite({
      ctx,
      scope,
      action: 'updated',
      target: () => target as ManufacturingWorkCenter,
      prepare: async (em) => {
        const { workCenter, resourceIds } = await lockAndLoad(ctx, em, scope, input.id, input.expectedUpdatedAt)
        const before = snapshotOf(workCenter, resourceIds)
        const membership = await resolveMembershipChange(ctx, scope, resourceIds, input.resourceIds)

        const nextCode = input.code ?? workCenter.code
        const nextName = input.name ?? workCenter.name
        const nextDescription =
          input.description !== undefined ? (input.description ?? null) : (workCenter.description ?? null)
        const nextIsActive = input.isActive ?? workCenter.isActive
        const scalarChanged =
          nextCode !== workCenter.code ||
          nextName !== workCenter.name ||
          nextDescription !== (workCenter.description ?? null) ||
          nextIsActive !== workCenter.isActive

        if (nextCode !== workCenter.code) {
          await assertCodeAvailable(em, scope, nextCode, workCenter.id)
        }
        target = workCenter
        return {
          workCenter,
          before,
          membership,
          next: { code: nextCode, name: nextName, description: nextDescription, isActive: nextIsActive },
          changed: scalarChanged || membership.changed,
        }
      },
      apply: async (em, prep) => {
        // A no-op update still validated the version above, but must not bump
        // it, emit an event or write anything.
        if (!prep.changed) return
        const workCenter = prep.workCenter
        workCenter.code = prep.next.code
        workCenter.name = prep.next.name
        workCenter.description = prep.next.description
        workCenter.isActive = prep.next.isActive
        workCenter.updatedAt = nextMonotonicTimestamp(workCenter.updatedAt)
        if (prep.membership.changed) {
          await syncMembership(em, scope, workCenter, prep.before.resourceIds, prep.membership.nextIds)
        }
      },
    }).catch((error) => mapCodeUniqueViolation(error))

    const workCenter = prepared.workCenter
    if (prepared.changed) {
      await emitWorkCenterEvent('manufacturing.work_center.updated', {
        id: workCenter.id,
        ...scope,
        updatedAt: workCenter.updatedAt.toISOString(),
        membershipChanged: prepared.membership.changed,
      })
    }
    return {
      workCenter,
      resourceIds: prepared.membership.nextIds,
      membershipChanged: prepared.membership.changed,
      before: prepared.before,
    }
  },
  buildLog: ({ result, ctx }) => {
    const after = snapshotOf(result.workCenter, result.resourceIds)
    return {
      resourceKind: WORK_CENTER_RESOURCE_KIND,
      resourceId: result.workCenter.id,
      tenantId: result.workCenter.tenantId,
      organizationId: result.workCenter.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotBefore: result.before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: result.before ?? null, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: WorkCenterSnapshot | null; after: WorkCenterSnapshot | null }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_undo_forbidden')
    const version = reversalVersion(after.updatedAt)
    await applyReversal(ctx, scope, { expected: after, restore: before, version })
    await emitWorkCenterEvent('manufacturing.work_center.updated', {
      id: before.id,
      ...scope,
      updatedAt: version.toISOString(),
      membershipChanged: !isSameMembership(after.resourceIds, before.resourceIds),
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: WorkCenterSnapshot | null; after: WorkCenterSnapshot | null }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) {
      throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'missing_snapshot' })
    }
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_redo_forbidden')
    const undoneVersion = reversalVersion(after.updatedAt)
    const expected: WorkCenterSnapshot = { ...before, updatedAt: undoneVersion.toISOString() }
    const version = reversalVersion(undoneVersion)
    const workCenter = await applyReversal(ctx, scope, { expected, restore: after, version })
    await emitWorkCenterEvent('manufacturing.work_center.updated', {
      id: after.id,
      ...scope,
      updatedAt: version.toISOString(),
      membershipChanged: !isSameMembership(before.resourceIds, after.resourceIds),
    })
    return {
      workCenter,
      resourceIds: after.resourceIds,
      membershipChanged: !isSameMembership(before.resourceIds, after.resourceIds),
      before,
    }
  },
}

/**
 * Shared undo/redo body for an update reversal: lock, prove the record is in
 * exactly the expected state, re-check historical code uniqueness, pay for the
 * provider when the membership set actually moves, then restore.
 */
async function applyReversal(
  ctx: CommandRuntimeContext,
  scope: WorkCenterScope,
  args: { expected: WorkCenterSnapshot; restore: WorkCenterSnapshot; version: Date },
): Promise<ManufacturingWorkCenter> {
  let target: ManufacturingWorkCenter | null = null
  await runWorkCenterWrite({
    ctx,
    scope,
    action: 'updated',
    target: () => target as ManufacturingWorkCenter,
    prepare: async (em) => {
      await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, args.expected.id)
      const workCenter = await findScopedWorkCenter(em, scope, args.expected.id)
      if (!workCenter) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'record_gone' })
      const resourceIds = await loadMembership(em, scope, workCenter.id)
      assertExactState(snapshotOf(workCenter, resourceIds), args.expected)
      const membershipChanged = !isSameMembership(resourceIds, args.restore.resourceIds)
      if (membershipChanged) {
        await resolveOptionalResourceReferences(ctx.container, args.restore.resourceIds, {
          ...scope,
          actorId: actorOf(ctx),
        })
      }
      if (args.restore.code !== workCenter.code) {
        await assertCodeAvailable(em, scope, args.restore.code, workCenter.id, 'work_center_restore_code_conflict')
      }
      target = workCenter
      return { workCenter, currentIds: resourceIds, membershipChanged }
    },
    apply: async (em, prep) => {
      const workCenter = prep.workCenter
      workCenter.code = args.restore.code
      workCenter.name = args.restore.name
      workCenter.description = args.restore.description
      workCenter.isActive = args.restore.isActive
      workCenter.updatedAt = args.version
      if (prep.membershipChanged) {
        await syncMembership(em, scope, workCenter, prep.currentIds, args.restore.resourceIds)
      }
    },
  }).catch((error) => mapCodeUniqueViolation(error, 'work_center_restore_code_conflict'))
  return target as unknown as ManufacturingWorkCenter
}

// ---------------------------------------------------------------------------
// manufacturing.work_center.delete
// ---------------------------------------------------------------------------

export type DeleteWorkCenterCommandInput = {
  tenantId?: string | null
  organizationId?: string | null
  id: string
  expectedUpdatedAt?: string | null
}

const deleteWorkCenterCommand: CommandHandler<DeleteWorkCenterCommandInput, WorkCenterCommandResult> = {
  id: 'manufacturing.work_center.delete',
  isUndoable: true,
  execute: async (input, ctx) => {
    const scope = requireWorkCenterScope(ctx, input)
    let target: ManufacturingWorkCenter | null = null

    const prepared = await runWorkCenterWrite({
      ctx,
      scope,
      action: 'deleted',
      target: () => target as ManufacturingWorkCenter,
      prepare: async (em) => {
        const { workCenter, resourceIds } = await lockAndLoad(ctx, em, scope, input.id, input.expectedUpdatedAt)
        target = workCenter
        return { workCenter, before: snapshotOf(workCenter, resourceIds), resourceIds }
      },
      // Membership rows are retained: soft-deleting a Work Centre must not
      // discard the history of what it contained, and never touches resources.
      apply: async (_em, prep) => {
        const now = nextMonotonicTimestamp(prep.workCenter.updatedAt)
        prep.workCenter.deletedAt = now
        prep.workCenter.isActive = false
        prep.workCenter.updatedAt = now
      },
    })

    const workCenter = prepared.workCenter
    await emitWorkCenterEvent('manufacturing.work_center.deleted', {
      id: workCenter.id,
      ...scope,
      updatedAt: workCenter.updatedAt.toISOString(),
      deletedAt: (workCenter.deletedAt as Date).toISOString(),
    })
    return { workCenter, resourceIds: prepared.resourceIds, membershipChanged: false, before: prepared.before }
  },
  buildLog: ({ result, ctx }) => {
    const after = snapshotOf(result.workCenter, result.resourceIds)
    return {
      resourceKind: WORK_CENTER_RESOURCE_KIND,
      resourceId: result.workCenter.id,
      tenantId: result.workCenter.tenantId,
      organizationId: result.workCenter.organizationId,
      actorUserId: ctx.auth?.userId ?? null,
      snapshotBefore: result.before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: result.before ?? null, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: WorkCenterSnapshot | null; after: WorkCenterSnapshot | null }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) return
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_undo_forbidden')
    const version = reversalVersion(after.updatedAt)
    await restoreDeleted(ctx, scope, { expected: after, restore: before, version })
    await emitWorkCenterEvent('manufacturing.work_center.created', {
      id: before.id,
      ...scope,
      updatedAt: version.toISOString(),
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ before: WorkCenterSnapshot | null; after: WorkCenterSnapshot | null }>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after || !logEntry?.tenantId || !logEntry?.organizationId) {
      throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'missing_snapshot' })
    }
    const scope: WorkCenterScope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
    await assertCurrentManageGrant(ctx.container, actorOf(ctx), scope, 'work_center_redo_forbidden')
    const undoneVersion = reversalVersion(after.updatedAt)
    const expected: WorkCenterSnapshot = { ...before, updatedAt: undoneVersion.toISOString(), deletedAt: null }
    const version = reversalVersion(undoneVersion)
    let target: ManufacturingWorkCenter | null = null

    await runWorkCenterWrite({
      ctx,
      scope,
      action: 'deleted',
      target: () => target as ManufacturingWorkCenter,
      prepare: async (em) => {
        await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, before.id)
        const workCenter = await findScopedWorkCenter(em, scope, before.id)
        if (!workCenter) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'record_gone' })
        const resourceIds = await loadMembership(em, scope, workCenter.id)
        assertExactState(snapshotOf(workCenter, resourceIds), expected)
        target = workCenter
        return { workCenter }
      },
      apply: async (_em, { workCenter }) => {
        workCenter.deletedAt = version
        workCenter.isActive = false
        workCenter.updatedAt = version
      },
    })

    const workCenter = target as unknown as ManufacturingWorkCenter
    await emitWorkCenterEvent('manufacturing.work_center.deleted', {
      id: before.id,
      ...scope,
      updatedAt: version.toISOString(),
      deletedAt: version.toISOString(),
    })
    return { workCenter, resourceIds: before.resourceIds, membershipChanged: false, before }
  },
}

/**
 * Delete undo. Two concurrent attempts serialize on the aggregate advisory
 * lock; the loser no longer sees the recorded post-delete state and refuses
 * with the standard conflict rather than restoring twice.
 */
async function restoreDeleted(
  ctx: CommandRuntimeContext,
  scope: WorkCenterScope,
  args: { expected: WorkCenterSnapshot; restore: WorkCenterSnapshot; version: Date },
): Promise<void> {
  let target: ManufacturingWorkCenter | null = null
  await runWorkCenterWrite({
    ctx,
    scope,
    action: 'created',
    target: () => target as ManufacturingWorkCenter,
    prepare: async (em) => {
      await acquireWorkCenterLock(em, scope.tenantId, scope.organizationId, args.expected.id)
      const workCenter = await findScopedWorkCenter(em, scope, args.expected.id, { includeDeleted: true })
      if (!workCenter) throw new WorkCenterDomainError('optimistic_lock_conflict', { reason: 'record_gone' })
      const resourceIds = await loadMembership(em, scope, workCenter.id)
      assertExactState(snapshotOf(workCenter, resourceIds), args.expected)
      // Reactivating may collide with a code another live record took while
      // this one was deleted.
      await assertCodeAvailable(em, scope, args.restore.code, workCenter.id, 'work_center_restore_code_conflict')
      target = workCenter
      return { workCenter }
    },
    // Membership already remains stored, so a delete undo revalidates nothing
    // and never restores a resource in the resources module.
    apply: async (_em, { workCenter }) => {
      workCenter.deletedAt = null
      workCenter.isActive = args.restore.isActive
      workCenter.updatedAt = args.version
    },
  }).catch((error) => mapCodeUniqueViolation(error, 'work_center_restore_code_conflict'))
}

/**
 * Domain code stays transport-agnostic; the localized `{ error, code }`
 * envelope is applied once, at the handler boundary, for execute, undo and
 * redo alike. A `CrudHttpError` raised by the canonical optimistic-lock guard
 * passes through unchanged so the shared conflict bar still recognises it.
 */
function withHttpErrorEnvelope<TInput, TResult>(
  handler: CommandHandler<TInput, TResult>,
): CommandHandler<TInput, TResult> {
  const wrap = <TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => TReturn | Promise<TReturn>) =>
    withLocalizedWorkCenterErrors(async (...args: TArgs) => fn(...args))
  return {
    ...handler,
    execute: wrap(handler.execute),
    ...(handler.undo ? { undo: wrap(handler.undo) } : {}),
    ...(handler.redo ? { redo: wrap(handler.redo) } : {}),
  }
}

const createWorkCenter = withHttpErrorEnvelope(createWorkCenterCommand)
const updateWorkCenter = withHttpErrorEnvelope(updateWorkCenterCommand)
const deleteWorkCenter = withHttpErrorEnvelope(deleteWorkCenterCommand)

registerCommand(createWorkCenter)
registerCommand(updateWorkCenter)
registerCommand(deleteWorkCenter)

export { createWorkCenter, updateWorkCenter, deleteWorkCenter }
export { createWorkCenterCommand, updateWorkCenterCommand, deleteWorkCenterCommand }
