/** @jest-environment node */

import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  CATALOG_CREATE_PRODUCT_COMMAND_ID,
  CATALOG_CREATE_VARIANT_COMMAND_ID,
  CATALOG_VARIANT_ENTITY_ID,
  createCatalogExampleProducts,
} from '../catalogExampleProducts'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ctx = {} as CommandRuntimeContext

function build(existing: Array<{ id: string; sku: string }>) {
  const query = jest.fn(async () => ({ items: existing, page: 1, pageSize: 100, total: existing.length }))
  const execute = jest.fn(async (commandId: string) =>
    commandId === CATALOG_CREATE_PRODUCT_COMMAND_ID
      ? { result: { productId: 'product-new' }, logEntry: null }
      : { result: { variantId: 'variant-new' }, logEntry: null },
  )
  const catalog = createCatalogExampleProducts({
    queryEngine: { query } as unknown as QueryEngine,
    commandBus: { execute } as unknown as CommandBus,
  })
  return { catalog, query, execute }
}

describe('catalog example products', () => {
  it('reuses variants that already exist by SKU without creating products', async () => {
    const { catalog, query, execute } = build([{ id: 'variant-1', sku: 'OAK-TOP-180' }])

    const variants = await catalog.ensureVariants([{ sku: 'OAK-TOP-180', title: 'Oak Table Top' }], ctx, scope)

    expect(variants.get('OAK-TOP-180')).toBe('variant-1')
    expect(execute).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(
      CATALOG_VARIANT_ENTITY_ID,
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', filters: { sku: { $in: ['OAK-TOP-180'] } } }),
    )
  })

  it('creates a product with a default variant for a missing SKU', async () => {
    const { catalog, execute } = build([])

    const variants = await catalog.ensureVariants([{ sku: 'OAK-LEG-72', title: 'Oak Table Leg' }], ctx, scope)

    expect(variants.get('OAK-LEG-72')).toBe('variant-new')
    expect(execute).toHaveBeenNthCalledWith(1, CATALOG_CREATE_PRODUCT_COMMAND_ID, {
      input: { ...scope, title: 'Oak Table Leg' },
      ctx,
    })
    expect(execute).toHaveBeenNthCalledWith(2, CATALOG_CREATE_VARIANT_COMMAND_ID, {
      input: { ...scope, productId: 'product-new', sku: 'OAK-LEG-72', name: 'Oak Table Leg', isDefault: true, isActive: true },
      ctx,
    })
  })
})
