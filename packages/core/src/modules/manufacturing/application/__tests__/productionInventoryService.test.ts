/** @jest-environment node */

import type { InventoryGateway, InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type { ProductionOrderDto, ProductionOrderReader } from '../../ports/productionOrderReader'
import {
  createProductionInventoryService,
  type MaterialMovementInput,
  type OutputMovementInput,
  type ProductionInventoryService,
} from '../productionInventoryService'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }

const openOrder: ProductionOrderDto = {
  id: 'order-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productVariantId: 'product-variant-1',
  sourceLocationId: null,
  targetLocationId: null,
  allowsIssue: true,
  allowsReturn: true,
  allowsConfirmation: true,
}

const closedOrder: ProductionOrderDto = { ...openOrder, allowsIssue: false, allowsReturn: false, allowsConfirmation: false }

const outputInput: OutputMovementInput = {
  operationId: 'operation-1',
  orderId: 'order-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4,
}

const materialInput: MaterialMovementInput = { ...outputInput, variantId: 'material-variant-1' }

function buildService(order: ProductionOrderDto | null = openOrder) {
  const postMovement = jest.fn(async () => accepted)
  const getForExecution = jest.fn(async () => order)
  const inventoryGateway: InventoryGateway = { postMovement }
  const productionOrderReader: ProductionOrderReader = { getForExecution }
  const service = createProductionInventoryService({ inventoryGateway, productionOrderReader, scope })
  return { service, postMovement, getForExecution }
}

type Action = keyof ProductionInventoryService

const materialActions = [
  ['issueMaterial', 'consume'],
  ['returnMaterial', 'restock'],
  ['reverseMaterialIssue', 'restock'],
  ['reverseMaterialReturn', 'consume'],
] as const

const outputActions = [
  ['receiveOutput', 'receiveOutput'],
  ['reverseOutputReceipt', 'consume'],
] as const

function runAction(service: ProductionInventoryService, action: Action) {
  if (action === 'receiveOutput' || action === 'reverseOutputReceipt') return service[action](outputInput)
  return service[action](materialInput)
}

describe('production inventory service', () => {
  it.each(materialActions)('%s posts a %s movement of the given material', async (action, kind) => {
    const { service, postMovement } = buildService()
    const result = await service[action](materialInput)

    expect(result).toEqual(accepted)
    expect(postMovement).toHaveBeenCalledWith({
      operationId: 'operation-1',
      kind,
      warehouseId: 'warehouse-1',
      locationId: 'location-1',
      variantId: 'material-variant-1',
      quantity: 4,
    })
  })

  it.each(outputActions)('%s posts a %s movement of the order product', async (action, kind) => {
    const { service, postMovement } = buildService()
    await service[action](outputInput)

    expect(postMovement).toHaveBeenCalledWith(expect.objectContaining({ kind, variantId: 'product-variant-1' }))
  })

  it('reads the order within the service scope', async () => {
    const { service, getForExecution } = buildService()
    await service.issueMaterial(materialInput)

    expect(getForExecution).toHaveBeenCalledWith('order-1', scope)
  })

  it.each(['issueMaterial', 'returnMaterial', 'receiveOutput'] as const)(
    'refuses %s when the order does not allow it',
    async (action) => {
      const { service, postMovement } = buildService(closedOrder)
      const result = await runAction(service, action)

      expect(postMovement).not.toHaveBeenCalled()
      expect(result).toMatchObject({ status: 'rejected', code: 'action_not_allowed' })
    },
  )

  it.each(['reverseMaterialIssue', 'reverseMaterialReturn', 'reverseOutputReceipt'] as const)(
    'allows %s regardless of the order flags',
    async (action) => {
      const { service, postMovement } = buildService(closedOrder)
      const result = await runAction(service, action)

      expect(postMovement).toHaveBeenCalledTimes(1)
      expect(result).toEqual(accepted)
    },
  )

  it('refuses when the order does not exist', async () => {
    const { service, postMovement } = buildService(null)
    const result = await service.issueMaterial(materialInput)

    expect(postMovement).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'rejected', code: 'order_not_found' })
  })

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses quantity %p before reading the order',
    async (quantity) => {
      const { service, postMovement, getForExecution } = buildService()
      const result = await service.returnMaterial({ ...materialInput, quantity })

      expect(getForExecution).not.toHaveBeenCalled()
      expect(postMovement).not.toHaveBeenCalled()
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid_quantity' })
    },
  )

  it('passes gateway rejections and unknown outcomes through unchanged', async () => {
    const { service, postMovement } = buildService()
    const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }
    postMovement.mockResolvedValueOnce(unknown)

    expect(await service.issueMaterial(materialInput)).toBe(unknown)
  })
})
