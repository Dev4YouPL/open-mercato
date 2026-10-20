import { EventManager, EventType } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'

import type {
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'

import {
  ManufacturingBom,
  ManufacturingBomItem,
} from '../../data/entities'
import {
  loadActiveBomItems,
  requireLockedDraftBom,
  resolveBomCommandScope,
} from '../../lib/bomCommandHelpers'
import {
  loadCatalogVariantsForRelease,
} from '../../lib/catalogVariants'
import {
  loadEffectiveTrackingPolicies,
} from '../../lib/wmsTrackingPolicy'
import { releaseBomCommand } from '../booms'

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(
    async (
      _em: unknown,
      phases: Array<() => void | Promise<void>>,
    ) => {
      for (const phase of phases) {
        await phase()
      }
    },
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string) => key,
  })),
}))

jest.mock('../../lib/bomCommandHelpers', () => ({
  loadActiveBomItems: jest.fn(),
  requireLockedDraftBom: jest.fn(),
  resolveBomCommandScope: jest.fn(),
}))

jest.mock('../../lib/catalogVariants', () => ({
  loadCatalogVariantsForRelease: jest.fn(),
  requireAvailableCatalogVariant: jest.fn(),
}))

jest.mock('../../lib/wmsTrackingPolicy', () => ({
  loadEffectiveTrackingPolicies: jest.fn(),
  resolveEffectiveTrackingPolicy: jest.fn(() => ({
    requiresLot: false,
    requiresSerial: false,
    requiresExpiration: false,
  })),
}))

jest.mock(
  '@open-mercato/shared/lib/crud/optimistic-lock-command',
  () => ({
    enforceCommandOptimisticLockWithGuards: jest.fn(),
  }),
)

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const bomId = '33333333-3333-4333-8333-333333333333'
const outputVariantId = '44444444-4444-4444-8444-444444444444'
const componentVariantId = '55555555-5555-4555-8555-555555555555'
const itemId = '66666666-6666-4666-8666-666666666666'
const userId = '77777777-7777-4777-8777-777777777777'

const timestamp = '2026-10-08T13:00:00.000Z'

const markOrmEntityChange = jest.fn()
const flushOrmEntityChanges = jest.fn()
const emitEvent = jest.fn()
const getTransactionContext = jest.fn()

let eventManager: EventManager
let em: EntityManager
let ctx: CommandRuntimeContext
let bom: ManufacturingBom
let item: ManufacturingBomItem

const input = {
  id: bomId,
  expectedItems: [{
    id: itemId,
    updatedAt: timestamp,
  }],
}

