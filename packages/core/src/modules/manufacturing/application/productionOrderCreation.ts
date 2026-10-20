import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { NewProductionOrder } from '../domain/productionOrder'
import { hasAllowedPrecision, toPositiveQuantity } from '../domain/quantity'
import { isTrackingSupported } from '../domain/trackingSupport'
import type { BomRevisionForOrderDto, BomRevisionReader } from '../ports/bomRevisionReader'
import type { InventoryPolicyReader } from '../ports/inventoryPolicyReader'
import type { ProductionOrderStore } from '../ports/productionOrderStore'

export type ProductionOrderInput = {
  productVariantId: string
  bomRevisionId: string
  plannedQuantity: number
  sourceLocationId: string | null
  targetLocationId: string | null
  dueAt: Date | null
}

export type ProductionOrderField = keyof ProductionOrderInput

export type ProductionOrderCreationResultDto =
  | { status: 'created'; orderId: string; orderNumber: string }
  | { status: 'rejected'; code: string; message: string; field: ProductionOrderField | null }

type Rejection = Extract<ProductionOrderCreationResultDto, { status: 'rejected' }>

type ValidLocation = { status: 'valid'; locationId: string }

type LoadedRevision = { status: 'loaded'; revision: BomRevisionForOrderDto }

type ProductionOrderCreationDeps = {
  bomRevisionReader: BomRevisionReader
  inventoryPolicyReader: InventoryPolicyReader
  productionOrderStore: ProductionOrderStore
  scope: ManufacturingScope
}

function rejected(code: string, message: string, field: ProductionOrderField | null = null): Rejection {
  return { status: 'rejected', code, message, field }
}

function checkQuantity(plannedQuantity: number): Rejection | null {
  if (toPositiveQuantity(plannedQuantity) === null) {
    return rejected('invalid_quantity', 'Planned quantity must be a positive number.', 'plannedQuantity')
  }

  if (!hasAllowedPrecision(plannedQuantity)) {
    return rejected('quantity_too_precise', 'Quantities may have at most 4 decimal places.', 'plannedQuantity')
  }

  return null
}

async function requireLocation(
  deps: ProductionOrderCreationDeps,
  locationId: string | null,
  field: 'sourceLocationId' | 'targetLocationId',
): Promise<ValidLocation | Rejection> {
  if (!locationId) return rejected('location_missing', 'Select a location.', field)

  const location = await deps.inventoryPolicyReader.getActiveLocation(locationId, deps.scope)

  if (!location) return rejected('location_unavailable', 'Location is missing or inactive in WMS.', field)

  return { status: 'valid', locationId }
}

async function loadRevision(
  deps: ProductionOrderCreationDeps,
  input: ProductionOrderInput,
): Promise<LoadedRevision | Rejection> {
  const revision = await deps.bomRevisionReader.getForOrder(input.bomRevisionId, deps.scope)

  if (!revision) return rejected('bom_revision_not_found', 'BOM revision was not found.', 'bomRevisionId')
  if (!revision.isReleased) return rejected('bom_revision_not_released', 'BOM revision is not released.', 'bomRevisionId')
  if (!revision.isAvailable) return rejected('bom_revision_unavailable', 'BOM revision is not available.', 'bomRevisionId')

  if (revision.productVariantId !== input.productVariantId) {
    return rejected(
      'variant_revision_mismatch',
      'The product variant must be the variant of the selected BOM revision.',
      'bomRevisionId',
    )
  }

  return { status: 'loaded', revision }
}

async function checkTrackingPolicies(
  deps: ProductionOrderCreationDeps,
  revision: BomRevisionForOrderDto,
): Promise<Rejection | null> {
  const variantIds = [...new Set([revision.productVariantId, ...revision.components.map((component) => component.variantId)])]

  for (const variantId of variantIds) {
    const tracking = await deps.inventoryPolicyReader.getTrackingPolicy(variantId, deps.scope)

    if (tracking.status === 'unavailable') {
      return rejected('inventory_unavailable', 'Inventory policy is unavailable; is the WMS module enabled?')
    }

    if (!isTrackingSupported(tracking.policy)) {
      return rejected(
        'tracking_not_supported',
        `Variant ${variantId} requires lot, serial number or expiry tracking, which is not supported yet.`,
      )
    }
  }

  return null
}

export async function createProductionOrder(
  deps: ProductionOrderCreationDeps,
  input: ProductionOrderInput,
): Promise<ProductionOrderCreationResultDto> {
  const quantityRejection = checkQuantity(input.plannedQuantity)

  if (quantityRejection) return quantityRejection

  const source = await requireLocation(deps, input.sourceLocationId, 'sourceLocationId')

  if (source.status === 'rejected') return source

  const target = await requireLocation(deps, input.targetLocationId, 'targetLocationId')

  if (target.status === 'rejected') return target

  const loaded = await loadRevision(deps, input)

  if (loaded.status === 'rejected') return loaded

  const trackingRejection = await checkTrackingPolicies(deps, loaded.revision)

  if (trackingRejection) return trackingRejection

  const order: NewProductionOrder = {
    productVariantId: input.productVariantId,
    bomRevisionId: loaded.revision.id,
    plannedQuantity: input.plannedQuantity,
    sourceLocationId: source.locationId,
    targetLocationId: target.locationId,
    dueAt: input.dueAt,
  }
  const created = await deps.productionOrderStore.create(order, deps.scope)

  return { status: 'created', orderId: created.id, orderNumber: created.orderNumber }
}
