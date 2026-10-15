export type PositiveQuantity = number & { readonly __brand: 'PositiveQuantity' }

export function toPositiveQuantity(value: number): PositiveQuantity | null {
  return Number.isFinite(value) && value > 0 ? (value as PositiveQuantity) : null
}
