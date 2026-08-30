const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import {
  loadProductDefaultUnitCode,
  loadProductOptions,
  loadProductOptionsWithSelection,
  loadProductUnitOptions,
  loadVariantOptions,
  loadVariantOptionsWithSelection,
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
      { id: 'ea6d499c-d4ba-41b0-9a94-3b2b2cd39bbb', title: 'Razor finish', subtitle: 'SHF-RAZ' },
      { id: '11111111-1111-1111-1111-111111111111', title: 'Classic', subtitle: null },
      { id: '22222222-2222-2222-2222-222222222222', title: 'SHF-ONLY', subtitle: null },
    ])
    expect(options.every((option) => option.title !== option.id)).toBe(true)
  })

  it('falls back to the id only when the variant carries no readable label', async () => {
    respondPerUrl({
      '/api/catalog/variants': { items: [{ id: 'variant-1', name: '   ', sku: null }] },
    })

    await expect(loadVariantOptions('product-1')).resolves.toEqual([
      { id: 'variant-1', title: 'variant-1', subtitle: null },
    ])
  })

  it('skips the request when no product is selected', async () => {
    await expect(loadVariantOptions('')).resolves.toEqual([])
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})

describe('loadProductOptions', () => {
  it('keeps the catalog title and exposes the sku as a subtitle', async () => {
    respondPerUrl({
      '/api/catalog/products': {
        items: [{ id: 'product-1', title: 'Signature Haircut & Finish', sku: 'SHF' }],
      },
    })

    await expect(loadProductOptions('sig')).resolves.toEqual([
      { id: 'product-1', title: 'Signature Haircut & Finish', subtitle: 'SHF' },
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
      { id: 'pc', title: 'pc' },
      { id: 'box', title: 'box' },
      { id: 'pallet', title: 'pallet' },
    ])
  })

  it('filters the offered units by the typed query', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'product-1', default_unit: 'pc' }] },
      '/api/catalog/product-unit-conversions': { items: [{ id: 'c2', unit_code: 'box' }] },
    })

    await expect(loadProductUnitOptions('product-1', 'bo')).resolves.toEqual([
      { id: 'box', title: 'box' },
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

describe('selection-aware loaders', () => {
  it('prepends the saved product so a restored editor value still renders', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('id=p-saved')) {
        return { ok: true, status: 200, result: { items: [{ id: 'p-saved', title: 'Saved product', sku: 'SP-1' }] } }
      }
      return { ok: true, status: 200, result: { items: [{ id: 'p-other', title: 'Other', sku: null }] } }
    })

    const options = await loadProductOptionsWithSelection('oth', 'p-saved')

    expect(options.map((option) => option.id)).toEqual(['p-saved', 'p-other'])
    expect(options[0].title).toBe('Saved product')
  })

  it('does not duplicate the selection when the query already returned it', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'p1', title: 'Only', sku: null }] },
    })

    const options = await loadProductOptionsWithSelection('onl', 'p1')

    expect(options.map((option) => option.id)).toEqual(['p1'])
  })

  it('shows only the current selection until something is typed', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('id=p-saved')) {
        return { ok: true, status: 200, result: { items: [{ id: 'p-saved', title: 'Saved product', sku: null }] } }
      }
      return { ok: true, status: 200, result: { items: [{ id: 'p-a' }, { id: 'p-b' }] } }
    })

    await expect(loadProductOptionsWithSelection(undefined, 'p-saved')).resolves.toEqual([
      { id: 'p-saved', title: 'Saved product', subtitle: null },
    ])
  })

  it('still lists everything when there is no selection to show', async () => {
    respondPerUrl({
      '/api/catalog/products': { items: [{ id: 'p-a', title: 'A', sku: null }, { id: 'p-b', title: 'B', sku: null }] },
    })

    const options = await loadProductOptionsWithSelection(undefined, null)

    expect(options.map((option) => option.id)).toEqual(['p-a', 'p-b'])
  })

  it('prepends the saved variant so the editor target stays visible', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('id=v-saved')) {
        return { ok: true, status: 200, result: { items: [{ id: 'v-saved', name: 'Saved variant', sku: 'SV-1' }] } }
      }
      return { ok: true, status: 200, result: { items: [{ id: 'v-other', name: 'Other', sku: null }] } }
    })

    const options = await loadVariantOptionsWithSelection('product-1', 'oth', 'v-saved')

    expect(options.map((option) => option.id)).toEqual(['v-saved', 'v-other'])
  })

  it('returns nothing and skips every request without a product', async () => {
    await expect(loadVariantOptionsWithSelection(null, 'q', 'v1')).resolves.toEqual([])
    expect(apiCallMock).not.toHaveBeenCalled()
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
