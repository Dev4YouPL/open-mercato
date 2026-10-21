import { z } from 'zod'

export const bomStatusSchema = z.enum(['draft', 'released'])

export type ManufacturingBomStatus =
  z.infer<typeof bomStatusSchema>

export function isBomStatusUsableInOrder(
  status: ManufacturingBomStatus,
): boolean {
  return status === 'released'
}

export type BomNewOrderSelectionState = {
  status: ManufacturingBomStatus
  isAvailableForNewOrders: boolean
}

export function isBomSelectableForNewOrder(
  bom: BomNewOrderSelectionState,
): boolean {
  return isBomStatusUsableInOrder(bom.status) && bom.isAvailableForNewOrders
}
