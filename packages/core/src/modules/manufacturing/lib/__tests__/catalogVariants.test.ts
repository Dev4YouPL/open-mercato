import type { EntityManager } from '@mikro-orm/postgresql'

import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import {
  findCatalogVariantIdsBySearch,
  loadCatalogVariantSummaries,
  loadCatalogVariantsForRelease,
  loadFreshCatalogVariantSummary,
} from '../catalogVariants'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findVariants = jest.mocked(findWithDecryption)
const findVariant = jest.mocked(findOneWithDecryption)

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

describe('findCatalogVariantIdsBySearch', () => {
  beforeEach(() => {
    findVariants.mockReset()
  })

  it.each(['', '   '])(
    'returns no IDs without querying for %p',
    async (term) => {
      await expect(
        findCatalogVariantIdsBySearch(em, term, scope, [firstVariantId]),
      ).resolves.toEqual([])

      expect(findVariants).not.toHaveBeenCalled()
    },
  )

  it('returns no IDs without querying when there are no candidates', async () => {
    await expect(
      findCatalogVariantIdsBySearch(em, 'Widget', scope, []),
    ).resolves.toEqual([])

    expect(findVariants).not.toHaveBeenCalled()
  })

  it('searches name, SKU and barcode among the candidates within the scope', async () => {
    findVariants.mockResolvedValue([
      createVariant(firstVariantId),
      createVariant(secondVariantId),
    ])

    await expect(
      findCatalogVariantIdsBySearch(
        em,
        '  Widget  ',
        scope,
        [firstVariantId, secondVariantId, firstVariantId],
      ),
    ).resolves.toEqual([firstVariantId, secondVariantId])

    expect(findVariants).toHaveBeenCalledWith(
      em,
      CatalogProductVariant,
      {
        id: { $in: [firstVariantId, secondVariantId] },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        $or: [
          { name: { $ilike: '%Widget%' } },
          { sku: { $ilike: '%Widget%' } },
          { barcode: { $ilike: '%Widget%' } },
        ],
      },
      {
        fields: ['id'],
      },
      scope,
    )
  })

  it('escapes LIKE wildcards instead of stripping them', async () => {
    findVariants.mockResolvedValue([])

    await findCatalogVariantIdsBySearch(
      em,
      'MFG_O%42\\D',
      scope,
      [firstVariantId],
    )

    const where = findVariants.mock.calls[0]?.[2]

    expect(where).toMatchObject({
      $or: [
        { name: { $ilike: '%MFG\\_O\\%42\\\\D%' } },
        { sku: { $ilike: '%MFG\\_O\\%42\\\\D%' } },
        { barcode: { $ilike: '%MFG\\_O\\%42\\\\D%' } },
      ],
    })
  })

  it('queries candidates in chunks and merges every match', async () => {
    const candidateIds = Array.from(
      { length: 2500 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    )

    findVariants.mockImplementation(async (_em, _entity, where) => {
      const ids = (where as { id: { $in: string[] } }).id.$in

      return [createVariant(ids[ids.length - 1])]
    })

    await expect(
      findCatalogVariantIdsBySearch(em, 'Widget', scope, candidateIds),
    ).resolves.toEqual([
      candidateIds[999],
      candidateIds[1999],
      candidateIds[2499],
    ])

    expect(findVariants).toHaveBeenCalledTimes(3)
  })
})

describe('loadCatalogVariantSummaries', () => {
  beforeEach(() => {
    findVariants.mockReset()
  })

  it('returns an empty map without querying for empty input', async () => {
    await expect(
      loadCatalogVariantSummaries(em, [], scope),
    ).resolves.toEqual(new Map())

    expect(findVariants).not.toHaveBeenCalled()
  })

  it('deduplicates IDs and includes deleted variants in the scoped query', async () => {
    findVariants.mockResolvedValue([])

    await loadCatalogVariantSummaries(
      em,
      [firstVariantId, firstVariantId, secondVariantId],
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
      },
      {
        fields: ['id', 'name', 'sku', 'isActive', 'deletedAt'],
      },
      scope,
    )
  })

  it('maps activity and derives isDeleted from deletedAt', async () => {
    const active = createVariant(firstVariantId, 'Finished product', 'OUTPUT-01')
    const deleted = createVariant(secondVariantId)

    deleted.isActive = false
    deleted.deletedAt = new Date('2026-10-08T13:00:00.000Z')

    findVariants.mockResolvedValue([active, deleted])

    const summaries = await loadCatalogVariantSummaries(
      em,
      [firstVariantId, secondVariantId],
      scope,
    )

    expect(summaries.get(firstVariantId)).toEqual({
      id: firstVariantId,
      name: 'Finished product',
      sku: 'OUTPUT-01',
      isActive: true,
      isDeleted: false,
    })
    expect(summaries.get(secondVariantId)).toEqual({
      id: secondVariantId,
      name: null,
      sku: null,
      isActive: false,
      isDeleted: true,
    })
  })
})

describe('loadFreshCatalogVariantSummary', () => {
  beforeEach(() => findVariant.mockReset())

  it('reads the scoped variant with refresh and maps its state', async () => {
    const variant = createVariant(firstVariantId, 'Finished product', 'OUTPUT-01')
    variant.isActive = false
    findVariant.mockResolvedValue(variant)
    await expect(loadFreshCatalogVariantSummary(em, firstVariantId, scope)).resolves.toEqual({
      id: firstVariantId,
      name: 'Finished product',
      sku: 'OUTPUT-01',
      isActive: false,
      isDeleted: false,
    })
    expect(findVariant).toHaveBeenCalledWith(em, CatalogProductVariant, {
      id: firstVariantId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { fields: ['id', 'name', 'sku', 'isActive', 'deletedAt'], refresh: true }, scope)
  })

  it('returns null when the variant is missing', async () => {
    findVariant.mockResolvedValue(null)
    await expect(loadFreshCatalogVariantSummary(em, firstVariantId, scope)).resolves.toBeNull()
  })
})
