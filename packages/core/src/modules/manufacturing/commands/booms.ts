import type { EntityManager } from '@mikro-orm/postgresql'

import { E } from '#generated/entities.ids.generated'

import { registerCommand } from '@open-mercato/shared/lib/commands'
import type {
  CommandHandler,
  CommandLogMetadata,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import {
  loadActiveBomItems,
  requireLockedDraftBom,
  resolveBomCommandScope,
} from '../lib/bomCommandHelpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type {
  CrudEventsConfig,
  CrudIndexerConfig,
} from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import {
  ManufacturingBom,
  ManufacturingBomItem,
} from '../data/entities'
import type { ManufacturingBomStatus } from '../data/entities'
import {
  bomCreateSchema,
  bomDeleteSchema,
  bomReleaseSchema,
  bomUpdateSchema,
} from '../data/validators'
import type {
  BomCreateInput,
  BomDeleteInput,
  BomReleaseInput,
  BomUpdateInput,
} from '../data/validators'
import {
  loadCatalogVariantsForRelease,
  requireAvailableCatalogVariant,
} from '../lib/catalogVariants'
import {
  CrudHttpError,
  conflict,
  isUniqueViolation,
} from '@open-mercato/shared/lib/crud/errors'

import { resolveNextBomRevision } from '../lib/bomRevisions'

import type { EventBus } from '@open-mercato/events/types'

import type { BomReleasedEventPayload } from '../events'
import { runBomCommitEffects } from '../lib/bomCommitEffects'
import {
  collectReleaseVariantIds,
  findTrackingViolations,
  hasReleaseItemsChanged,
  isIncompleteRelease,
} from '../lib/bomRelease'
import {
  loadEffectiveTrackingPolicies,
} from '../lib/wmsTrackingPolicy'

type BomResult = {
  bomId: string
}

type BomReleaseResult = BomResult & {
  isIncomplete: boolean
}

type BomItemSnapshot = {
  id: string
  bomId: string
  tenantId: string
  organizationId: string
  componentVariantId: string
  quantity: string
  position: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type BomSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  outputVariantId: string
  baseQuantity: string
  revision: string
  status: ManufacturingBomStatus
  isIncomplete: boolean
  releasedAt: string | null
  releasedByUserId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  items: BomItemSnapshot[]
}

type BomAuditSnapshots = {
  before: BomSnapshot | null
  after: BomSnapshot | null
}

type BomMutation =
  | {
    operation: 'create'
    input: BomCreateInput
  }
  | {
    operation: 'update'
    input: BomUpdateInput
  }
  | {
    operation: 'delete'
    input: BomDeleteInput
  }

type Translate = (key: string) => string

const executionSnapshots = new WeakMap<
  BomResult,
  BomAuditSnapshots
>()

const bomEntityId = E.manufacturing.manufacturing_bom

const bomCrudEvents: CrudEventsConfig<ManufacturingBom> = {
  module: 'manufacturing',
  entity: 'bom',
  persistent: true,
  buildPayload: ({ identifiers }) => ({
    id: identifiers.id,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
  }),
}

const bomCrudIndexer: CrudIndexerConfig<ManufacturingBom> = {
  entityType: bomEntityId,
}

const bomItemCrudEvents: CrudEventsConfig<ManufacturingBomItem> = {
  module: 'manufacturing',
  entity: 'bom_item',
  persistent: true,
  buildPayload: ({ identifiers }) => ({
    id: identifiers.id,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
  }),
}

const bomItemCrudIndexer: CrudIndexerConfig<ManufacturingBomItem> = {
  entityType: E.manufacturing.manufacturing_bom_item,
}

