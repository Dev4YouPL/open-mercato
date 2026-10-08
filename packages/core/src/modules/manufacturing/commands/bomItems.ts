import type { EntityManager } from '@mikro-orm/postgresql'

import { E } from '#generated/entities.ids.generated'

import {
  registerCommand,
} from '@open-mercato/shared/lib/commands'
import type {
  CommandHandler,
  CommandLogMetadata,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import {
  withAtomicFlush,
} from '@open-mercato/shared/lib/commands/flush'
import {
  emitCrudSideEffects,
} from '@open-mercato/shared/lib/commands/helpers'
import {
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type {
  CrudEventsConfig,
  CrudIndexerConfig,
} from '@open-mercato/shared/lib/crud/types'
import type {
  DataEngine,
} from '@open-mercato/shared/lib/data/engine'
import {
  resolveTranslations,
} from '@open-mercato/shared/lib/i18n/server'

import {
  ManufacturingBomItem,
} from '../data/entities'
import {
  bomItemCreateSchema,
  bomItemUpdateSchema,
  bomItemDeleteSchema,
} from '../data/validators'
import type {
  BomItemCreateInput,
  BomItemUpdateInput,
  BomItemDeleteInput,
} from '../data/validators'
import {
  requireLockedDraftBom,
  requireScopedBomItem,
  resolveBomCommandScope,
} from '../lib/bomCommandHelpers'
import {
  requireAvailableCatalogVariant,
} from '../lib/catalogVariants'

type BomItemResult = {
  bomItemId: string
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

type BomItemAuditSnapshots = {
  before: BomItemSnapshot | null
  after: BomItemSnapshot | null
}

type BomItemMutation =
  | {
      operation: 'create'
      input: BomItemCreateInput
    }
  | {
      operation: 'update'
      input: BomItemUpdateInput
    }
  | {
      operation: 'delete'
      input: BomItemDeleteInput
    }

const executionSnapshots = new WeakMap<
  BomItemResult,
  BomItemAuditSnapshots
>()

const bomItemEntityId =
  E.manufacturing.manufacturing_bom_item

const bomItemCrudEvents:
  CrudEventsConfig<ManufacturingBomItem> = {
    module: 'manufacturing',
    entity: 'bom_item',
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      tenantId: identifiers.tenantId,
      organizationId: identifiers.organizationId,
    }),
  }

const bomItemCrudIndexer:
  CrudIndexerConfig<ManufacturingBomItem> = {
    entityType: bomItemEntityId,
    cacheAliases: ['manufacturing.bom_items'],
  }

function snapshotBomItem(
  item: ManufacturingBomItem,
): BomItemSnapshot {
  return {
    id: item.id,
    bomId: item.bom.id,
    tenantId: item.tenantId,
    organizationId: item.organizationId,
    componentVariantId: item.componentVariantId,
    quantity: item.quantity,
    position: item.position,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() ?? null,
  }
}

async function executeBomItemMutation(
  mutation: BomItemMutation,
  ctx: CommandRuntimeContext,
): Promise<BomItemResult> {
  const { translate } = await resolveTranslations()

  const scope = resolveBomCommandScope(
    ctx,
    translate('manufacturing.errors.scopeRequired'),
  )

  const em =
    ctx.transactionalEm ??
    ctx.container.resolve<EntityManager>('em').fork()

  let item!: ManufacturingBomItem
  let before: BomItemSnapshot | null = null
  let after: BomItemSnapshot | null = null
  let changed = true

  await withAtomicFlush(
    em,
    [
      async () => {
        const bom = await requireLockedDraftBom(
          em,
          mutation.input.bomId,
          scope,
          translate,
        )

        if (mutation.operation === 'create') {
          await requireAvailableCatalogVariant(
            em,
            mutation.input.componentVariantId,
            scope,
            translate(
              'manufacturing.errors.componentVariantUnavailable',
            ),
          )

          item = em.create(ManufacturingBomItem, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            bom,
            componentVariantId:
              mutation.input.componentVariantId,
            quantity: mutation.input.quantity,
            position: mutation.input.position,
          })

          em.persist(item)

          return
        }

        item = await requireScopedBomItem(
          em,
          mutation.input.id,
          bom.id,
          scope,
          translate(
            'manufacturing.errors.bomItemUnavailable',
          ),
        )

        await enforceCommandOptimisticLockWithGuards(
          ctx.container,
          {
            resourceKind: 'manufacturing.bom_item',
            resourceId: item.id,
            current: item.updatedAt,
            request: ctx.request,
          },
        )

        if (mutation.operation === 'update') {
          const finalValues = bomItemCreateSchema.parse({
            bomId: bom.id,
            componentVariantId:
              mutation.input.componentVariantId ??
              item.componentVariantId,
            quantity:
              mutation.input.quantity ?? item.quantity,
            position:
              mutation.input.position ?? item.position,
          })

          await requireAvailableCatalogVariant(
            em,
            finalValues.componentVariantId,
            scope,
            translate(
              'manufacturing.errors.componentVariantUnavailable',
            ),
          )

          changed =
            finalValues.componentVariantId !==
              item.componentVariantId ||
            finalValues.quantity !== item.quantity ||
            finalValues.position !== item.position

          if (!changed) {
            return
          }

          before = snapshotBomItem(item)

          item.componentVariantId =
            finalValues.componentVariantId
          item.quantity = finalValues.quantity
          item.position = finalValues.position
          item.updatedAt = new Date()

          em.persist(item)

          return
        }

        before = snapshotBomItem(item)

        const deletedAt = new Date()

        item.deletedAt = deletedAt
        item.updatedAt = deletedAt

        em.persist(item)
      },

      () => {
        if (changed && mutation.operation !== 'delete') {
          after = snapshotBomItem(item)
        }
      },
    ],
    {
      transaction: !ctx.transactionalEm,
      label: `manufacturing.bom_items.${mutation.operation}`,
    },
  )

  const result: BomItemResult = {
    bomItemId: item.id,
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
    entity: item,
    identifiers: {
      id: item.id,
      tenantId: item.tenantId,
      organizationId: item.organizationId,
    },
    syncOrigin: ctx.syncOrigin ?? null,
    events: bomItemCrudEvents,
    indexer: bomItemCrudIndexer,
  })

  executionSnapshots.set(result, {
    before,
    after,
  })

  return result
}

