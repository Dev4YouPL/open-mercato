import type { EntityManager } from '@mikro-orm/postgresql'

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../../data/entities'
import {
  decorateBomListItems,
  findBomOutputVariantIdsBySearch,
} from '../bomListing'
import {
  findCatalogVariantIdsBySearch,
  loadCatalogVariantSummaries,
} from '../catalogVariants'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('../catalogVariants', () => ({
  findCatalogVariantIdsBySearch: jest.fn(),
  loadCatalogVariantSummaries: jest.fn(),
}))

const findBoms = jest.mocked(findWithDecryption)
const searchVariants = jest.mocked(findCatalogVariantIdsBySearch)
const loadSummaries = jest.mocked(loadCatalogVariantSummaries)

const em = {} as EntityManager

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const firstVariantId = '33333333-3333-4333-8333-333333333333'
const secondVariantId = '44444444-4444-4444-8444-444444444444'

const firstVariant = {
  id: firstVariantId,
  name: 'Finished product',
  sku: 'OUTPUT-01',
  isActive: true,
  isDeleted: false,
}

describe('decorateBomListItems', () => {
  beforeEach(() => {
    loadSummaries.mockReset()
  })

  it('loads variants once per page and assigns summaries and availability', async () => {
    loadSummaries.mockResolvedValue(new Map([[firstVariantId, firstVariant]]))

    const released: Record<string, unknown> = {
      outputVariantId: firstVariantId,
      status: 'released',
    }
    const draft: Record<string, unknown> = {
      outputVariantId: firstVariantId,
      status: 'draft',
    }
    const missing: Record<string, unknown> = {
      outputVariantId: secondVariantId,
      status: 'released',
    }

    await decorateBomListItems(em, [released, draft, missing], scope)

    expect(loadSummaries).toHaveBeenCalledTimes(1)
    expect(loadSummaries).toHaveBeenCalledWith(
      em,
      [firstVariantId, firstVariantId, secondVariantId],
      scope,
    )

    expect(released).toMatchObject({
      outputVariant: firstVariant,
      availability: { isAvailable: true, reason: null },
    })
    expect(draft).toMatchObject({
      outputVariant: firstVariant,
      availability: { isAvailable: false, reason: 'draft' },
    })
    expect(missing).toMatchObject({
      outputVariant: null,
      availability: { isAvailable: false, reason: 'variantMissing' },
    })
  })

  it('decorates full list records returned by transformItem', async () => {
    loadSummaries.mockResolvedValue(new Map([[firstVariantId, firstVariant]]))

    const record: Record<string, unknown> = {
      id: '55555555-5555-4555-8555-555555555555',
      outputVariantId: firstVariantId,
      baseQuantity: '1.000000',
      revision: '1',
      status: 'released',
      isIncomplete: false,
      releasedAt: '2026-10-16T09:38:12.484Z',
      releasedByUserId: '66666666-6666-4666-8666-666666666666',
      createdAt: '2026-10-16T09:34:28.598Z',
      updatedAt: '2026-10-16T09:38:12.484Z',
    }

    await decorateBomListItems(em, [record], scope)

    expect(record).toMatchObject({
      outputVariant: firstVariant,
      availability: { isAvailable: true, reason: null },
    })
  })

  it('skips records that do not match the BOM schema', async () => {
    const invalid: Record<string, unknown> = {
      outputVariantId: 'not-a-uuid',
      status: 'released',
    }

    await decorateBomListItems(em, [invalid, null, 'text'], scope)

    expect(loadSummaries).not.toHaveBeenCalled()
    expect(invalid).not.toHaveProperty('availability')
  })

  it('propagates catalog read failures', async () => {
    const error = new Error('[internal] Catalog read failed')

    loadSummaries.mockRejectedValue(error)

    await expect(decorateBomListItems(em, [{
      outputVariantId: firstVariantId,
      status: 'released',
    }], scope)).rejects.toBe(error)
  })
})

describe('findBomOutputVariantIdsBySearch', () => {
  beforeEach(() => {
    findBoms.mockReset()
    searchVariants.mockReset()
  })

  function createBom(outputVariantId: string): ManufacturingBom {
    const bom = new ManufacturingBom()

    bom.outputVariantId = outputVariantId

    return bom
  }

  it('returns no IDs without querying for a blank term', async () => {
    await expect(
      findBomOutputVariantIdsBySearch(em, '   ', scope),
    ).resolves.toEqual([])

    expect(findBoms).not.toHaveBeenCalled()
    expect(searchVariants).not.toHaveBeenCalled()
  })

  it('searches only variants that are outputs of scoped, non-deleted BOMs', async () => {
    findBoms.mockResolvedValue([
      createBom(firstVariantId),
      createBom(secondVariantId),
    ])
    searchVariants.mockResolvedValue([secondVariantId])

    await expect(
      findBomOutputVariantIdsBySearch(em, 'Widget', scope),
    ).resolves.toEqual([secondVariantId])

    expect(findBoms).toHaveBeenCalledWith(
      em,
      ManufacturingBom,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { fields: ['outputVariantId'] },
      scope,
    )
    expect(searchVariants).toHaveBeenCalledWith(
      em,
      'Widget',
      scope,
      [firstVariantId, secondVariantId],
    )
  })

  it('narrows the BOM lookup to an explicit output variant', async () => {
    findBoms.mockResolvedValue([])
    searchVariants.mockResolvedValue([])

    await findBomOutputVariantIdsBySearch(em, 'Widget', scope, firstVariantId)

    expect(findBoms.mock.calls[0]?.[2]).toEqual({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      outputVariantId: firstVariantId,
    })
  })
})