function snapshotBom(
  bom: ManufacturingBom,
  items: ManufacturingBomItem[],
): BomSnapshot {
  return {
    id: bom.id,
    tenantId: bom.tenantId,
    organizationId: bom.organizationId,
    outputVariantId: bom.outputVariantId,
    baseQuantity: bom.baseQuantity,
    revision: bom.revision,
    status: bom.status,
    isIncomplete: bom.isIncomplete,
    releasedAt: bom.releasedAt?.toISOString() ?? null,
    releasedByUserId: bom.releasedByUserId ?? null,
    createdAt: bom.createdAt.toISOString(),
    updatedAt: bom.updatedAt.toISOString(),
    deletedAt: bom.deletedAt?.toISOString() ?? null,
    items: items.map((item) => ({
      id: item.id,
      bomId: bom.id,
      tenantId: item.tenantId,
      organizationId: item.organizationId,
      componentVariantId: item.componentVariantId,
      quantity: item.quantity,
      position: item.position,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      deletedAt: item.deletedAt?.toISOString() ?? null,
    })),
  }
}

async function executeBomMutation(
  mutation: BomMutation,
  ctx: CommandRuntimeContext,
): Promise<BomResult> {
  const { translate } = await resolveTranslations()

  const scope = resolveBomCommandScope(
    ctx,
    translate('manufacturing.errors.scopeRequired'),
  )

  const em =
    ctx.transactionalEm ??
    ctx.container.resolve<EntityManager>('em').fork()

  let bom!: ManufacturingBom
  let items: ManufacturingBomItem[] = []
  let before: BomSnapshot | null = null
  let after: BomSnapshot | null = null
  let changed = true

  await withAtomicFlush(
    em,
    [
      async () => {
        if (mutation.operation === 'create') {
          await requireAvailableCatalogVariant(
            em,
            mutation.input.outputVariantId,
            scope,
            translate(
              'manufacturing.errors.outputVariantUnavailable',
            ),
          )

          const revision = await resolveNextBomRevision(
            em,
            mutation.input.outputVariantId,
            scope,
          )

          bom = em.create(ManufacturingBom, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            outputVariantId: mutation.input.outputVariantId,
            baseQuantity: mutation.input.baseQuantity,
            revision,
            status: 'draft',
          })

          em.persist(bom)

          return
        }

        bom = await requireLockedDraftBom(
          em,
          mutation.input.id,
          scope,
          translate,
        )

        await enforceCommandOptimisticLockWithGuards(
          ctx.container,
          {
            resourceKind: 'manufacturing.bom',
            resourceId: bom.id,
            current: bom.updatedAt,
            request: ctx.request,
          },
        )

        if (mutation.operation === 'update') {
          const finalValues = bomCreateSchema.parse({
            outputVariantId:
              mutation.input.outputVariantId ??
              bom.outputVariantId,
            baseQuantity:
              mutation.input.baseQuantity ??
              bom.baseQuantity,
          })

          const outputVariantChanged =
            finalValues.outputVariantId !== bom.outputVariantId

          changed =
            outputVariantChanged ||
            finalValues.baseQuantity !== bom.baseQuantity

          if (!changed) {
            return
          }

          await requireAvailableCatalogVariant(
            em,
            finalValues.outputVariantId,
            scope,
            translate(
              'manufacturing.errors.outputVariantUnavailable',
            ),
          )

          items = await loadActiveBomItems(
            em,
            bom.id,
            scope,
          )

          const nextRevision = outputVariantChanged
            ? await resolveNextBomRevision(
              em,
              finalValues.outputVariantId,
              scope,
            )
            : bom.revision

          before = snapshotBom(bom, items)

          bom.outputVariantId = finalValues.outputVariantId
          bom.baseQuantity = finalValues.baseQuantity
          bom.revision = nextRevision
          bom.updatedAt = new Date()

          em.persist(bom)

          return
        }

        items = await loadActiveBomItems(
          em,
          bom.id,
          scope,
        )

        before = snapshotBom(bom, items)

        const now = new Date()

        bom.deletedAt = now
        bom.updatedAt = now

        for (const item of items) {
          item.deletedAt = now
          item.updatedAt = now
        }

        em.persist(bom)
        em.persist(items)
      },
      () => {
        if (changed && mutation.operation !== 'delete') {
          after = snapshotBom(bom, items)
        }
      },
    ],
    {
      transaction: !ctx.transactionalEm,
      label: `manufacturing.boms.${mutation.operation}`,
    },
  ).catch((error: unknown) => {
    if (
      isUniqueViolation(
        error,
        'manufacturing_boms_variant_revision_unique',
      )
    ) {
      throw conflict(
        translate('manufacturing.errors.revisionConflict'),
      )
    }

    throw error
  })

  const result: BomResult = {
    bomId: bom.id,
  }

  if (!changed) {
    return result
  }

  const dataEngine =
    ctx.container.resolve<DataEngine>('dataEngine')

  const action =
    mutation.operation === 'create'
      ? 'created'
      : mutation.operation === 'update'
        ? 'updated'
        : 'deleted'

  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: bom,
    identifiers: {
      id: bom.id,
      tenantId: bom.tenantId,
      organizationId: bom.organizationId,
    },
    events: bomCrudEvents,
    indexer: bomCrudIndexer,
  })

  if (mutation.operation === 'delete') {
    for (const item of items) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: item,
        identifiers: {
          id: item.id,
          tenantId: item.tenantId,
          organizationId: item.organizationId,
        },
        events: bomItemCrudEvents,
        indexer: bomItemCrudIndexer,
      })
    }
  }

  executionSnapshots.set(result, {
    before,
    after,
  })

  return result
}

