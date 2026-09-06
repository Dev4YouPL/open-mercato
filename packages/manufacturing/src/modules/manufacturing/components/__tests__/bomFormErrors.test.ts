import { toBomFormError } from '../bomFormErrors'

const translate = (key: string, fallback: string) => `t:${key}|${fallback}`

const fieldIds = {
  unit: 'baseOutputUnitCode',
  quantity: 'baseOutputValue',
  variant: 'variantId',
  product: 'productId',
}

function buildApiError(body: Record<string, unknown>): Error & Record<string, unknown> {
  const error = new Error(String(body.error)) as Error & Record<string, unknown>
  Object.assign(error, body, { status: 422 })
  return error
}

describe('toBomFormError', () => {
  it('turns bom.uom_invalid into a translated error scoped to the unit field', () => {
    const mapped = toBomFormError(
      buildApiError({ error: 'bom.uom_invalid', code: 'bom.uom_invalid' }),
      translate,
      fieldIds,
    ) as Error & { fieldErrors?: Record<string, string> }

    expect(mapped.message).toContain('t:manufacturing.boms.errors.uomInvalid')
    expect(mapped.message).not.toContain('bom.uom_invalid')
    expect(mapped.fieldErrors).toEqual({ baseOutputUnitCode: mapped.message })
  })

  it('scopes quantity and variant codes to their own fields', () => {
    const quantity = toBomFormError(
      buildApiError({ error: 'bom.quantity_invalid', code: 'bom.quantity_invalid' }),
      translate,
      fieldIds,
    ) as Error & { fieldErrors?: Record<string, string> }
    const variant = toBomFormError(
      buildApiError({ error: 'bom.variant_product_mismatch', code: 'bom.variant_product_mismatch' }),
      translate,
      fieldIds,
    ) as Error & { fieldErrors?: Record<string, string> }

    expect(Object.keys(quantity.fieldErrors ?? {})).toEqual(['baseOutputValue'])
    expect(Object.keys(variant.fieldErrors ?? {})).toEqual(['variantId'])
  })

  it('keeps form-level codes without a field scope', () => {
    const mapped = toBomFormError(
      buildApiError({ error: 'bom.cycle_detected', code: 'bom.cycle_detected' }),
      translate,
      fieldIds,
    ) as Error & { fieldErrors?: Record<string, string> }

    expect(mapped.message).toContain('t:manufacturing.boms.errors.cycleDetected')
    expect(mapped.fieldErrors).toBeUndefined()
  })

  it('maps the code even when only the error body field carries it', () => {
    const mapped = toBomFormError(
      buildApiError({ error: 'bom.target_conflict' }),
      translate,
      fieldIds,
    ) as Error & { fieldErrors?: Record<string, string> }

    expect(mapped.fieldErrors).toEqual({ productId: mapped.message })
  })

  it('passes unrelated errors through untouched', () => {
    const original = new Error('boom')

    expect(toBomFormError(original, translate, fieldIds)).toBe(original)
    expect(toBomFormError(undefined, translate, fieldIds)).toBeUndefined()
  })
})
