/** @jest-environment node */

import type { PlannedMovement } from '../../domain/movement'
import type { PositiveQuantity } from '../../domain/quantity'
import type { InventoryGateway, InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type {
  InventoryLocationDto,
  InventoryPolicyReader,
  TrackingPolicyResultDto,
} from '../../ports/inventoryPolicyReader'
import type { ProductionOrderDto, ProductionOrderReader } from '../../ports/productionOrderReader'
import {
  createProductionInventoryService,
  type MaterialMovementInput,
  type MovementReversalInput,
  type OutputMovementInput,
  type ProductionInventoryService,
} from '../productionInventoryService'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }
const untracked: TrackingPolicyResultDto = {
  status: 'resolved',
  policy: { tracksLot: false, tracksSerial: false, tracksExpiry: false },
}

const locations: Record<string, InventoryLocationDto> = {
  'issue-location': { id: 'issue-location', warehouseId: 'warehouse-1', code: 'A-1', type: 'bin' },
  'receipt-location': { id: 'receipt-location', warehouseId: 'warehouse-2', code: 'B-1', type: 'bin' },
}

const openOrder: ProductionOrderDto = {
  id: 'order-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productVariantId: 'product-variant-1',
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
  allowsIssue: true,
  allowsReturn: true,
  allowsConfirmation: true,
}

const closedOrder: ProductionOrderDto = { ...openOrder, allowsIssue: false, allowsReturn: false, allowsConfirmation: false }

const outputInput: OutputMovementInput = { orderId: 'order-1', quantity: 4 }
const materialInput: MaterialMovementInput = { ...outputInput, variantId: 'material-variant-1' }
const reversalInput: MovementReversalInput = {
  ...materialInput,
  warehouseId: 'snapshot-warehouse',
  locationId: 'snapshot-location',
}

function buildService(order: ProductionOrderDto | null = openOrder, tracking: TrackingPolicyResultDto = untracked) {
  const postMovement = jest.fn(async () => accepted)
  const getForExecution = jest.fn(async () => order)
  const getTrackingPolicy = jest.fn(async () => tracking)
  const getActiveLocation = jest.fn(async (locationId: string) => locations[locationId] ?? null)
  const inventoryGateway: InventoryGateway = { postMovement }
  const inventoryPolicyReader: InventoryPolicyReader = {
    getTrackingPolicy,
    getActiveLocation,
    listActiveLocations: jest.fn(async () => []),
  }
  const productionOrderReader: ProductionOrderReader = { getForExecution }
  const service = createProductionInventoryService({ inventoryGateway, inventoryPolicyReader, productionOrderReader, scope })
  return { service, postMovement, getForExecution, getTrackingPolicy, getActiveLocation }
}

type ForwardAction = 'planIssueMaterial' | 'planReturnMaterial' | 'planReceiveOutput'

function planForward(service: ProductionInventoryService, action: ForwardAction) {
  if (action === 'planReceiveOutput') return service.planReceiveOutput(outputInput)
  return service[action](materialInput)
}

