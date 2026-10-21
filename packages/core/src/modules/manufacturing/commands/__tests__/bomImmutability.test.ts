import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'

import type {
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../../data/entities'
import { bomUpdateSchema } from '../../data/validators'
import {
  releaseBomCommand,
  updateBomCommand,
} from '../booms'
import {
  createBomItemCommand,
  deleteBomItemCommand,
  updateBomItemCommand,
} from '../bomItems'

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../lib/catalogVariants', () => ({
  requireAvailableCatalogVariant: jest.fn(),
  loadCatalogVariantsForRelease: jest.fn(),
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

const persist = jest.fn()
const createEntity = jest.fn()
const markOrmEntityChange = jest.fn()
const flushOrmEntityChanges = jest.fn()
const emitEvent = jest.fn()

let em: EntityManager
let ctx: CommandRuntimeContext
let bom: ManufacturingBom

beforeEach(() => {
  jest.clearAllMocks()

  const emMock = {
    fork: jest.fn(),
    persist,
    create: createEntity,
    isInTransaction: jest.fn(() => true),
    execute: jest.fn(async (sql: string) => sql.includes('transaction_isolation') ? [{ level: 'read committed' }] : undefined),
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
    request: new Request('http://localhost/api/manufacturing/boms'),
  }

  bom = new ManufacturingBom()
  bom.id = bomId
  bom.tenantId = scope.tenantId
  bom.organizationId = scope.organizationId
  bom.outputVariantId = outputVariantId
  bom.baseQuantity = '1'
  bom.revision = '2'
  bom.status = 'released'
  bom.isIncomplete = false
  bom.releasedAt = new Date(timestamp)
  bom.releasedByUserId = userId
  bom.updatedAt = new Date(timestamp)

  jest.mocked(findOneWithDecryption).mockReset()
  jest.mocked(findOneWithDecryption).mockResolvedValue(bom)

  jest.mocked(findWithDecryption).mockReset()
})

type MutationCase = {
  name: string
  execute: () => Promise<unknown>
}

const mutationCases: MutationCase[] = [
  {
    name: 'changing the base quantity',
    execute: () => updateBomCommand.execute(
      { id: bomId, baseQuantity: '2' },
      ctx,
    ),
  },
  {
    name: 'changing the output variant',
    execute: () => updateBomCommand.execute(
      { id: bomId, outputVariantId: componentVariantId },
      ctx,
    ),
  },
  {
    name: 'creating an item',
    execute: () => createBomItemCommand.execute(
      {
        bomId,
        componentVariantId,
        quantity: '1',
        position: 1,
      },
      ctx,
    ),
  },
  {
    name: 'updating an item',
    execute: () => updateBomItemCommand.execute(
      {
        id: itemId,
        bomId,
        quantity: '2',
      },
      ctx,
    ),
  },
  {
    name: 'deleting an item',
    execute: () => deleteBomItemCommand.execute(
      {
        id: itemId,
        bomId,
      },
      ctx,
    ),
  },
  {
    name: 'releasing the BOM again',
    execute: () => releaseBomCommand.execute(
      {
        id: bomId,
        expectedItems: [],
      },
      ctx,
    ),
  },
]

describe('released BOM immutability', () => {
  it.each(mutationCases)(
    'rejects $name without writing or emitting events',
    async ({ execute }) => {
      await expect(execute()).rejects.toMatchObject({
        status: 409,
        body: {
          error: 'manufacturing.errors.bomNotDraft',
        },
      })

      expect(findOneWithDecryption).toHaveBeenCalledWith(
        em,
        ManufacturingBom,
        {
          id: bomId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        {
          lockMode: LockMode.PESSIMISTIC_WRITE,
          refresh: true,
        },
        scope,
      )

      expect(findWithDecryption).not.toHaveBeenCalled()
      expect(createEntity).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
      expect(markOrmEntityChange).not.toHaveBeenCalled()
      expect(flushOrmEntityChanges).not.toHaveBeenCalled()
      expect(emitEvent).not.toHaveBeenCalled()

      expect(bom.status).toBe('released')
      expect(bom.baseQuantity).toBe('1')
      expect(bom.outputVariantId).toBe(outputVariantId)
      expect(bom.releasedAt?.toISOString()).toBe(timestamp)
      expect(bom.updatedAt.toISOString()).toBe(timestamp)
    },
  )

  it.each(['draft', 'released'])(
    'rejects status=%s in the update schema',
    (status) => {
      const result = bomUpdateSchema.safeParse({
        id: bomId,
        status,
      })

      expect(result.success).toBe(false)
    },
  )

  it('returns 404 when the scoped BOM lookup finds nothing', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)

    await expect(
      releaseBomCommand.execute(
        {
          id: bomId,
          expectedItems: [],
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 404,
      body: {
        error: 'manufacturing.errors.bomUnavailable',
      },
    })

    expect(persist).not.toHaveBeenCalled()
    expect(markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
