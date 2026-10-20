import type { ProductionOrderStatus } from './orderExecutionPermissions'

export const ORDER_NUMBER_PREFIX = 'PO'
export const ORDER_NUMBER_DIGITS = 6
export const INITIAL_ORDER_STATUS: ProductionOrderStatus = 'draft'

export type NewProductionOrder = {
  productVariantId: string
  bomRevisionId: string
  plannedQuantity: number
  sourceLocationId: string
  targetLocationId: string
  dueAt: Date | null
}

export function formatOrderNumber(sequence: number): string {
  return `${ORDER_NUMBER_PREFIX}-${String(sequence).padStart(ORDER_NUMBER_DIGITS, '0')}`
}
