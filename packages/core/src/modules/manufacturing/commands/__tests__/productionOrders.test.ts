/** @jest-environment node */

import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { BomRevisionForOrderDto } from '../../ports/bomRevisionReader'
import { createProductionOrderCommand } from '../productionOrders'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const productVariantId = '11111111-1111-4111-8111-111111111111'
const bomRevisionId = '22222222-2222-4222-8222-222222222222'
const sourceLocationId = '33333333-3333-4333-8333-333333333333'
const targetLocationId = '44444444-4444-4444-8444-444444444444'

const revision: BomRevisionForOrderDto = {
  id: bomRevisionId,
  productVariantId,
  isReleased: true,
  isAvailable: true,
  components: [],
}

const rawInput = { productVariantId, bomRevisionId, plannedQuantity: 5, sourceLocationId, targetLocationId, dueAt: null }

function buildContext(organizationId: string | null = 'org-1') {
  const create = jest.fn(async () => ({ id: 'order-1', orderNumber: 'PO-000001' }))
  const markOrmEntityChange = jest.fn()
  const container = createContainer()
  container.register({
    manufacturingBomRevisionReader: asValue({ getForOrder: jest.fn(async () => revision) }),
    manufacturingInventoryPolicyReader: asValue({
      getTrackingPolicy: jest.fn(async () => ({
        status: 'resolved',
        policy: { tracksLot: false, tracksSerial: false, tracksExpiry: false },
      })),
      getActiveLocation: jest.fn(async (id: string) => (id === targetLocationId || id === sourceLocationId ? { id, warehouseId: 'w', code: 'A', type: 'bin' } : null)),
      listActiveLocations: jest.fn(async () => []),
    }),
    manufacturingProductionOrderStore: asValue({ create }),
    em: asValue({ fork: () => ({ findOne: jest.fn(async () => ({ id: 'order-1', organizationId: 'org-1', tenantId: 'tenant-1' })) }) }),
    dataEngine: asValue({ markOrmEntityChange }),
  })
  const ctx = {
    container,
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: organizationId ? [organizationId] : null,
  } as unknown as CommandRuntimeContext
  return { ctx, create, markOrmEntityChange }
}

describe('create production order command', () => {
  it('creates the order within the selected organization and returns its number', async () => {
    const { ctx, create } = buildContext()

    expect(await createProductionOrderCommand.execute(rawInput, ctx)).toEqual({ orderId: 'order-1', orderNumber: 'PO-000001' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ productVariantId, plannedQuantity: 5 }), {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('marks the created order for indexing and cache invalidation', async () => {
    const { ctx, markOrmEntityChange } = buildContext()

    await createProductionOrderCommand.execute(rawInput, ctx)

    expect(markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created',
        identifiers: { id: 'order-1', organizationId: 'org-1', tenantId: 'tenant-1' },
        indexer: { entityType: 'manufacturing:production_order' },
      }),
    )
  })

  it('turns a business rejection into a 422 with the code and the field error', async () => {
    const { ctx, create } = buildContext()

    const error = await Promise.resolve(createProductionOrderCommand.execute({ ...rawInput, targetLocationId: null }, ctx)).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(CrudHttpError)
    expect(error).toMatchObject({
      status: 422,
      body: { code: 'location_missing', fieldErrors: { targetLocationId: 'Select a location.' } },
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects malformed input before reaching the use case', async () => {
    const { ctx, create } = buildContext()

    await expect(createProductionOrderCommand.execute({ ...rawInput, bomRevisionId: 'not-a-uuid' }, ctx)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses to run without an organization in scope', async () => {
    const { ctx } = buildContext(null)

    await expect(createProductionOrderCommand.execute(rawInput, ctx)).rejects.toMatchObject({ status: 403 })
  })

  it('logs the created order as the audited resource', async () => {
    const { ctx } = buildContext()

    const log = await createProductionOrderCommand.buildLog?.({
      input: rawInput,
      result: { orderId: 'order-1', orderNumber: 'PO-000001' },
      ctx,
      snapshots: {},
    })

    expect(log).toMatchObject({ resourceKind: 'manufacturing.production_order', resourceId: 'order-1', organizationId: 'org-1' })
  })
})
