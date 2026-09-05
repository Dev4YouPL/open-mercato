import { formatCatalogTarget, missingCatalogLabel, parseCatalogLabel } from '../catalogLabels'

describe('formatCatalogTarget', () => {
  it('renders resolved product and variant names', () => {
    expect(
      formatCatalogTarget(
        { productName: 'Signature Haircut & Finish', variantName: 'Senior Stylist · 60 min', catalogState: 'resolved' },
        { productId: 'p-uuid', variantId: 'v-uuid' },
      ),
    ).toBe('Signature Haircut & Finish / Senior Stylist · 60 min')
  })

  it('omits the variant segment when the target has no variant', () => {
    expect(
      formatCatalogTarget(
        { productName: 'Signature Haircut & Finish', variantName: null, catalogState: 'resolved' },
        { productId: 'p-uuid', variantId: null },
      ),
    ).toBe('Signature Haircut & Finish')
  })

  it('keeps an unresolvable record readable by its raw id (US-BOM-10)', () => {
    expect(formatCatalogTarget(missingCatalogLabel, { productId: 'p-uuid', variantId: 'v-uuid' })).toBe(
      'p-uuid / v-uuid',
    )
  })

  it('falls back per side when only one half resolves', () => {
    expect(
      formatCatalogTarget(
        { productName: 'Kept product', variantName: null, catalogState: 'partial' },
        { productId: 'p-uuid', variantId: 'v-uuid' },
      ),
    ).toBe('Kept product / v-uuid')
  })
})

describe('parseCatalogLabel', () => {
  it('accepts a well-formed payload', () => {
    expect(parseCatalogLabel({ productName: 'A', variantName: 'B', catalogState: 'resolved' })).toEqual({
      productName: 'A',
      variantName: 'B',
      catalogState: 'resolved',
    })
  })

  it('degrades an absent or malformed payload to missing', () => {
    expect(parseCatalogLabel(undefined)).toEqual(missingCatalogLabel)
    expect(parseCatalogLabel(null)).toEqual(missingCatalogLabel)
    expect(parseCatalogLabel('nonsense')).toEqual(missingCatalogLabel)
    expect(parseCatalogLabel({ productName: 42, catalogState: 'bogus' })).toEqual(missingCatalogLabel)
  })
})
