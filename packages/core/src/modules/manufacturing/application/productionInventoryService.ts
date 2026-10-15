import type { ManufacturingScope } from '../domain/manufacturingScope'
import { toPositiveQuantity } from '../domain/quantity'
import type {
  InventoryGateway,
  InventoryMovementKind,
  InventoryMovementResultDto,
} from '../ports/inventoryGateway'
import type { ProductionOrderDto, ProductionOrderReader } from '../ports/productionOrderReader'

export type OutputMovementInput = {
  operationId: string
  orderId: string
  warehouseId: string
  locationId: string
  quantity: number
}

export type MaterialMovementInput = OutputMovementInput & {
  variantId: string
}

export interface ProductionInventoryService {
  issueMaterial(input: MaterialMovementInput): Promise<InventoryMovementResultDto>
  returnMaterial(input: MaterialMovementInput): Promise<InventoryMovementResultDto>
  receiveOutput(input: OutputMovementInput): Promise<InventoryMovementResultDto>
  reverseMaterialIssue(input: MaterialMovementInput): Promise<InventoryMovementResultDto>
  reverseMaterialReturn(input: MaterialMovementInput): Promise<InventoryMovementResultDto>
  reverseOutputReceipt(input: OutputMovementInput): Promise<InventoryMovementResultDto>
}

type ActionRule = {
  movementKind: InventoryMovementKind
  isAllowed: (order: ProductionOrderDto) => boolean
}

const alwaysAllowed = (): boolean => true

const issueMaterialRule: ActionRule = { movementKind: 'consume', isAllowed: (order) => order.allowsIssue }
const returnMaterialRule: ActionRule = { movementKind: 'restock', isAllowed: (order) => order.allowsReturn }
const receiveOutputRule: ActionRule = { movementKind: 'receiveOutput', isAllowed: (order) => order.allowsConfirmation }
const reverseMaterialIssueRule: ActionRule = { movementKind: 'restock', isAllowed: alwaysAllowed }
const reverseMaterialReturnRule: ActionRule = { movementKind: 'consume', isAllowed: alwaysAllowed }
const reverseOutputReceiptRule: ActionRule = { movementKind: 'consume', isAllowed: alwaysAllowed }

function rejected(code: string, message: string): InventoryMovementResultDto {
  return { status: 'rejected', code, message }
}

type ProductionInventoryDeps = {
  inventoryGateway: InventoryGateway
  productionOrderReader: ProductionOrderReader
  scope: ManufacturingScope
}

async function postForOrder(
  deps: ProductionInventoryDeps,
  rule: ActionRule,
  input: OutputMovementInput,
  variantIdFor: (order: ProductionOrderDto) => string,
): Promise<InventoryMovementResultDto> {
  const quantity = toPositiveQuantity(input.quantity)
  
  if (quantity === null) return rejected('invalid_quantity', 'Movement quantity must be a positive number.')

  const order = await deps.productionOrderReader.getForExecution(input.orderId, deps.scope)

  if (!order) return rejected('order_not_found', 'Production order was not found.')
  if (!rule.isAllowed(order)) return rejected('action_not_allowed', 'Production order does not allow this action.')
    
  return deps.inventoryGateway.postMovement({
    operationId: input.operationId,
    kind: rule.movementKind,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    variantId: variantIdFor(order),
    quantity,
  })
}

const orderProduct = (order: ProductionOrderDto): string => order.productVariantId

export function createProductionInventoryService(deps: ProductionInventoryDeps): ProductionInventoryService {
  return {
    issueMaterial: (input) => postForOrder(deps, issueMaterialRule, input, () => input.variantId),
    returnMaterial: (input) => postForOrder(deps, returnMaterialRule, input, () => input.variantId),
    receiveOutput: (input) => postForOrder(deps, receiveOutputRule, input, orderProduct),
    reverseMaterialIssue: (input) => postForOrder(deps, reverseMaterialIssueRule, input, () => input.variantId),
    reverseMaterialReturn: (input) => postForOrder(deps, reverseMaterialReturnRule, input, () => input.variantId),
    reverseOutputReceipt: (input) => postForOrder(deps, reverseOutputReceiptRule, input, orderProduct),
  }
}
