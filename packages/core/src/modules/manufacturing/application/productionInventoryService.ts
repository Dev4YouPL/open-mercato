import type { ExecutionDocumentType, PlannedExecution, PlannedFact, ProductionFactKind } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { MovementKind, PlannedMovement } from '../domain/movement'
import { toPositiveQuantity, type PositiveQuantity } from '../domain/quantity'
import { planReversal, type ReversibleDocument } from '../domain/reversal'
import { isTrackingSupported } from '../domain/trackingSupport'
import type { InventoryGateway, InventoryMovementResultDto } from '../ports/inventoryGateway'
import type { InventoryPolicyReader } from '../ports/inventoryPolicyReader'
import type { ProductionOrderDto, ProductionOrderReader } from '../ports/productionOrderReader'

export type MaterialMovementInput = {
  orderId: string
  variantId: string
  quantity: number
}

export type ProductionConfirmationInput = {
  orderId: string
  goodQuantity: number
  scrapQuantity: number
}

export type ExecutionPlanResultDto =
  | { status: 'planned'; execution: PlannedExecution }
  | { status: 'rejected'; code: string; message: string }

export interface ProductionInventoryService {
  planIssueMaterial(input: MaterialMovementInput): Promise<ExecutionPlanResultDto>
  planReturnMaterial(input: MaterialMovementInput): Promise<ExecutionPlanResultDto>
  planConfirmProduction(input: ProductionConfirmationInput): Promise<ExecutionPlanResultDto>
  planReverseDocument(document: ReversibleDocument): Promise<ExecutionPlanResultDto>
  postMovement(operationId: string, movement: PlannedMovement): Promise<InventoryMovementResultDto>
}

type MaterialActionRule = {
  documentType: ExecutionDocumentType
  factKind: ProductionFactKind
  movementKind: MovementKind
  isAllowed: (order: ProductionOrderDto) => boolean
}

const issueMaterialRule: MaterialActionRule = {
  documentType: 'issue',
  factKind: 'material_consumed',
  movementKind: 'consume',
  isAllowed: (order) => order.allowsIssue,
}
const returnMaterialRule: MaterialActionRule = {
  documentType: 'return',
  factKind: 'material_returned',
  movementKind: 'restock',
  isAllowed: (order) => order.allowsReturn,
}

type ProductionInventoryDeps = {
  inventoryGateway: InventoryGateway
  inventoryPolicyReader: InventoryPolicyReader
  productionOrderReader: ProductionOrderReader
  scope: ManufacturingScope
}

type PlanRejection = Extract<ExecutionPlanResultDto, { status: 'rejected' }>

type LoadedOrder = { status: 'loaded'; order: ProductionOrderDto }

type ResolvedLocation = { status: 'resolved'; warehouseId: string; locationId: string }

function rejected(code: string, message: string): PlanRejection {
  return { status: 'rejected', code, message }
}

function planned(execution: PlannedExecution): ExecutionPlanResultDto {
  return { status: 'planned', execution }
}

