export type BomDomainErrorCode =
  | 'bom.target_conflict'
  | 'bom.active_draft_conflict'
  | 'bom.version_conflict'
  | 'bom.cycle_detected'
  | 'bom.variant_product_mismatch'
  | 'bom.quantity_invalid'
  | 'bom.uom_invalid'
  | 'bom.position_exhausted'

const STATUS_BY_CODE: Record<BomDomainErrorCode, number> = {
  'bom.target_conflict': 409,
  'bom.active_draft_conflict': 409,
  'bom.version_conflict': 409,
  'bom.cycle_detected': 409,
  'bom.variant_product_mismatch': 404,
  'bom.quantity_invalid': 422,
  'bom.uom_invalid': 422,
  'bom.position_exhausted': 409,
}

export class BomDomainError extends Error {
  readonly code: BomDomainErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: BomDomainErrorCode, details?: Record<string, unknown>) {
    super(`[internal] ${code}`)
    this.name = 'BomDomainError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

const QUANTITY_ERROR_MAP: Record<string, BomDomainErrorCode> = {
  'uom.variant_product_mismatch': 'bom.variant_product_mismatch',
  'uom.precision_overflow': 'bom.quantity_invalid',
  'uom.unit_not_found': 'bom.uom_invalid',
  'uom.default_unit_missing': 'bom.uom_invalid',
  'uom.conversion_not_found': 'bom.uom_invalid',
  'uom.invalid_factor': 'bom.uom_invalid',
}

export function mapQuantityNormalizationError(error: unknown): BomDomainError {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  return new BomDomainError(QUANTITY_ERROR_MAP[code] ?? 'bom.quantity_invalid')
}