beforeEach(() => {
  jest.clearAllMocks()

  getTransactionContext.mockReturnValue(undefined)
  flushOrmEntityChanges.mockResolvedValue(undefined)
  emitEvent.mockResolvedValue(undefined)

  eventManager = new EventManager([])

  const emMock = {
    fork: jest.fn(),
    persist: jest.fn(),
    getTransactionContext,
    getEventManager: () => eventManager,
  }

  em = emMock as unknown as EntityManager
  emMock.fork.mockReturnValue(em)

  const container = createContainer()

  container.register({
    em: asValue(em),
    dataEngine: asValue({
      markOrmEntityChange,
      flushOrmEntityChanges,
    }),
    eventBus: asValue({ emitEvent }),
  })

  ctx = {
    container,
    auth: {
      sub: userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: new Request('http://localhost/api/manufacturing/boms/release'),
  }

  bom = new ManufacturingBom()
  bom.id = bomId
  bom.tenantId = scope.tenantId
  bom.organizationId = scope.organizationId
  bom.outputVariantId = outputVariantId
  bom.baseQuantity = '1'
  bom.revision = '2'
  bom.updatedAt = new Date(timestamp)

  item = new ManufacturingBomItem()
  item.id = itemId
  item.bom = bom
  item.tenantId = scope.tenantId
  item.organizationId = scope.organizationId
  item.componentVariantId = componentVariantId
  item.quantity = '1'
  item.position = 1
  item.updatedAt = new Date(timestamp)

  jest.mocked(resolveBomCommandScope).mockReturnValue(scope)
  jest.mocked(requireLockedDraftBom).mockResolvedValue(bom)
  jest.mocked(loadActiveBomItems).mockResolvedValue([item])

  jest.mocked(loadCatalogVariantsForRelease).mockResolvedValue([
    { id: outputVariantId, name: 'Output', sku: 'OUTPUT-01' },
    { id: componentVariantId, name: 'Component', sku: 'COMP-01' },
  ])

  jest.mocked(loadEffectiveTrackingPolicies).mockReset()
  jest.mocked(loadEffectiveTrackingPolicies).mockResolvedValue(new Map())

  jest.mocked(enforceCommandOptimisticLockWithGuards).mockReset()
  jest.mocked(enforceCommandOptimisticLockWithGuards)
    .mockResolvedValue(undefined)
})

describe('releaseBomCommand', () => {
  it('releases a BOM and records before/after snapshots', async () => {
    bom.isAvailableForNewOrders = false
    const result = await releaseBomCommand.execute(input, ctx)

    expect(result).toEqual({
      bomId,
      isIncomplete: false,
    })

    expect(bom.status).toBe('released')
    expect(bom.isAvailableForNewOrders).toBe(true)
    expect(bom.releasedAt).toBeInstanceOf(Date)
    expect(bom.releasedByUserId).toBe(userId)

    expect(enforceCommandOptimisticLockWithGuards)
      .toHaveBeenCalledWith(
        ctx.container,
        expect.objectContaining({
          resourceKind: 'manufacturing.bom',
          resourceId: bomId,
          request: ctx.request,
        }),
      )

    expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(flushOrmEntityChanges).toHaveBeenCalledTimes(1)

    expect(emitEvent).toHaveBeenCalledWith(
      'manufacturing.bom.released',
      {
        id: bomId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        outputVariantId,
        revision: '2',
        isIncomplete: false,
      },
      {
        persistent: true,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    )

    const log = await releaseBomCommand.buildLog?.({
      input,
      result,
      ctx,
      snapshots: {},
    })

    expect(log).toMatchObject({
      actionLabel: 'manufacturing.audit.bom.release',
      snapshotBefore: {
        status: 'draft',
        releasedAt: null,
      },
      snapshotAfter: {
        status: 'released',
        releasedByUserId: userId,
      },
    })

    expect(releaseBomCommand.isUndoable).toBe(false)
  })

  it('allows an empty BOM and marks it incomplete', async () => {
    jest.mocked(loadActiveBomItems).mockResolvedValue([])

    const result = await releaseBomCommand.execute(
      { id: bomId, expectedItems: [] },
      ctx,
    )

    expect(result.isIncomplete).toBe(true)
    expect(bom.status).toBe('released')
  })

  it('rejects changed items before writing', async () => {
    await expect(releaseBomCommand.execute(
      { id: bomId, expectedItems: [] },
      ctx,
    )).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'manufacturing.bom_release.items_changed',
      },
    })

    expect(bom.status).toBe('draft')
    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('rejects a missing output variant', async () => {
    jest.mocked(loadCatalogVariantsForRelease).mockResolvedValue([
      { id: componentVariantId, name: null, sku: null },
    ])

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toMatchObject({
      status: 422,
      body: {
        code: 'manufacturing.bom_release.output_variant_unavailable',
      },
    })

    expect(bom.status).toBe('draft')
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('rejects a missing component variant', async () => {
    jest.mocked(loadCatalogVariantsForRelease).mockResolvedValue([
      { id: outputVariantId, name: null, sku: null },
    ])

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toMatchObject({
      status: 422,
      body: {
        code: 'manufacturing.bom_release.component_variant_unavailable',
        variantIds: [componentVariantId],
      },
    })

    expect(bom.status).toBe('draft')
  })

  it('rejects WMS tracking requirements before writing', async () => {
    jest.mocked(loadEffectiveTrackingPolicies).mockResolvedValue(
      new Map([
        [
          componentVariantId,
          {
            requiresLot: true,
            requiresSerial: false,
            requiresExpiration: false,
          },
        ],
      ]),
    )

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toMatchObject({
      status: 422,
      body: {
        code: 'manufacturing.bom_release.tracking_required',
        violations: [{
          variantId: componentVariantId,
          role: 'component',
          requirements: ['lot'],
        }],
      },
    })

    expect(bom.status).toBe('draft')
    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('rejects output serial tracking without changing the BOM or writing', async () => {
    const before = {
      status: bom.status,
      isIncomplete: bom.isIncomplete,
      releasedAt: bom.releasedAt,
      releasedByUserId: bom.releasedByUserId,
      updatedAt: bom.updatedAt,
    }

    jest.mocked(loadEffectiveTrackingPolicies).mockResolvedValue(
      new Map([
        [
          outputVariantId,
          {
            requiresLot: false,
            requiresSerial: true,
            requiresExpiration: false,
          },
        ],
      ]),
    )

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toMatchObject({
      status: 422,
      body: {
        code: 'manufacturing.bom_release.tracking_required',
        violations: [
          {
            variantId: outputVariantId,
            role: 'output',
            name: 'Output',
            sku: 'OUTPUT-01',
            requirements: ['serial'],
          },
        ],
      },
    })

    expect({
      status: bom.status,
      isIncomplete: bom.isIncomplete,
      releasedAt: bom.releasedAt,
      releasedByUserId: bom.releasedByUserId,
      updatedAt: bom.updatedAt,
    }).toEqual(before)
    expect(em.persist).not.toHaveBeenCalled()
    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(flushOrmEntityChanges).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('propagates WMS read failures', async () => {
    const error = new Error('[internal] WMS unavailable')

    jest.mocked(loadEffectiveTrackingPolicies).mockRejectedValue(error)

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toBe(error)

    expect(bom.status).toBe('draft')
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('stops when optimistic locking rejects the request', async () => {
    const error = new Error('[internal] Version conflict')

    jest.mocked(enforceCommandOptimisticLockWithGuards)
      .mockRejectedValue(error)

    await expect(
      releaseBomCommand.execute(input, ctx),
    ).rejects.toBe(error)

    expect(loadActiveBomItems).not.toHaveBeenCalled()
    expect(bom.status).toBe('draft')
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('waits for the caller transaction to commit', async () => {
    const transaction = {} as NonNullable<
      ReturnType<EntityManager['getTransactionContext']>
    >

    getTransactionContext.mockReturnValue(transaction)
    ctx.transactionalEm = em

    await releaseBomCommand.execute(input, ctx)

    expect(withAtomicFlush).toHaveBeenCalledWith(
      em,
      expect.any(Array),
      {
        transaction: false,
        label: 'manufacturing.boms.release',
      },
    )

    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()

    await eventManager.dispatchEvent(
      EventType.afterTransactionCommit,
      { em, transaction },
    )

    expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(emitEvent).toHaveBeenCalledTimes(1)
  })

  it('discards effects when the caller transaction rolls back', async () => {
    const transaction = {} as NonNullable<
      ReturnType<EntityManager['getTransactionContext']>
    >

    getTransactionContext.mockReturnValue(transaction)
    ctx.transactionalEm = em

    await releaseBomCommand.execute(input, ctx)

    await eventManager.dispatchEvent(
      EventType.afterTransactionRollback,
      { em, transaction },
    )

    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
