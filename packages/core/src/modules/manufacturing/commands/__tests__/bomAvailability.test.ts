import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

import { ManufacturingBom } from '../../data/entities'
import { loadActiveBomItems, requireLockedBom, resolveBomCommandScope } from '../../lib/bomCommandHelpers'
import { setBomAvailabilityCommand } from '../booms'

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => void | Promise<void>>) => {
    for (const phase of phases) await phase()
  }),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })) }))
jest.mock('../../lib/bomCommandHelpers', () => ({
  loadActiveBomItems: jest.fn(),
  requireLockedBom: jest.fn(),
  requireLockedDraftBom: jest.fn(),
  requireScopedBomItem: jest.fn(),
  resolveBomCommandScope: jest.fn(),
}))
jest.mock('../../lib/catalogVariants', () => ({ loadCatalogVariantsForRelease: jest.fn(), requireAvailableCatalogVariant: jest.fn() }))
jest.mock('../../lib/wmsTrackingPolicy', () => ({ loadEffectiveTrackingPolicies: jest.fn(), resolveEffectiveTrackingPolicy: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn() }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const bomId = '33333333-3333-4333-8333-333333333333'
const outputVariantId = '44444444-4444-4444-8444-444444444444'
const eventEmit = jest.fn(async () => undefined)
const flush = jest.fn(async () => undefined)
const persist = jest.fn()
const emMock = {
  fork: jest.fn(),
  persist,
  getTransactionContext: jest.fn(() => undefined),
}
const em = emMock as unknown as EntityManager
const scope = { tenantId, organizationId }
let bom: ManufacturingBom
let ctx: CommandRuntimeContext

beforeEach(() => {
  jest.clearAllMocks()
  emMock.fork.mockReturnValue(em)
  bom = Object.assign(new ManufacturingBom(), {
    id: bomId,
    tenantId,
    organizationId,
    outputVariantId,
    baseQuantity: '1',
    revision: '4',
    status: 'released' as const,
    isIncomplete: false,
    isAvailableForNewOrders: true,
    updatedAt: new Date('2026-10-20T10:00:00.000Z'),
  })
  const container = createContainer()
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn(), flushOrmEntityChanges: flush }),
    eventBus: asValue({ emitEvent: eventEmit }),
  })
  ctx = {
    container,
    auth: { sub: '77777777-7777-4777-8777-777777777777', tenantId, orgId: organizationId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: new Request('http://localhost/api/manufacturing/boms/availability'),
  }
  jest.mocked(resolveBomCommandScope).mockReturnValue(scope)
  jest.mocked(requireLockedBom).mockResolvedValue(bom)
  jest.mocked(loadActiveBomItems).mockReset()
})

describe('setBomAvailabilityCommand', () => {
  it('changes only availability, checks the record version, and emits after commit effects', async () => {
    const unchanged = {
      status: bom.status,
      releasedAt: bom.releasedAt,
      releasedByUserId: bom.releasedByUserId,
      isIncomplete: bom.isIncomplete,
      revision: bom.revision,
      baseQuantity: bom.baseQuantity,
    }
    const result = await setBomAvailabilityCommand.execute({ id: bomId, isAvailableForNewOrders: false }, ctx)
    expect(result).toMatchObject({ bomId, isAvailableForNewOrders: false })
    expect(result.updatedAt).not.toBe('2026-10-20T10:00:00.000Z')
    expect(bom).toMatchObject({ status: 'released', isIncomplete: false, isAvailableForNewOrders: false })
    expect({
      status: bom.status,
      releasedAt: bom.releasedAt,
      releasedByUserId: bom.releasedByUserId,
      isIncomplete: bom.isIncomplete,
      revision: bom.revision,
      baseQuantity: bom.baseQuantity,
    }).toEqual(unchanged)
    expect(loadActiveBomItems).not.toHaveBeenCalled()
    expect(enforceCommandOptimisticLockWithGuards).toHaveBeenCalledWith(ctx.container, {
      resourceKind: 'manufacturing.bom', resourceId: bomId, current: new Date('2026-10-20T10:00:00.000Z'), request: ctx.request,
    })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(eventEmit).toHaveBeenCalledWith('manufacturing.bom.availability_changed', expect.objectContaining({
      id: bomId, isAvailableForNewOrders: false, revision: '4',
    }), expect.objectContaining({ persistent: true, tenantId, organizationId }))
  })

  it('does nothing when the current value already matches', async () => {
    const currentUpdatedAt = bom.updatedAt
    const result = await setBomAvailabilityCommand.execute({ id: bomId, isAvailableForNewOrders: true }, ctx)
    expect(result.updatedAt).toBe(currentUpdatedAt.toISOString())
    expect(persist).not.toHaveBeenCalled()
    expect(enforceCommandOptimisticLockWithGuards).toHaveBeenCalledTimes(1)
    expect(eventEmit).not.toHaveBeenCalled()
  })

  it('rejects draft revisions before checking optimistic locking', async () => {
    bom.status = 'draft'
    await expect(setBomAvailabilityCommand.execute({ id: bomId, isAvailableForNewOrders: false }, ctx))
      .rejects.toMatchObject({ status: 409, body: { code: 'manufacturing.bom_availability.not_released' } })
    expect(enforceCommandOptimisticLockWithGuards).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(eventEmit).not.toHaveBeenCalled()
  })
})
