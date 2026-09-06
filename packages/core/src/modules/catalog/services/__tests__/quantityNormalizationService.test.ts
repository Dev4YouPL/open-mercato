import {
  createCatalogQuantityNormalizationService,
  QuantityNormalizationError,
} from '../quantityNormalizationService'

const tenantId = '33333333-3333-4333-8333-333333333333'
const organizationId = '22222222-2222-4222-8222-222222222222'
const productId = '44444444-4444-4444-8444-444444444444'

function createEm() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
}

describe('Catalog quantity normalization service', () => {
  it('normalizes exact quantities with the product policy and immutable evidence', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([{ id: 'conversion-1', unitCode: 'box', toBaseFactor: '12', isActive: true }])
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    const snapshot = await service.resolve({
      tenantId,
      organizationId,
      productId,
      enteredQuantity: '2.5',
      enteredUnitCode: 'box',
    })

    expect(snapshot).toMatchObject({
      version: 1,
      productId,
      productVariantId: null,
      baseUnitCode: 'pc',
      enteredUnitCode: 'box',
      enteredQuantity: '2.5',
      toBaseFactor: '12',
      normalizedQuantity: '30',
      rounding: { mode: 'half_up', scale: 2 },
      source: { conversionId: 'conversion-1' },
    })
  })

  it('fails closed when an alternate unit has no active direct conversion', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([])
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    await expect(service.resolve({ tenantId, organizationId, productId, enteredQuantity: '1', enteredUnitCode: 'box' }))
      .rejects.toMatchObject<Partial<QuantityNormalizationError>>({ code: 'uom.conversion_not_found' })
  })

  it('does not cross tenant scope when loading a product', async () => {
    const em = createEm()
    em.findOne.mockResolvedValueOnce(null)
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    await expect(service.resolve({ tenantId, organizationId, productId, enteredQuantity: '1' }))
      .rejects.toMatchObject<Partial<QuantityNormalizationError>>({ code: 'uom.variant_product_mismatch' })

    expect(em.findOne.mock.calls[0][1]).toMatchObject({ tenantId, organizationId, deletedAt: null })
  })

  it('reuses product conversion reads for a same-product batch', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValue(null)
    em.find.mockResolvedValueOnce([{ id: 'conversion-1', unitCode: 'box', toBaseFactor: '12', isActive: true }])
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    const snapshots = await service.resolveMany([
      { tenantId, organizationId, productId, enteredQuantity: '1', enteredUnitCode: 'box' },
      { tenantId, organizationId, productId, enteredQuantity: '2', enteredUnitCode: 'box' },
    ])

    expect(snapshots.map((snapshot) => snapshot.normalizedQuantity)).toEqual(['12', '24'])
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('inherits product policy for a variant scoped to that product', async () => {
    const variantId = '55555555-5555-4555-8555-555555555555'
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValueOnce({ id: variantId, product: productId })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([])
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    const snapshot = await service.resolve({
      tenantId,
      organizationId,
      productId,
      productVariantId: variantId,
      enteredQuantity: '3',
    })

    expect(snapshot).toMatchObject({
      productVariantId: variantId,
      baseUnitCode: 'pc',
      enteredUnitCode: 'pc',
      normalizedQuantity: '3',
      toBaseFactor: '1',
    })
  })

  it('fails closed when a variant does not belong to the scoped product', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValueOnce(null)
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    await expect(
      service.resolve({
        tenantId,
        organizationId,
        productId,
        productVariantId: 'other-variant',
        enteredQuantity: '1',
      }),
    ).rejects.toMatchObject<Partial<QuantityNormalizationError>>({ code: 'uom.variant_product_mismatch' })
  })

  it('rejects an out-of-envelope entered quantity as precision overflow', async () => {
    const em = createEm()
    em.findOne
      .mockResolvedValueOnce({ id: productId, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 })
      .mockResolvedValueOnce(null)
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    await expect(
      service.resolve({
        tenantId,
        organizationId,
        productId,
        enteredQuantity: '9'.repeat(30),
      }),
    ).rejects.toMatchObject<Partial<QuantityNormalizationError>>({ code: 'uom.precision_overflow' })
  })
})