async function executeBomRelease(
  input: BomReleaseInput,
  ctx: CommandRuntimeContext,
): Promise<BomReleaseResult> {
  const { translate } = await resolveTranslations()

  const scope = resolveBomCommandScope(
    ctx,
    translate('manufacturing.errors.scopeRequired'),
  )

  const em =
    ctx.transactionalEm ??
    ctx.container.resolve<EntityManager>('em').fork()

  const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
  const eventBus = ctx.container.resolve<EventBus>('eventBus')

  let bom!: ManufacturingBom
  let items: ManufacturingBomItem[] = []
  let before: BomSnapshot | null = null
  let after: BomSnapshot | null = null

  await withAtomicFlush(
    em,
    [
      async () => {
        bom = await requireLockedDraftBom(
          em,
          input.id,
          scope,
          translate,
        )

        await enforceCommandOptimisticLockWithGuards(
          ctx.container,
          {
            resourceKind: 'manufacturing.bom',
            resourceId: bom.id,
            current: bom.updatedAt,
            request: ctx.request,
          },
        )

        items = await loadActiveBomItems(
          em,
          bom.id,
          scope,
        )

        before = snapshotBom(bom, items)

        if (hasReleaseItemsChanged(input.expectedItems, items)) {
          throw new CrudHttpError(409, {
            error: translate(
              'manufacturing.errors.bomReleaseItemsChanged',
            ),
            code: 'manufacturing.bom_release.items_changed',
          })
        }

        const variantIds = collectReleaseVariantIds(bom, items)

        const variants = await loadCatalogVariantsForRelease(
          em,
          variantIds,
          scope,
        )

        const availableVariantIds = new Set(
          variants.map((variant) => variant.id.toLowerCase()),
        )

        const outputVariantId = bom.outputVariantId.toLowerCase()

        if (!availableVariantIds.has(outputVariantId)) {
          throw new CrudHttpError(422, {
            error: translate(
              'manufacturing.errors.outputVariantUnavailable',
            ),
            code: 'manufacturing.bom_release.output_variant_unavailable',
          })
        }

        const unavailableComponentIds = variantIds.filter(
          (variantId) =>
            variantId !== outputVariantId &&
            !availableVariantIds.has(variantId),
        )

        if (unavailableComponentIds.length > 0) {
          throw new CrudHttpError(422, {
            error: translate(
              'manufacturing.errors.componentVariantUnavailable',
            ),
            code: 'manufacturing.bom_release.component_variant_unavailable',
            variantIds: unavailableComponentIds,
          })
        }

        const policies = await loadEffectiveTrackingPolicies(
          ctx.container,
          variantIds,
          scope,
        )

        const violations = findTrackingViolations(
          variants,
          policies,
          bom.outputVariantId,
        )

        if (violations.length > 0) {
          throw new CrudHttpError(422, {
            error: translate(
              'manufacturing.errors.bomReleaseTrackingRequired',
            ),
            code: 'manufacturing.bom_release.tracking_required',
            violations,
          })
        }

        const now = new Date()

        bom.status = 'released'
        bom.isIncomplete = isIncompleteRelease(items)
        bom.releasedAt = now
        bom.releasedByUserId = ctx.auth?.sub ?? null
        bom.updatedAt = now

        em.persist(bom)
      },
      () => {
        after = snapshotBom(bom, items)
      },
    ],
    {
      transaction: !ctx.transactionalEm,
      label: 'manufacturing.boms.release',
    },
  )

  const result: BomReleaseResult = {
    bomId: bom.id,
    isIncomplete: bom.isIncomplete,
  }

  executionSnapshots.set(result, {
    before,
    after,
  })

  const payload: BomReleasedEventPayload = {
    id: bom.id,
    tenantId: bom.tenantId,
    organizationId: bom.organizationId,
    outputVariantId: bom.outputVariantId,
    revision: bom.revision,
    isIncomplete: bom.isIncomplete,
  }

  await runBomCommitEffects(em, async () => {
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: bom,
      identifiers: {
        id: bom.id,
        tenantId: bom.tenantId,
        organizationId: bom.organizationId,
      },
      events: bomCrudEvents,
      indexer: bomCrudIndexer,
    })

    await dataEngine.flushOrmEntityChanges(ctx.bulkImport)

    await eventBus.emitEvent(
      'manufacturing.bom.released',
      payload,
      {
        persistent: true,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    )
  })

  return result
}