describe('production inventory service', () => {
  it.each([
    ['planIssueMaterial', 'consume'],
    ['planReturnMaterial', 'restock'],
  ] as const)('%s plans a %s movement of the material at the order issue location', async (action, kind) => {
    const { service } = buildService()

    expect(await service[action](materialInput)).toEqual({
      status: 'planned',
      movement: {
        kind,
        variantId: 'material-variant-1',
        warehouseId: 'warehouse-1',
        locationId: 'issue-location',
        quantity: 4,
      },
    })
  })

  it('plans the output receipt of the order product at the order receipt location', async () => {
    const { service } = buildService()

    expect(await service.planReceiveOutput(outputInput)).toEqual({
      status: 'planned',
      movement: {
        kind: 'receiveOutput',
        variantId: 'product-variant-1',
        warehouseId: 'warehouse-2',
        locationId: 'receipt-location',
        quantity: 4,
      },
    })
  })

  it.each([
    ['planReverseMaterialIssue', 'restock'],
    ['planReverseMaterialReturn', 'consume'],
    ['planReverseOutputReceipt', 'consume'],
  ] as const)('%s plans a %s movement from the given snapshot, not the order', async (action, kind) => {
    const { service, getActiveLocation, getTrackingPolicy } = buildService(closedOrder)

    expect(await service[action](reversalInput)).toEqual({
      status: 'planned',
      movement: {
        kind,
        variantId: 'material-variant-1',
        warehouseId: 'snapshot-warehouse',
        locationId: 'snapshot-location',
        quantity: 4,
      },
    })
    expect(getActiveLocation).not.toHaveBeenCalled()
    expect(getTrackingPolicy).not.toHaveBeenCalled()
  })

  it('reads the order and the location within the service scope', async () => {
    const { service, getForExecution, getActiveLocation } = buildService()
    await service.planIssueMaterial(materialInput)

    expect(getForExecution).toHaveBeenCalledWith('order-1', scope)
    expect(getActiveLocation).toHaveBeenCalledWith('issue-location', scope)
  })

  it.each(['planIssueMaterial', 'planReturnMaterial', 'planReceiveOutput'] as const)(
    'refuses %s when the order does not allow it',
    async (action) => {
      const { service } = buildService(closedOrder)

      expect(await planForward(service, action)).toMatchObject({ status: 'rejected', code: 'action_not_allowed' })
    },
  )

  it('refuses when the order does not exist', async () => {
    const { service } = buildService(null)

    expect(await service.planIssueMaterial(materialInput)).toMatchObject({ status: 'rejected', code: 'order_not_found' })
    expect(await service.planReverseMaterialIssue(reversalInput)).toMatchObject({
      status: 'rejected',
      code: 'order_not_found',
    })
  })

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses quantity %p before reading the order',
    async (quantity) => {
      const { service, getForExecution } = buildService()
      const result = await service.planReturnMaterial({ ...materialInput, quantity })

      expect(getForExecution).not.toHaveBeenCalled()
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid_quantity' })
    },
  )

  it.each([
    ['issue', 'planIssueMaterial', { sourceLocationId: null }],
    ['receipt', 'planReceiveOutput', { targetLocationId: null }],
  ] as const)('refuses when the order has no %s location', async (_label, action, change) => {
    const { service } = buildService({ ...openOrder, ...change })

    expect(await planForward(service, action)).toMatchObject({ status: 'rejected', code: 'location_missing' })
  })

  it('refuses when the order location is missing or inactive in WMS', async () => {
    const { service } = buildService({ ...openOrder, sourceLocationId: 'deleted-location' })

    expect(await service.planIssueMaterial(materialInput)).toMatchObject({
      status: 'rejected',
      code: 'location_unavailable',
    })
  })

  it.each([
    ['lot', { tracksLot: true, tracksSerial: false, tracksExpiry: false }],
    ['serial number', { tracksLot: false, tracksSerial: true, tracksExpiry: false }],
    ['expiry date', { tracksLot: false, tracksSerial: false, tracksExpiry: true }],
  ])('refuses forward actions on a variant tracked by %s', async (_label, policy) => {
    const tracked: TrackingPolicyResultDto = { status: 'resolved', policy }

    for (const action of ['planIssueMaterial', 'planReturnMaterial', 'planReceiveOutput'] as const) {
      const { service } = buildService(openOrder, tracked)

      expect(await planForward(service, action)).toMatchObject({ status: 'rejected', code: 'tracking_not_supported' })
    }
  })

  it('checks the tracking policy of the material for material actions and of the product for output', async () => {
    const material = buildService()
    await material.service.planIssueMaterial(materialInput)
    expect(material.getTrackingPolicy).toHaveBeenCalledWith('material-variant-1', scope)

    const output = buildService()
    await output.service.planReceiveOutput(outputInput)
    expect(output.getTrackingPolicy).toHaveBeenCalledWith('product-variant-1', scope)
  })

  it('refuses when the inventory policy is unavailable', async () => {
    const { service } = buildService(openOrder, { status: 'unavailable' })

    expect(await service.planIssueMaterial(materialInput)).toMatchObject({
      status: 'rejected',
      code: 'inventory_unavailable',
    })
  })

  it('never posts while planning', async () => {
    const { service, postMovement } = buildService()
    await service.planIssueMaterial(materialInput)
    await service.planReverseOutputReceipt(reversalInput)

    expect(postMovement).not.toHaveBeenCalled()
  })

  it('posts a planned movement under the operation id and passes the gateway result through', async () => {
    const { service, postMovement } = buildService()
    const movement: PlannedMovement = {
      kind: 'consume',
      variantId: 'material-variant-1',
      warehouseId: 'warehouse-1',
      locationId: 'issue-location',
      quantity: 4 as PositiveQuantity,
    }
    const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }
    postMovement.mockResolvedValueOnce(unknown)

    expect(await service.postMovement('operation-1', movement)).toBe(unknown)
    expect(postMovement).toHaveBeenCalledWith({ operationId: 'operation-1', ...movement })
  })
})
