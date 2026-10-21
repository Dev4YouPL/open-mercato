/** @jest-environment node */

import type { InventoryPolicyReader } from '../../ports/inventoryPolicyReader'
import type { ProductionExecutionStore } from '../../ports/productionExecutionStore'
import type { ProductionOrderDto, ProductionOrderReader } from '../../ports/productionOrderReader'
import { createProductionExecution, type ProductionExecutionInput } from '../productionExecutionCreation'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const order: ProductionOrderDto = {
  id: 'order-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productVariantId: 'table',
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
  plannedQuantity: 10,
  allowsIssue: true,
  allowsReturn: true,
  allowsConfirmation: true,
}

const standaloneInput: ProductionExecutionInput = {
  orderId: null,
  productVariantId: 'chair',
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
}

function build(foundOrder: ProductionOrderDto | null = order) {
  const create = jest.fn(async () => ({ id: 'execution-1', executionNumber: 'EX-000001' }))
  const productionOrderReader: ProductionOrderReader = { getForExecution: jest.fn(async () => foundOrder) }
  const inventoryPolicyReader: InventoryPolicyReader = {
    getTrackingPolicy: jest.fn(),
    listActiveLocations: jest.fn(async () => []),
    getActiveLocation: jest.fn(async (id: string) =>
      id === 'inactive-location' ? null : { id, warehouseId: 'warehouse-1', code: 'A', type: 'bin' },
    ),
  }
  const productionExecutionStore: ProductionExecutionStore = { create }
  const deps = { productionOrderReader, inventoryPolicyReader, productionExecutionStore, scope, userId: 'user-1' }
  return { deps, create }
}

describe('production execution creation', () => {
  it('creates an execution of an order without copying the order context', async () => {
    const { deps, create } = build()

    const result = await createProductionExecution(deps, { ...standaloneInput, orderId: 'order-1' })

    expect(result).toEqual({ status: 'created', executionId: 'execution-1', executionNumber: 'EX-000001' })
    expect(create).toHaveBeenCalledWith(
      { orderId: 'order-1', productVariantId: null, sourceLocationId: null, targetLocationId: null, createdBy: 'user-1' },
      scope,
    )
  })

  it('rejects an execution of a missing order', async () => {
    const { deps, create } = build(null)

    expect(await createProductionExecution(deps, { ...standaloneInput, orderId: 'order-1' })).toMatchObject({
      status: 'rejected',
      code: 'order_not_found',
      field: 'orderId',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a standalone execution with its own product and locations', async () => {
    const { deps, create } = build()

    expect(await createProductionExecution(deps, standaloneInput)).toMatchObject({ status: 'created' })
    expect(create).toHaveBeenCalledWith({ ...standaloneInput, createdBy: 'user-1' }, scope)
  })

  it('allows a standalone execution with nothing preset', async () => {
    const { deps } = build()

    expect(
      await createProductionExecution(deps, { orderId: null, productVariantId: null, sourceLocationId: null, targetLocationId: null }),
    ).toMatchObject({ status: 'created' })
  })

  it.each(['sourceLocationId', 'targetLocationId'] as const)('rejects an inactive %s on a standalone execution', async (field) => {
    const { deps, create } = build()

    expect(await createProductionExecution(deps, { ...standaloneInput, [field]: 'inactive-location' })).toMatchObject({
      status: 'rejected',
      code: 'location_unavailable',
      field,
    })
    expect(create).not.toHaveBeenCalled()
  })
})