async function buildBomLog(
  result: BomResult,
  operation: BomMutation['operation'] | 'release',
): Promise<CommandLogMetadata | null> {
  const snapshots = executionSnapshots.get(result)

  if (!snapshots) {
    return null
  }

  const record = snapshots.after ?? snapshots.before

  if (!record) {
    return null
  }

  const { translate } = await resolveTranslations()

  return {
    actionLabel: translate(
      `manufacturing.audit.bom.${operation}`,
    ),
    resourceKind: 'manufacturing.bom',
    resourceId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
  }
}

const createBomCommand: CommandHandler<
  BomCreateInput,
  BomResult
> = {
  id: 'manufacturing.boms.create',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomMutation(
      {
        operation: 'create',
        input: bomCreateSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter(_input, result) {
    return executionSnapshots.get(result)?.after
  },

  buildLog({ result }) {
    return buildBomLog(result, 'create')
  },
}

const updateBomCommand: CommandHandler<
  BomUpdateInput,
  BomResult
> = {
  id: 'manufacturing.boms.update',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomMutation(
      {
        operation: 'update',
        input: bomUpdateSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter(_input, result) {
    return executionSnapshots.get(result)?.after
  },

  buildLog({ result }) {
    return buildBomLog(result, 'update')
  },
}

const deleteBomCommand: CommandHandler<
  BomDeleteInput,
  BomResult
> = {
  id: 'manufacturing.boms.delete',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomMutation(
      {
        operation: 'delete',
        input: bomDeleteSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter() {
    return null
  },

  buildLog({ result }) {
    return buildBomLog(result, 'delete')
  },
}

const releaseBomCommand: CommandHandler<
  BomReleaseInput,
  BomReleaseResult
> = {
  id: 'manufacturing.boms.release',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomRelease(
      bomReleaseSchema.parse(input),
      ctx,
    )
  },

  captureAfter(_input, result) {
    return executionSnapshots.get(result)?.after
  },

  buildLog({ result }) {
    return buildBomLog(result, 'release')
  },
}

registerCommand(createBomCommand)
registerCommand(updateBomCommand)
registerCommand(deleteBomCommand)
registerCommand(releaseBomCommand)

export {
  createBomCommand,
  updateBomCommand,
  deleteBomCommand,
  releaseBomCommand
}