async function loadOrder(deps: ProductionInventoryDeps, orderId: string): Promise<LoadedOrder | PlanRejection> {
  const order = await deps.productionOrderReader.getForExecution(orderId, deps.scope)

  if (!order) return rejected('order_not_found', 'Production order was not found.')

  return { status: 'loaded', order }
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

async function resolveOrderLocation(
  deps: ProductionInventoryDeps,
  locationId: string | null,
): Promise<ResolvedLocation | PlanRejection> {
  if (!locationId) return rejected('location_missing', 'Production order has no location for this action.')

  const location = await deps.inventoryPolicyReader.getActiveLocation(locationId, deps.scope)

  if (!location) return rejected('location_unavailable', 'Production order location is missing or inactive in WMS.')

  return { status: 'resolved', warehouseId: location.warehouseId, locationId }
}

async function planMaterial(
  deps: ProductionInventoryDeps,
  rule: MaterialActionRule,
  input: MaterialMovementInput,
): Promise<ExecutionPlanResultDto> {
  const quantity = toPositiveQuantity(input.quantity)

  if (quantity === null) return rejected('invalid_quantity', 'Movement quantity must be a positive number.')

  const loaded = await loadOrder(deps, input.orderId)

  if (loaded.status === 'rejected') return loaded
  if (!rule.isAllowed(loaded.order)) return rejected('action_not_allowed', 'Production order does not allow this action.')

  const trackingRejection = await checkTrackingSupport(deps, input.variantId)

  if (trackingRejection) return trackingRejection

  const location = await resolveOrderLocation(deps, loaded.order.sourceLocationId)

  if (location.status === 'rejected') return location

  const movement: PlannedMovement = {
    kind: rule.movementKind,
    variantId: input.variantId,
    warehouseId: location.warehouseId,
    locationId: location.locationId,
    quantity,
  }

  return planned({
    documentType: rule.documentType,
    movement,
    facts: [movingFact(rule.factKind, movement)],
  })
}

function movingFact(factKind: ProductionFactKind, movement: PlannedMovement): PlannedFact {
  return {
    factKind,
    variantId: movement.variantId,
    warehouseId: movement.warehouseId,
    locationId: movement.locationId,
    quantity: movement.quantity,
    moves: true,
  }
}

function scrapFact(order: ProductionOrderDto, quantity: PositiveQuantity): PlannedFact {
  return {
    factKind: 'scrap_recorded',
    variantId: order.productVariantId,
    warehouseId: null,
    locationId: null,
    quantity,
    moves: false,
  }
}

function toConfirmedQuantity(value: number): PositiveQuantity | 0 | null {
  if (value === 0) return 0

  return toPositiveQuantity(value)
}

async function planConfirmation(
  deps: ProductionInventoryDeps,
  input: ProductionConfirmationInput,
): Promise<ExecutionPlanResultDto> {
  const goodQuantity = toConfirmedQuantity(input.goodQuantity)
  const scrapQuantity = toConfirmedQuantity(input.scrapQuantity)

  if (goodQuantity === null || scrapQuantity === null || (goodQuantity === 0 && scrapQuantity === 0)) {
    return rejected('invalid_quantity', 'Confirm a positive good quantity, a positive scrap quantity, or both.')
  }

  const loaded = await loadOrder(deps, input.orderId)

  if (loaded.status === 'rejected') return loaded

  const { order } = loaded

  if (!order.allowsConfirmation) return rejected('action_not_allowed', 'Production order does not allow this action.')

  const scrapFacts = scrapQuantity === 0 ? [] : [scrapFact(order, scrapQuantity)]

  if (goodQuantity === 0) return planned({ documentType: 'confirmation', movement: null, facts: scrapFacts })

  const trackingRejection = await checkTrackingSupport(deps, order.productVariantId)

  if (trackingRejection) return trackingRejection

  const location = await resolveOrderLocation(deps, order.targetLocationId)

  if (location.status === 'rejected') return location

  const movement: PlannedMovement = {
    kind: 'receiveOutput',
    variantId: order.productVariantId,
    warehouseId: location.warehouseId,
    locationId: location.locationId,
    quantity: goodQuantity,
  }

  return planned({
    documentType: 'confirmation',
    movement,
    facts: [movingFact('output_received', movement), ...scrapFacts],
  })
}

async function planDocumentReversal(
  deps: ProductionInventoryDeps,
  document: ReversibleDocument,
): Promise<ExecutionPlanResultDto> {
  const loaded = await loadOrder(deps, document.orderId)

  if (loaded.status === 'rejected') return loaded

  const plan = planReversal(document)

  switch (plan.status) {
    case 'already_reversed':
      return rejected('document_already_reversed', 'This document has already been reversed.')
    case 'unsupported':
      return rejected('reversal_not_supported', 'This document cannot be reversed with a single inventory movement.')
    case 'planned':
      return planned(plan.execution)
  }
}

export function createProductionInventoryService(deps: ProductionInventoryDeps): ProductionInventoryService {
  return {
    planIssueMaterial: (input) => planMaterial(deps, issueMaterialRule, input),
    planReturnMaterial: (input) => planMaterial(deps, returnMaterialRule, input),
    planConfirmProduction: (input) => planConfirmation(deps, input),
    planReverseDocument: (document) => planDocumentReversal(deps, document),
    postMovement: (operationId, movement) => deps.inventoryGateway.postMovement({ operationId, ...movement }),
  }
}
