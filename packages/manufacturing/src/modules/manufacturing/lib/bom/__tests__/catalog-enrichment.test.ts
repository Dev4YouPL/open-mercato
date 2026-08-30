import { loadCatalogLabels, missingCatalogLabel } from '../catalog-enrichment'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

type QueryCall = { entityId: string; options: Record<string, unknown> }

function makeContainer(
  responses: Record<string, Array<Record<string, unknown>>>,
  calls: QueryCall[] = [],
  fail = false,
) {
  return {
    calls,
    container: {
      resolve: () => ({
        query: async (entityId: string, options: Record<string, unknown>) => {
          if (fail) throw new Error('[internal] catalog unavailable')
          calls.push({ entityId, options })
          return { items: responses[entityId] ?? [], total: (responses[entityId] ?? []).length }
        },
      }),
    } as { resolve<T>(key: string): T },
  }
}

const PRODUCTS = 'catalog:catalog_product'
const VARIANTS = 'catalog:catalog_product_variant'

describe('loadCatalogLabels', () => {
  it('resolves product and variant names instead of leaving raw UUIDs', async () => {
    const { container } = makeContainer({
      [PRODUCTS]: [{ id: 'p1', title: 'Signature Haircut & Finish', sku: 'SERV-HAIR-60' }],
      [VARIANTS]: [{ id: 'v1', name: 'Senior Stylist · 60 min', sku: 'SERV-HAIR-60-SENIOR' }],
    })

    const index = await loadCatalogLabels(container, SCOPE, [{ productId: 'p1', variantId: 'v1' }])

    expect(index.labelFor({ productId: 'p1', variantId: 'v1' })).toEqual({
      productName: 'Signature Haircut & Finish',
      variantName: 'Senior Stylist · 60 min',
      catalogState: 'resolved',
    })
  })

  it('batches one query per entity regardless of how many rows reference the same target', async () => {
    const calls: QueryCall[] = []
    const { container } = makeContainer(
      { [PRODUCTS]: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }], [VARIANTS]: [] },
      calls,
    )

    await loadCatalogLabels(container, SCOPE, [
      { productId: 'p1', variantId: null },
      { productId: 'p1', variantId: null },
      { productId: 'p2', variantId: null },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0].entityId).toBe(PRODUCTS)
    expect(calls[0].options.filters).toEqual({ id: { $in: ['p1', 'p2'] } })
  })

  it('scopes every query to the caller tenant and organization', async () => {
    const calls: QueryCall[] = []
    const { container } = makeContainer({ [PRODUCTS]: [], [VARIANTS]: [] }, calls)

    await loadCatalogLabels(container, SCOPE, [{ productId: 'p1', variantId: 'v1' }])

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options.tenantId).toBe('tenant-1')
      expect(call.options.organizationId).toBe('org-1')
    }
  })

  it('falls back to sku when a record carries no display name', async () => {
    const { container } = makeContainer({
      [PRODUCTS]: [{ id: 'p1', title: '   ', sku: 'SKU-1' }],
      [VARIANTS]: [{ id: 'v1', name: null, sku: 'VAR-1' }],
    })

    const index = await loadCatalogLabels(container, SCOPE, [{ productId: 'p1', variantId: 'v1' }])

    expect(index.labelFor({ productId: 'p1', variantId: 'v1' })).toEqual({
      productName: 'SKU-1',
      variantName: 'VAR-1',
      catalogState: 'resolved',
    })
  })

  it('reports partial when only one side of the target resolves', async () => {
    const { container } = makeContainer({
      [PRODUCTS]: [{ id: 'p1', title: 'Kept product' }],
      [VARIANTS]: [],
    })

    const index = await loadCatalogLabels(container, SCOPE, [{ productId: 'p1', variantId: 'gone' }])

    expect(index.labelFor({ productId: 'p1', variantId: 'gone' })).toEqual({
      productName: 'Kept product',
      variantName: null,
      catalogState: 'partial',
    })
  })

  it('reports missing for an unresolvable target so the UI keeps the raw id', async () => {
    const { container } = makeContainer({ [PRODUCTS]: [], [VARIANTS]: [] })

    const index = await loadCatalogLabels(container, SCOPE, [{ productId: 'gone', variantId: null }])

    expect(index.labelFor({ productId: 'gone', variantId: null })).toEqual(missingCatalogLabel)
  })

  it('fails soft when Catalog is unavailable rather than failing the read', async () => {
    const { container } = makeContainer({}, [], true)

    const index = await loadCatalogLabels(container, SCOPE, [{ productId: 'p1', variantId: 'v1' }])

    expect(index.labelFor({ productId: 'p1', variantId: 'v1' })).toEqual(missingCatalogLabel)
  })

  it('issues no query at all for an empty page', async () => {
    const calls: QueryCall[] = []
    const { container } = makeContainer({}, calls)

    const index = await loadCatalogLabels(container, SCOPE, [])

    expect(calls).toHaveLength(0)
    expect(index.labelFor({ productId: 'anything', variantId: null })).toEqual(missingCatalogLabel)
  })
})
