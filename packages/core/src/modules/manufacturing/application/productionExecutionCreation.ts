import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { InventoryPolicyReader } from '../ports/inventoryPolicyReader'
import type { ProductionExecutionStore } from '../ports/productionExecutionStore'
import type { ProductionOrderReader } from '../ports/productionOrderReader'

export type ProductionExecutionInput = {
  orderId: string | null
  productVariantId: string | null
  sourceLocationId: string | null
  targetLocationId: string | null
}

export type ProductionExecutionField = keyof ProductionExecutionInput

export type ProductionExecutionCreationResultDto =
  | { status: 'created'; executionId: string; executionNumber: string }
  | { status: 'rejected'; code: string; message: string; field: ProductionExecutionField | null }

type Rejection = Extract<ProductionExecutionCreationResultDto, { status: 'rejected' }>

type ProductionExecutionCreationDeps = {
  productionOrderReader: ProductionOrderReader
  inventoryPolicyReader: InventoryPolicyReader
  productionExecutionStore: ProductionExecutionStore
  scope: ManufacturingScope
  userId: string
}

function rejected(code: string, message: string, field: ProductionExecutionField | null = null): Rejection {
  return { status: 'rejected', code, message, field }
}

async function checkLocation(
  deps: ProductionExecutionCreationDeps,
  locationId: string | null,
  field: 'sourceLocationId' | 'targetLocationId',
): Promise<Rejection | null> {
  if (!locationId) return null

  const location = await deps.inventoryPolicyReader.getActiveLocation(locationId, deps.scope)

  return location ? null : rejected('location_unavailable', 'Location is missing or inactive in WMS.', field)
}

async function createForOrder(deps: ProductionExecutionCreationDeps, orderId: string): Promise<ProductionExecutionCreationResultDto> {
  const order = await deps.productionOrderReader.getForExecution(orderId, deps.scope)

  if (!order) return rejected('order_not_found', 'Production order was not found.', 'orderId')

  const created = await deps.productionExecutionStore.create(
    { orderId: order.id, productVariantId: null, sourceLocationId: null, targetLocationId: null, createdBy: deps.userId },
    deps.scope,
  )

  return { status: 'created', executionId: created.id, executionNumber: created.executionNumber }
}

async function createStandalone(
  deps: ProductionExecutionCreationDeps,
  input: ProductionExecutionInput,
): Promise<ProductionExecutionCreationResultDto> {
  const sourceRejection = await checkLocation(deps, input.sourceLocationId, 'sourceLocationId')

  if (sourceRejection) return sourceRejection

  const targetRejection = await checkLocation(deps, input.targetLocationId, 'targetLocationId')

  if (targetRejection) return targetRejection

  const created = await deps.productionExecutionStore.create(
    {
      orderId: null,
      productVariantId: input.productVariantId,
      sourceLocationId: input.sourceLocationId,
      targetLocationId: input.targetLocationId,
      createdBy: deps.userId,
    },
    deps.scope,
  )

  return { status: 'created', executionId: created.id, executionNumber: created.executionNumber }
}

export function createProductionExecution(
  deps: ProductionExecutionCreationDeps,
  input: ProductionExecutionInput,
): Promise<ProductionExecutionCreationResultDto> {
  return input.orderId ? createForOrder(deps, input.orderId) : createStandalone(deps, input)
}