async function buildBomItemLog(
  result: BomItemResult,
  operation: BomItemMutation['operation'],
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
      `manufacturing.audit.bom_item.${operation}`,
    ),
    resourceKind: 'manufacturing.bom_item',
    resourceId: record.id,
    parentResourceKind: 'manufacturing.bom',
    parentResourceId: record.bomId,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
  }
}

const createBomItemCommand: CommandHandler<
  BomItemCreateInput,
  BomItemResult
> = {
  id: 'manufacturing.bom_items.create',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomItemMutation(
      {
        operation: 'create',
        input: bomItemCreateSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter(_input, result) {
    return executionSnapshots.get(result)?.after
  },

  buildLog({ result }) {
    return buildBomItemLog(result, 'create')
  },
}

const updateBomItemCommand: CommandHandler<
  BomItemUpdateInput,
  BomItemResult
> = {
  id: 'manufacturing.bom_items.update',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomItemMutation(
      {
        operation: 'update',
        input: bomItemUpdateSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter(_input, result) {
    return executionSnapshots.get(result)?.after
  },

  buildLog({ result }) {
    return buildBomItemLog(result, 'update')
  },
}

const deleteBomItemCommand: CommandHandler<
  BomItemDeleteInput,
  BomItemResult
> = {
  id: 'manufacturing.bom_items.delete',
  isUndoable: false,

  execute(input, ctx) {
    return executeBomItemMutation(
      {
        operation: 'delete',
        input: bomItemDeleteSchema.parse(input),
      },
      ctx,
    )
  },

  captureAfter() {
    return null
  },

  buildLog({ result }) {
    return buildBomItemLog(result, 'delete')
  },
}

registerCommand(createBomItemCommand)
registerCommand(updateBomItemCommand)
registerCommand(deleteBomItemCommand)

export {
  createBomItemCommand,
  updateBomItemCommand,
  deleteBomItemCommand,
}