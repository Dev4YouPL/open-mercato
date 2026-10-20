import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { TrackingRequirements } from '../domain/trackingSupport'

export const INVENTORY_POLICY_READER_DI_KEY = 'manufacturingInventoryPolicyReader'

export type TrackingPolicyDto = TrackingRequirements

export type TrackingPolicyResultDto =
  | { status: 'resolved'; policy: TrackingPolicyDto }
  | { status: 'unavailable' }

export type InventoryLocationDto = {
  id: string
  warehouseId: string
  code: string
  type: string
}

export type InventoryLocationFilter = {
  warehouseId?: string
}

export interface InventoryPolicyReader {
  getTrackingPolicy(variantId: string, scope: ManufacturingScope): Promise<TrackingPolicyResultDto>
  listActiveLocations(scope: ManufacturingScope, filter?: InventoryLocationFilter): Promise<InventoryLocationDto[]>
  getActiveLocation(locationId: string, scope: ManufacturingScope): Promise<InventoryLocationDto | null>
}

export function resolveInventoryPolicyReader(container: AwilixContainer): InventoryPolicyReader {
  return container.resolve<InventoryPolicyReader>(INVENTORY_POLICY_READER_DI_KEY)
}
