export const QUANTITY_DECIMAL_PLACES = 4

export type PositiveQuantity = number & { readonly __brand: 'PositiveQuantity' }

export function toPositiveQuantity(value: number): PositiveQuantity | null {
  return Number.isFinite(value) && value > 0 ? (value as PositiveQuantity) : null
}

export function hasAllowedPrecision(value: number): boolean {
  return Number(value.toFixed(QUANTITY_DECIMAL_PLACES)) === value
}

export function roundQuantity(value: number): number {
  const rounded = Number(`${Math.round(Number(`${Math.abs(value)}e${QUANTITY_DECIMAL_PLACES}`))}e-${QUANTITY_DECIMAL_PLACES}`)

  return value < 0 ? -rounded : rounded
}
