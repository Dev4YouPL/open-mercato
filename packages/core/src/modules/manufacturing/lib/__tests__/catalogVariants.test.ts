import type { EntityManager } from '@mikro-orm/postgresql'

import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { loadCatalogVariantsForRelease } from '../catalogVariants'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findVariants = jest.mocked(findWithDecryption)

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const firstVariantId = '33333333-3333-4333-8333-333333333333'
const secondVariantId = '44444444-4444-4444-8444-444444444444'

const em = {} as EntityManager

function createVariant(
  id: string,
  name?: string | null,
  sku?: string | null,
): CatalogProductVariant {
  const variant = new CatalogProductVariant()

  variant.id = id
  variant.name = name
  variant.sku = sku

  return variant
}

describe('loadCatalogVariantsForRelease', () => {
  beforeEach(() => {
    findVariants.mockReset()
  })

  it('returns an empty result without querying for empty input', async () => {
    await expect(
      loadCatalogVariantsForRelease(em, [], scope),
    ).resolves.toEqual([])

    expect(findVariants).not.toHaveBeenCalled()
  })

  it('deduplicates IDs and scopes the database query', async () => {
    findVariants.mockResolvedValue([
      createVariant(firstVariantId, 'Finished product', 'OUTPUT-01'),
      createVariant(secondVariantId, 'Component', 'COMP-01'),
    ])

    await loadCatalogVariantsForRelease(
      em,
      [firstVariantId, secondVariantId, firstVariantId],
      scope,
    )

    expect(findVariants).toHaveBeenCalledTimes(1)

    expect(findVariants).toHaveBeenCalledWith(
      em,
      CatalogProductVariant,
      {
        id: { $in: [firstVariantId, secondVariantId] },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      {
        fields: ['id', 'name', 'sku'],
        refresh: true,
      },
      scope,
    )
  })

  it('returns names and SKUs and normalizes missing values', async () => {
    findVariants.mockResolvedValue([
      createVariant(firstVariantId, 'Finished product', 'OUTPUT-01'),
      createVariant(secondVariantId),
    ])

    await expect(
      loadCatalogVariantsForRelease(
        em,
        [firstVariantId, secondVariantId],
        scope,
      ),
    ).resolves.toEqual([
      {
        id: firstVariantId,
        name: 'Finished product',
        sku: 'OUTPUT-01',
      },
      {
        id: secondVariantId,
        name: null,
        sku: null,
      },
    ])
  })

  it('leaves unavailable variants absent from the result', async () => {
    findVariants.mockResolvedValue([
      createVariant(firstVariantId, 'Finished product', 'OUTPUT-01'),
    ])

    await expect(
      loadCatalogVariantsForRelease(
        em,
        [firstVariantId, secondVariantId],
        scope,
      ),
    ).resolves.toEqual([
      {
        id: firstVariantId,
        name: 'Finished product',
        sku: 'OUTPUT-01',
      },
    ])
  })

  it('propagates database read failures', async () => {
    const error = new Error('[internal] Catalog read failed')

    findVariants.mockRejectedValue(error)

    await expect(
      loadCatalogVariantsForRelease(
        em,
        [firstVariantId],
        scope,
      ),
    ).rejects.toBe(error)
  })
})