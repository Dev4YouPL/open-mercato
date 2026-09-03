const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import {
  loadProductDefaultUnitCode,
  loadProductOptions,
  loadProductUnitOptions,
  loadVariantFilterOptions,
  loadVariantOptions,
  resolveProductLabel,
  resolveVariantLabel,
} from '../catalogLookups'

type ApiResponse = { items?: Array<Record<string, unknown>> }

function respondPerUrl(byUrl: Record<string, ApiResponse>) {
  apiCallMock.mockImplementation(async (url: string) => {
    const match = Object.keys(byUrl).find((fragment) => url.includes(fragment))
    return { ok: true, status: 200, result: match ? byUrl[match] : { items: [] } }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('loadVariantOptions', () => {
  it('labels variants from name/sku instead of falling back to the raw uuid', async () => {
    respondPerUrl({
      '/api/catalog/variants': {
        items: [
          { id: 'ea6d499c-d4ba-41b0-9a94-3b2b2cd39bbb', name: 'Razor finish', sku: 'SHF-RAZ' },
          { id: '11111111-1111-1111-1111-111111111111', name: 'Classic', sku: null },
          { id: '22222222-2222-2222-2222-222222222222', name: null, sku: 'SHF-ONLY' },
        ],
      },
    })

    const options = await loadVariantOptions('product-1')

    expect(options).toEqual([
      { value: 'ea6d499c-d4ba-41b0-9a94-3b2b2cd39bbb', label: 'Razor finish', description: 'SHF-RAZ' },
      { value: '11111111-1111-1111-1111-111111111111', label: 'Classic', description: null },
      { value: '22222222-2222-2222-2222-222222222222', label: 'SHF-ONLY', description: null },
    ])
    expect(options.every((option) => option.label !== option.value)).toBe(true)
  })

  it('falls back to the id only when the variant carries no readable label', async () => {
    respondPerUrl({
      '/api/catalog/variants': { items: [{ id: 'variant-1', name: '   ', sku: null }] },
    })

    await expect(loadVariantOptions('product-1')).resolves.toEqual([
      { value: 'variant-1', label: 'variant-1', description: null },
    ])
  })

  it('skips the request when no product is selected', async () => {
    await expect(loadVariantOptions('')).resolves.toEqual([])
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})

describe('loadVariantFilterOptions', () => {
  it('searches the whole variant space without pinning a product first', async () => {
    respondPerUrl({ '/api/catalog/variants': { items: [{ id: 'v-1', name: 'Senior', sku: 'SEN-1' }] } })

    await expect(loadVariantFilterOptions('sen')).resolves.toEqual([
      { value: 'v-1', label: 'Senior', description: 'SEN-1' },
    ])
    expect(apiCallMock.mock.calls[0][0]).toContain('search=sen')
    expect(apiCallMock.mock.calls[0][0]).not.toContain('productId=')
  })
})

describe('loadProductOptions', () => {
  it('keeps the catalog title and exposes the sku as a description', async () => {
    respondPerUrl({
      '/api/catalog/products': {
        items: [{ id: 'product-1', title: 'Signature Haircut & Finish', sku: 'SHF' }],
      },
    })

    await expect(loadProductOptions('sig')).resolves.toEqual([
      { value: 'product-1', label: 'Signature Haircut & Finish', description: 'SHF' },
    ])
    expect(apiCallMock.mock.calls[0][0]).toContain('search=sig')
  })
})

describe('loadProductUnitOptions', () => {
  it('offers the product base unit first, then active conversions, deduplicated', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'product-1', default_unit: 'pc' }] },
      '/api/catalog/product-unit-conversions': {
        items: [
          { id: 'c1', unit_code: 'PC' },
          { id: 'c2', unit_code: 'box' },
          { id: 'c3', unitCode: 'pallet' },
        ],
      },
    })

    await expect(loadProductUnitOptions('product-1')).resolves.toEqual([
      { value: 'pc', label: 'pc' },
      { value: 'box', label: 'box' },
      { value: 'pallet', label: 'pallet' },
    ])
  })

  it('filters the offered units by the typed query', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'product-1', default_unit: 'pc' }] },
      '/api/catalog/product-unit-conversions': { items: [{ id: 'c2', unit_code: 'box' }] },
    })

    await expect(loadProductUnitOptions('product-1', 'bo')).resolves.toEqual([
      { value: 'box', label: 'box' },
    ])
  })

  it('returns nothing for a product without a base unit or conversions', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'product-1', default_unit: null }] },
      '/api/catalog/product-unit-conversions': { items: [] },
    })

    await expect(loadProductUnitOptions('product-1')).resolves.toEqual([])
  })

  it('skips the requests when no product is selected', async () => {
    await expect(loadProductUnitOptions(null)).resolves.toEqual([])
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})

describe('loadProductDefaultUnitCode', () => {
  it('reads the base unit of the selected product', async () => {
    respondPerUrl({ '/api/catalog/products': { items: [{ id: 'product-1', default_unit: 'kg' }] } })

    await expect(loadProductDefaultUnitCode('product-1')).resolves.toBe('kg')
  })

  it('returns null when the product has no base unit', async () => {
    respondPerUrl({ '/api/catalog/products': { items: [{ id: 'product-1', default_unit: null }] } })

    await expect(loadProductDefaultUnitCode('product-1')).resolves.toBeNull()
  })
})

describe('label resolvers', () => {
  it('resolves a saved product id to its catalog label', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'p-saved', title: 'Saved product', sku: 'SP-1' }] },
    })

    await expect(resolveProductLabel('p-saved')).resolves.toBe('Saved product')
    expect(apiCallMock.mock.calls[0][0]).toContain('id=p-saved')
  })

  it('resolves a saved variant id to its catalog label', async () => {
    respondPerUrl({
      '/api/catalog/variants': { items: [{ id: 'v-saved', name: 'Saved variant', sku: 'SV-1' }] },
    })

    await expect(resolveVariantLabel('v-saved')).resolves.toBe('Saved variant')
  })

  it('keeps an unresolvable reference readable by its raw id (US-BOM-10)', async () => {
    respondPerUrl({ '/api/catalog/products': { items: [] } })

    await expect(resolveProductLabel('p-gone')).resolves.toBe('p-gone')
  })
})

describe('variant search', () => {
  it('forwards the typed query to the catalog search filter', async () => {
    respondPerUrl({ '/api/catalog/variants': { items: [] } })

    await loadVariantOptions('product-1', 'senior')

    expect(apiCallMock.mock.calls[0][0]).toContain('search=senior')
    expect(apiCallMock.mock.calls[0][0]).toContain('productId=product-1')
  })

  it('omits the search parameter when nothing was typed', async () => {
    respondPerUrl({ '/api/catalog/variants': { items: [] } })

    await loadVariantOptions('product-1', '   ')

    expect(apiCallMock.mock.calls[0][0]).not.toContain('search=')
  })
})
