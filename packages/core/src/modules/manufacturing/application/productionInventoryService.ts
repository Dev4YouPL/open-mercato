import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { MovementKind, PlannedMovement } from '../domain/movement'
import { toPositiveQuantity, type PositiveQuantity } from '../domain/quantity'
import { isTrackingSupported } from '../domain/trackingSupport'
import type { InventoryGateway, InventoryMovementResultDto } from '../ports/inventoryGateway'
import type { InventoryPolicyReader } from '../ports/inventoryPolicyReader'
import type { ProductionOrderDto, ProductionOrderReader } from '../ports/productionOrderReader'

export type OutputMovementInput = {
  orderId: string
  quantity: number
}

export type MaterialMovementInput = OutputMovementInput & {
  variantId: string
}

export type MovementReversalInput = MaterialMovementInput & {
  warehouseId: string
  locationId: string
}

export type MovementPlanResultDto =
  | { status: 'planned'; movement: PlannedMovement }
  | { status: 'rejected'; code: string; message: string }

export interface ProductionInventoryService {
  planIssueMaterial(input: MaterialMovementInput): Promise<MovementPlanResultDto>
  planReturnMaterial(input: MaterialMovementInput): Promise<MovementPlanResultDto>
  planReceiveOutput(input: OutputMovementInput): Promise<MovementPlanResultDto>
  planReverseMaterialIssue(input: MovementReversalInput): Promise<MovementPlanResultDto>
  planReverseMaterialReturn(input: MovementReversalInput): Promise<MovementPlanResultDto>
  planReverseOutputReceipt(input: MovementReversalInput): Promise<MovementPlanResultDto>
  postMovement(operationId: string, movement: PlannedMovement): Promise<InventoryMovementResultDto>
}

type ForwardActionRule = {
  movementKind: MovementKind
  isAllowed: (order: ProductionOrderDto) => boolean
  locationIdFor: (order: ProductionOrderDto) => string | null
}

const issueLocation = (order: ProductionOrderDto): string | null => order.sourceLocationId
const receiptLocation = (order: ProductionOrderDto): string | null => order.targetLocationId

const issueMaterialRule: ForwardActionRule = {
  movementKind: 'consume',
  isAllowed: (order) => order.allowsIssue,
  locationIdFor: issueLocation,
}
const returnMaterialRule: ForwardActionRule = {
  movementKind: 'restock',
  isAllowed: (order) => order.allowsReturn,
  locationIdFor: issueLocation,
}
const receiveOutputRule: ForwardActionRule = {
  movementKind: 'receiveOutput',
  isAllowed: (order) => order.allowsConfirmation,
  locationIdFor: receiptLocation,
}

type ProductionInventoryDeps = {
  inventoryGateway: InventoryGateway
  inventoryPolicyReader: InventoryPolicyReader
  productionOrderReader: ProductionOrderReader
  scope: ManufacturingScope
}

type PlanRejection = Extract<MovementPlanResultDto, { status: 'rejected' }>

type ValidatedOrder = { status: 'valid'; order: ProductionOrderDto; quantity: PositiveQuantity }

function rejected(code: string, message: string): PlanRejection {
  return { status: 'rejected', code, message }
}

async function loadOrder(
  deps: ProductionInventoryDeps,
  input: OutputMovementInput,
): Promise<ValidatedOrder | PlanRejection> {
  const quantity = toPositiveQuantity(input.quantity)

  if (quantity === null) return rejected('invalid_quantity', 'Movement quantity must be a positive number.')

  const order = await deps.productionOrderReader.getForExecution(input.orderId, deps.scope)

  if (!order) return rejected('order_not_found', 'Production order was not found.')

  return { status: 'valid', order, quantity }
}

async function checkTrackingSupport(
  deps: ProductionInventoryDeps,
  variantId: string,
): Promise<PlanRejection | null> {
  const tracking = await deps.inventoryPolicyReader.getTrackingPolicy(variantId, deps.scope)

  if (tracking.status === 'unavailable') {
    return rejected('inventory_unavailable', 'Inventory policy is unavailable; is the WMS module enabled?')
  }

  if (!isTrackingSupported(tracking.policy)) {
    return rejected('tracking_not_supported', 'Variants tracked by lot, serial number or expiry date are not supported yet.')
  }

  return null
}

async function planForward(
  deps: ProductionInventoryDeps,
  rule: ForwardActionRule,
  input: OutputMovementInput,
  variantIdFor: (order: ProductionOrderDto) => string,
): Promise<MovementPlanResultDto> {
  const loaded = await loadOrder(deps, input)

  if (loaded.status === 'rejected') return loaded

  const { order, quantity } = loaded

  if (!rule.isAllowed(order)) return rejected('action_not_allowed', 'Production order does not allow this action.')

  const variantId = variantIdFor(order)
  const trackingRejection = await checkTrackingSupport(deps, variantId)

  if (trackingRejection) return trackingRejection

  const locationId = rule.locationIdFor(order)

  if (!locationId) return rejected('location_missing', 'Production order has no location for this action.')

  const location = await deps.inventoryPolicyReader.getActiveLocation(locationId, deps.scope)

  if (!location) return rejected('location_unavailable', 'Production order location is missing or inactive in WMS.')

  return {
    status: 'planned',
    movement: { kind: rule.movementKind, variantId, warehouseId: location.warehouseId, locationId, quantity },
  }
}

async function planReversal(
  deps: ProductionInventoryDeps,
  movementKind: MovementKind,
  input: MovementReversalInput,
): Promise<MovementPlanResultDto> {
  const loaded = await loadOrder(deps, input)

  if (loaded.status === 'rejected') return loaded

  return {
    status: 'planned',
    movement: {
      kind: movementKind,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      quantity: loaded.quantity,
    },
  }
}

const orderProduct = (order: ProductionOrderDto): string => order.productVariantId

export function createProductionInventoryService(deps: ProductionInventoryDeps): ProductionInventoryService {
  return {
    planIssueMaterial: (input) => planForward(deps, issueMaterialRule, input, () => input.variantId),
    planReturnMaterial: (input) => planForward(deps, returnMaterialRule, input, () => input.variantId),
    planReceiveOutput: (input) => planForward(deps, receiveOutputRule, input, orderProduct),
    planReverseMaterialIssue: (input) => planReversal(deps, 'restock', input),
    planReverseMaterialReturn: (input) => planReversal(deps, 'consume', input),
    planReverseOutputReceipt: (input) => planReversal(deps, 'consume', input),
    postMovement: (operationId, movement) => deps.inventoryGateway.postMovement({ operationId, ...movement }),
  }
}
