export const EXECUTION_NUMBER_PREFIX = 'EX'
export const EXECUTION_NUMBER_DIGITS = 6

export type NewProductionExecution = {
  orderId: string | null
  productVariantId: string | null
  sourceLocationId: string | null
  targetLocationId: string | null
  createdBy: string
}

export function formatExecutionNumber(sequence: number): string {
  return `${EXECUTION_NUMBER_PREFIX}-${String(sequence).padStart(EXECUTION_NUMBER_DIGITS, '0')}`
}
