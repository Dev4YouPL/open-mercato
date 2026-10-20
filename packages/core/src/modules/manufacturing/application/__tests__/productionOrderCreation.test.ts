/** @jest-environment node */

import type { BomRevisionForOrderDto, BomRevisionReader } from '../../ports/bomRevisionReader'
import type {
  InventoryLocationDto,
  InventoryPolicyReader,
  TrackingPolicyResultDto,
} from '../../ports/inventoryPolicyReader'
import type { ProductionOrderStore } from '../../ports/productionOrderStore'
import { createProductionOrder, type ProductionOrderInput } from '../productionOrderCreation'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const untracked: TrackingPolicyResultDto = {
  status: 'resolved',
  policy: { tracksLot: false, tracksSerial: false, tracksExpiry: false },
}

const locations: Record<string, InventoryLocationDto> = {
  'issue-location': { id: 'issue-location', warehouseId: 'warehouse-1', code: 'A-1', type: 'bin' },
  'receipt-location': { id: 'receipt-location', warehouseId: 'warehouse-1', code: 'B-1', type: 'bin' },
}

const releasedRevision: BomRevisionForOrderDto = {
  id: 'revision-1',
  productVariantId: 'table',
  isReleased: true,
  isAvailable: true,
  components: [
    { variantId: 'leg', quantity: 4 },
    { variantId: 'top', quantity: 1 },
    { variantId: 'leg', quantity: 2 },
  ],
}

const input: ProductionOrderInput = {
  productVariantId: 'table',
  bomRevisionId: 'revision-1',
  plannedQuantity: 10,
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
  dueAt: null,
}

function build(revision: BomRevisionForOrderDto | null = releasedRevision, policies: Record<string, TrackingPolicyResultDto> = {}) {
  const getForOrder = jest.fn(async () => revision)
  const getTrackingPolicy = jest.fn(async (variantId: string) => policies[variantId] ?? untracked)
  const getActiveLocation = jest.fn(async (locationId: string) => locations[locationId] ?? null)
  const create = jest.fn(async () => ({ id: 'order-1', orderNumber: 'PO-000001' }))
  const bomRevisionReader: BomRevisionReader = { getForOrder }
  const inventoryPolicyReader: InventoryPolicyReader = {
    getTrackingPolicy,
    getActiveLocation,
    listActiveLocations: jest.fn(async () => []),
  }
  const productionOrderStore: ProductionOrderStore = { create }
  const deps = { bomRevisionReader, inventoryPolicyReader, productionOrderStore, scope }
  return { deps, getForOrder, getTrackingPolicy, create }
}

describe('production order creation', () => {
  it('creates a draft order on a released revision and returns its number', async () => {
    const { deps, create } = build()

    expect(await createProductionOrder(deps, input)).toEqual({ status: 'created', orderId: 'order-1', orderNumber: 'PO-000001' })
    expect(create).toHaveBeenCalledWith(
      {
        productVariantId: 'table',
        bomRevisionId: 'revision-1',
        plannedQuantity: 10,
        sourceLocationId: 'issue-location',
        targetLocationId: 'receipt-location',
        dueAt: null,
      },
      scope,
    )
  })

  it('keeps an optional due date without validating it', async () => {
    const { deps, create } = build()
    const dueAt = new Date('2020-01-01T00:00:00Z')

    await createProductionOrder(deps, { ...input, dueAt })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ dueAt }), scope)
  })

  it.each([
    ['zero', 0, 'invalid_quantity'],
    ['negative', -2, 'invalid_quantity'],
    ['over-precise', 1.23456, 'quantity_too_precise'],
  ])('rejects a %s planned quantity', async (_label, plannedQuantity, code) => {
    const { deps, create } = build()

    expect(await createProductionOrder(deps, { ...input, plannedQuantity })).toMatchObject({
      status: 'rejected',
      code,
      field: 'plannedQuantity',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    ['sourceLocationId', { sourceLocationId: null }, 'location_missing'],
    ['targetLocationId', { targetLocationId: null }, 'location_missing'],
    ['sourceLocationId', { sourceLocationId: 'inactive-location' }, 'location_unavailable'],
  ] as const)('rejects a missing or inactive %s', async (field, change, code) => {
    const { deps } = build()

    expect(await createProductionOrder(deps, { ...input, ...change })).toMatchObject({ status: 'rejected', code, field })
  })

  it.each([
    ['missing', null, 'bom_revision_not_found'],
    ['draft', { ...releasedRevision, isReleased: false }, 'bom_revision_not_released'],
    ['unavailable', { ...releasedRevision, isAvailable: false }, 'bom_revision_unavailable'],
  ])('rejects a %s BOM revision', async (_label, revision, code) => {
    const { deps, create } = build(revision)

    expect(await createProductionOrder(deps, input)).toMatchObject({ status: 'rejected', code, field: 'bomRevisionId' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a product variant that is not the variant of the selected revision', async () => {
    const { deps, create } = build()

    expect(await createProductionOrder(deps, { ...input, productVariantId: 'chair' })).toMatchObject({
      status: 'rejected',
      code: 'variant_revision_mismatch',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('rechecks the WMS policy of the product and every distinct component', async () => {
    const { deps, getTrackingPolicy } = build()

    await createProductionOrder(deps, input)

    expect(getTrackingPolicy.mock.calls.map(([variantId]) => variantId)).toEqual(['table', 'leg', 'top'])
    expect(getTrackingPolicy).toHaveBeenCalledWith('leg', scope)
  })

  it.each(['table', 'top'])('refuses the order when %s requires tracking', async (variantId) => {
    const { deps, create } = build(releasedRevision, {
      [variantId]: { status: 'resolved', policy: { tracksLot: false, tracksSerial: true, tracksExpiry: false } },
    })

    const result = await createProductionOrder(deps, input)

    expect(result).toMatchObject({ status: 'rejected', code: 'tracking_not_supported' })
    expect(result.status === 'rejected' && result.message).toContain(variantId)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses the order when the WMS policy is unavailable', async () => {
    const { deps } = build(releasedRevision, { leg: { status: 'unavailable' } })

    expect(await createProductionOrder(deps, input)).toMatchObject({ status: 'rejected', code: 'inventory_unavailable' })
  })
})
