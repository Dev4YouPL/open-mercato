import type { PositiveQuantity } from './quantity'

export type MovementKind = 'consume' | 'restock' | 'receiveOutput'

export type PlannedMovement = {
  kind: MovementKind
  variantId: string
  warehouseId: string
  locationId: string
  quantity: PositiveQuantity
}
