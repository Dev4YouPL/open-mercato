"use client"

import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors"

export type BomErrorTranslator = (key: string, fallback: string) => string

export type BomErrorFieldIds = {
  unit?: string
  quantity?: string
  variant?: string
  product?: string
}

const MESSAGE_KEYS: Record<string, { key: string; fallback: string; field?: keyof BomErrorFieldIds }> = {
  'bom.uom_invalid': {
    key: 'manufacturing.boms.errors.uomInvalid',
    fallback: 'Pick a unit configured for this product in Catalog. Products without a base unit cannot be used yet.',
    field: 'unit',
  },
  'bom.quantity_invalid': {
    key: 'manufacturing.boms.errors.quantityInvalid',
    fallback: 'Enter a valid quantity — digits with an optional decimal point.',
    field: 'quantity',
  },
  'bom.variant_product_mismatch': {
    key: 'manufacturing.boms.errors.variantProductMismatch',
    fallback: 'This variant does not belong to the selected product.',
    field: 'variant',
  },
  'bom.target_conflict': {
    key: 'manufacturing.boms.errors.targetConflict',
    fallback: 'A BOM already exists for this product and variant.',
    field: 'product',
  },
  'bom.active_draft_conflict': {
    key: 'manufacturing.boms.errors.activeDraftConflict',
    fallback: 'This BOM already has an editable draft revision.',
  },
  'bom.cycle_detected': {
    key: 'manufacturing.boms.errors.cycleDetected',
    fallback: 'This component would make the BOM depend on itself.',
  },
  'bom.position_exhausted': {
    key: 'manufacturing.boms.errors.positionExhausted',
    fallback: 'No free position left — reorder existing occurrences first.',
  },
}

function readErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as { code?: unknown; error?: unknown }
  if (typeof candidate.code === 'string' && candidate.code in MESSAGE_KEYS) return candidate.code
  if (typeof candidate.error === 'string' && candidate.error in MESSAGE_KEYS) return candidate.error
  return null
}

/**
 * Maps a stable `bom.*` domain code coming back from the guarded endpoints onto
 * a translated, field-scoped `CrudForm` error. API codes stay language-neutral;
 * the mapping to human copy belongs here. Unknown errors pass through untouched.
 */
export function toBomFormError(err: unknown, translate: BomErrorTranslator, fieldIds: BomErrorFieldIds): unknown {
  const code = readErrorCode(err)
  if (!code) return err
  const entry = MESSAGE_KEYS[code]
  const message = translate(entry.key, entry.fallback)
  const fieldId = entry.field ? fieldIds[entry.field] : undefined
  return createCrudFormError(message, fieldId ? { [fieldId]: message } : undefined, { status: 422 })
}
