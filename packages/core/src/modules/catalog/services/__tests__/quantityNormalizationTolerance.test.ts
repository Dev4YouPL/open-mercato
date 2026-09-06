import { createCatalogQuantityNormalizationService } from '../quantityNormalizationService'
import { uomErrorStatus } from '../../../sales/commands/documents'

/**
 * Centralising normalisation in this service replaced three graceful fallbacks
 * with a throw. `GET /api/catalog/products` fans the service out over a whole
 * page, so a single product without a conversion for the requested unit
 * rejected the batch and the route's outer catch dropped `offers`,
 * `channelIds`, `categories`, `tags` and `pricing` for every row.
 *
 * `resolveManySettled` is the read-path entry point: normalisation-domain
 * failures degrade one entry, everything else still fails the batch so an
 * infrastructure fault is not silently rendered as a missing price.
 */

const tenantId = '33333333-3333-4333-8333-333333333333'
const organizationId = '22222222-2222-4222-8222-222222222222'
const convertible = '44444444-4444-4444-8444-444444444444'
const unconvertible = '55555555-5555-4555-8555-555555555555'

function productRow(id: string) {
  return { id, defaultUnit: 'pc', uomRoundingMode: 'half_up', uomRoundingScale: 2 }
}

describe('resolveManySettled', () => {
  it('degrades only the products that cannot be converted', async () => {
    const em = {
      findOne: jest.fn(async (_entity: unknown, where: { id?: string }) =>
        where.id === convertible || where.id === unconvertible ? productRow(String(where.id)) : null,
      ),
      find: jest.fn(async (_entity: unknown, where: { product?: string }) =>
        where.product === convertible ? [{ id: 'conversion-1', unitCode: 'box', toBaseFactor: '12', isActive: true }] : [],
      ),
    }
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    const outcomes = await service.resolveManySettled([
      { tenantId, organizationId, productId: convertible, enteredQuantity: '2', enteredUnitCode: 'box' },
      { tenantId, organizationId, productId: unconvertible, enteredQuantity: '2', enteredUnitCode: 'box' },
    ])

    expect(outcomes[0]).toMatchObject({ ok: true, snapshot: { productId: convertible, normalizedQuantity: '24' } })
    expect(outcomes[1]).toEqual({ ok: false, productId: unconvertible, code: 'uom.conversion_not_found' })
  })

  it('reports a missing product as a degraded entry rather than losing the page', async () => {
    const em = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) }
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    const outcomes = await service.resolveManySettled([
      { tenantId, organizationId, productId: unconvertible, enteredQuantity: '1', enteredUnitCode: 'box' },
    ])

    expect(outcomes[0]).toEqual({ ok: false, productId: unconvertible, code: 'uom.variant_product_mismatch' })
  })

  it('still fails the batch when the failure is not a normalization error', async () => {
    const em = {
      findOne: jest.fn(async () => {
        throw new Error('[internal] connection terminated')
      }),
      find: jest.fn(async () => []),
    }
    const service = createCatalogQuantityNormalizationService({ em: em as never })

    await expect(
      service.resolveManySettled([{ tenantId, organizationId, productId: convertible, enteredQuantity: '1' }]),
    ).rejects.toThrow('connection terminated')
  })
})

describe('Sales UoM error statuses', () => {
  it.each([
    ['uom.conversion_not_found', 400],
    ['uom.invalid_factor', 400],
    ['uom.unit_not_found', 400],
    ['uom.default_unit_missing', 400],
    ['uom.precision_overflow', 422],
    ['uom.variant_product_mismatch', 404],
  ])('keeps %s on status %i', (code, status) => {
    expect(uomErrorStatus(code)).toBe(status)
  })

  it('falls back to 422 for a code the service has not published before', () => {
    expect(uomErrorStatus('uom.something_new')).toBe(422)
  })
})
