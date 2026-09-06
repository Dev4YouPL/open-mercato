import { assertBomCatalogTargetActive, resolveBomQuantity } from '../quantity'

const scope = { tenantId: 'tenant', organizationId: 'org', productId: 'product', variantId: 'variant' }

it('checks current product and variant membership without normalizing historical evidence', async () => {
  const query = jest.fn().mockResolvedValue({ items: [{ id: 'found' }] })
  const container = { resolve: jest.fn(() => ({ query })) } as never
  await assertBomCatalogTargetActive({ ...scope, container })
  expect(query).toHaveBeenNthCalledWith(1, 'catalog:catalog_product', expect.objectContaining({ tenantId: 'tenant', organizationId: 'org', filters: { id: 'product', deleted_at: null } }))
  expect(query).toHaveBeenNthCalledWith(2, 'catalog:catalog_product_variant', expect.objectContaining({ tenantId: 'tenant', organizationId: 'org', filters: { id: 'variant', product_id: 'product', deleted_at: null, is_active: true } }))
})

it.each([0, 1])('rejects missing or ineligible target at lookup %s', async (missingIndex) => {
  const query = jest.fn().mockResolvedValue({ items: [{ id: 'found' }] })
  if (missingIndex === 0) query.mockResolvedValueOnce({ items: [] })
  else query.mockResolvedValueOnce({ items: [{ id: 'product' }] }).mockResolvedValueOnce({ items: [] })
  await expect(assertBomCatalogTargetActive({ ...scope, container: { resolve: () => ({ query }) } as never }))
    .rejects.toMatchObject({ code: 'bom.variant_product_mismatch', status: 404 })
})

it.each(['0.0000001', '1000000000000', '0.000000'])('rejects normalized quantity %s before persistence', async (normalizedQuantity) => {
  const resolve = jest.fn().mockResolvedValue({ enteredQuantity: '1', normalizedQuantity })
  await expect(resolveBomQuantity({ ...scope, container: { resolve: () => ({ resolve }) } as never, quantity: { value: '1' } }))
    .rejects.toMatchObject({ code: 'bom.quantity_invalid', status: 422 })
})
