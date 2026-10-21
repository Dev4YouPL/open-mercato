import type { ExecutionContext } from '../domain/executionContext'
import type { ExecutionDocumentType, PlannedDocument, PlannedFact, ProductionFactKind } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { MovementKind, PlannedMovement } from '../domain/movement'
import { hasAllowedPrecision, toPositiveQuantity, type PositiveQuantity } from '../domain/quantity'
import { planReversal, type ReversibleDocument } from '../domain/reversal'
import { isTrackingSupported } from '../domain/trackingSupport'
import type { InventoryGateway, InventoryMovementResultDto } from '../ports/inventoryGateway'
import type { InventoryPolicyReader } from '../ports/inventoryPolicyReader'
import type { ExecutionContextReader } from '../ports/executionContextReader'

export type MaterialMovementInput = {
  executionId: string
  variantId: string
  quantity: number
}

export type ProductionConfirmationInput = {
  executionId: string
  goodQuantity: number
  scrapQuantity: number
}

export type ExecutionPlanResultDto =
  | { status: 'planned'; plan: PlannedDocument }
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
  isAllowed: (context: ExecutionContext) => boolean
}

const issueMaterialRule: MaterialActionRule = {
  documentType: 'issue',
  factKind: 'material_consumed',
  movementKind: 'consume',
  isAllowed: (context) => context.allowsIssue,
}
const returnMaterialRule: MaterialActionRule = {
  documentType: 'return',
  factKind: 'material_returned',
  movementKind: 'restock',
  isAllowed: (context) => context.allowsReturn,
}

type ProductionInventoryDeps = {
  inventoryGateway: InventoryGateway
  inventoryPolicyReader: InventoryPolicyReader
  executionContextReader: ExecutionContextReader
  scope: ManufacturingScope
}

type PlanRejection = Extract<ExecutionPlanResultDto, { status: 'rejected' }>

type LoadedContext = { status: 'loaded'; context: ExecutionContext }

type ResolvedLocation = { status: 'resolved'; warehouseId: string; locationId: string }

function rejected(code: string, message: string): PlanRejection {
  return { status: 'rejected', code, message }
}

function tooPrecise(): PlanRejection {
  return rejected('quantity_too_precise', 'Quantities may have at most 4 decimal places.')
}

function planned(plan: PlannedDocument): ExecutionPlanResultDto {
  return { status: 'planned', plan }
}

function notAllowed(): PlanRejection {
  return rejected('action_not_allowed', 'The production order of this execution does not allow this action.')
}

async function loadContext(deps: ProductionInventoryDeps, executionId: string): Promise<LoadedContext | PlanRejection> {
  const context = await deps.executionContextReader.getContext(executionId, deps.scope)

  if (!context) return rejected('execution_not_found', 'Production execution was not found.')

  return { status: 'loaded', context }
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

async function resolveLocation(
  deps: ProductionInventoryDeps,
  locationId: string | null,
): Promise<ResolvedLocation | PlanRejection> {
  if (!locationId) return rejected('location_missing', 'The execution has no location for this action.')

  const location = await deps.inventoryPolicyReader.getActiveLocation(locationId, deps.scope)

  if (!location) return rejected('location_unavailable', 'The execution location is missing or inactive in WMS.')

  return { status: 'resolved', warehouseId: location.warehouseId, locationId }
}

async function planMaterial(
  deps: ProductionInventoryDeps,
  rule: MaterialActionRule,
  input: MaterialMovementInput,
): Promise<ExecutionPlanResultDto> {
  const quantity = toPositiveQuantity(input.quantity)

  if (quantity === null) return rejected('invalid_quantity', 'Movement quantity must be a positive number.')
  if (!hasAllowedPrecision(quantity)) return tooPrecise()

  const loaded = await loadContext(deps, input.executionId)

  if (loaded.status === 'rejected') return loaded

  const { context } = loaded

  if (!rule.isAllowed(context)) return notAllowed()

  const trackingRejection = await checkTrackingSupport(deps, input.variantId)

  if (trackingRejection) return trackingRejection

  const location = await resolveLocation(deps, context.sourceLocationId)

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
    orderId: context.orderId,
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

function scrapFact(variantId: string, quantity: PositiveQuantity): PlannedFact {
  return {
    factKind: 'scrap_recorded',
    variantId,
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

  if (!hasAllowedPrecision(goodQuantity) || !hasAllowedPrecision(scrapQuantity)) return tooPrecise()

  const loaded = await loadContext(deps, input.executionId)

  if (loaded.status === 'rejected') return loaded

  const { context } = loaded
  const productVariantId = context.productVariantId

  if (!context.allowsConfirmation) return notAllowed()
  if (!productVariantId) return rejected('product_variant_missing', 'Set the product variant on the execution before confirming production.')

  const scrapFacts = scrapQuantity === 0 ? [] : [scrapFact(productVariantId, scrapQuantity)]

  if (goodQuantity === 0) {
    return planned({ documentType: 'confirmation', orderId: context.orderId, movement: null, facts: scrapFacts })
  }

  const trackingRejection = await checkTrackingSupport(deps, productVariantId)

  if (trackingRejection) return trackingRejection

  const location = await resolveLocation(deps, context.targetLocationId)

  if (location.status === 'rejected') return location

  const movement: PlannedMovement = {
    kind: 'receiveOutput',
    variantId: productVariantId,
    warehouseId: location.warehouseId,
    locationId: location.locationId,
    quantity: goodQuantity,
  }

  return planned({
    documentType: 'confirmation',
    orderId: context.orderId,
    movement,
    facts: [movingFact('output_received', movement), ...scrapFacts],
  })
}

async function planDocumentReversal(
  deps: ProductionInventoryDeps,
  document: ReversibleDocument,
): Promise<ExecutionPlanResultDto> {
  const loaded = await loadContext(deps, document.executionId)

  if (loaded.status === 'rejected') return loaded

  const plan = planReversal(document)

  switch (plan.status) {
    case 'already_reversed':
      return rejected('document_already_reversed', 'This document has already been reversed.')
    case 'unsupported':
      return rejected('reversal_not_supported', 'This document cannot be reversed with a single inventory movement.')
    case 'planned':
      return planned(plan.plan)
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
