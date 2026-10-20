import { asValue, createContainer } from 'awilix'

import {
  makeCrudRoute,
} from '@open-mercato/shared/lib/crud/factory'
import type {
  CrudCtx,
} from '@open-mercato/shared/lib/crud/factory'

import { bomListQuerySchema } from '../../data/validators'
import {
  decorateBomListItems,
  findBomOutputVariantIdsBySearch,
} from '../../lib/bomListing'
import { resolveManufacturingApiScope } from '../utils'
import '../boms/route'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  })),
}))

jest.mock('../utils', () => ({
  manufacturingDeleteRequestSchema: {},
  mapBomCreateInput: jest.fn(),
  mapBomDeleteInput: jest.fn(),
  mapBomUpdateInput: jest.fn(),
  resolveManufacturingApiScope: jest.fn(),
}))

jest.mock('../../lib/bomListing', () => ({
  decorateBomListItems: jest.fn(),
  findBomOutputVariantIdsBySearch: jest.fn(),
}))

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const bomId = '33333333-3333-4333-8333-333333333333'
const outputVariantId = '44444444-4444-4444-8444-444444444444'
const userId = '77777777-7777-4777-8777-777777777777'

const timestamp = '2026-10-08T13:00:00.000Z'

const otherVariantId = '55555555-5555-4555-8555-555555555555'

const crudOptions = jest.mocked(makeCrudRoute).mock.calls[0]?.[0]
const listConfig = crudOptions?.list
const afterList = crudOptions?.hooks?.afterList

if (!listConfig?.transformItem || !listConfig.buildFilters || !afterList) {
  throw new Error('[internal] Missing manufacturing BOM list configuration')
}

const transformItem = listConfig.transformItem
const buildFilters = listConfig.buildFilters

const em = { fork: jest.fn() }

const container = createContainer()

container.register({ em: asValue(em) })

const ctx: CrudCtx = {
  container,
  auth: null,
  organizationScope: null,
  selectedOrganizationId: null,
  organizationIds: null,
}

const draftRecord = {
  id: bomId,
  output_variant_id: outputVariantId,
  base_quantity: '1',
  revision: '2',
  status: 'draft',
  is_incomplete: false,
  released_at: null,
  released_by_user_id: null,
  created_at: timestamp,
  updated_at: timestamp,
}

beforeEach(() => {
  jest.mocked(resolveManufacturingApiScope).mockReset()
  jest.mocked(resolveManufacturingApiScope).mockResolvedValue(scope)
  jest.mocked(findBomOutputVariantIdsBySearch).mockReset()
  jest.mocked(decorateBomListItems).mockReset()
})

describe('BOM response', () => {
  it('returns false and null release fields for a draft', () => {
    expect(transformItem(draftRecord)).toMatchObject({
      id: bomId,
      status: 'draft',
      isIncomplete: false,
      releasedAt: null,
      releasedByUserId: null,
      updatedAt: timestamp,
    })
  })

  it('serializes the release timestamp and preserves incomplete=true', () => {
    expect(transformItem({
      ...draftRecord,
      status: 'released',
      is_incomplete: true,
      released_at: new Date(timestamp),
      released_by_user_id: userId,
    })).toMatchObject({
      status: 'released',
      isIncomplete: true,
      releasedAt: timestamp,
      releasedByUserId: userId,
    })
  })

  it('supports camelCase records and timestamps with offsets', () => {
    expect(transformItem({
      id: bomId,
      outputVariantId,
      baseQuantity: '1',
      revision: '2',
      status: 'released',
      isIncomplete: false,
      releasedAt: '2026-10-08T15:00:00+02:00',
      releasedByUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })).toMatchObject({
      isIncomplete: false,
      releasedAt: timestamp,
      releasedByUserId: userId,
    })
  })

  it('rejects an invalid release timestamp', () => {
    expect(() => transformItem({
      ...draftRecord,
      status: 'released',
      released_at: 'invalid-date',
    })).toThrow()
  })
})

describe('BOM list filters', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])(
    'applies isIncomplete=%s with tenant and organization scope',
    async (value, expected) => {
      const query = bomListQuerySchema.parse({
        isIncomplete: value,
      })

      await expect(buildFilters(query, ctx)).resolves.toEqual({
        tenant_id: { $eq: scope.tenantId },
        organization_id: { $eq: scope.organizationId },
        deleted_at: { $eq: null },
        is_incomplete: { $eq: expected },
      })
    },
  )

  it('does not exclude incomplete BOMs when filtering released revisions', async () => {
    const query = bomListQuerySchema.parse({
      status: 'released',
      outputVariantId,
    })

    await expect(buildFilters(query, ctx)).resolves.toEqual({
      tenant_id: { $eq: scope.tenantId },
      organization_id: { $eq: scope.organizationId },
      deleted_at: { $eq: null },
      output_variant_id: { $eq: outputVariantId },
      status: { $eq: 'released' },
    })
  })

  it('narrows the list to variants matching the search in the resolved scope', async () => {
    jest.mocked(findBomOutputVariantIdsBySearch).mockResolvedValue([
      outputVariantId,
      otherVariantId,
    ])

    const query = bomListQuerySchema.parse({ search: ' OUTPUT ' })

    await expect(buildFilters(query, ctx)).resolves.toEqual({
      tenant_id: { $eq: scope.tenantId },
      organization_id: { $eq: scope.organizationId },
      deleted_at: { $eq: null },
      output_variant_id: { $in: [outputVariantId, otherVariantId] },
    })

    expect(findBomOutputVariantIdsBySearch).toHaveBeenCalledWith(
      em,
      'OUTPUT',
      scope,
      undefined,
    )
  })

  it('returns no rows when the search matches no variants', async () => {
    jest.mocked(findBomOutputVariantIdsBySearch).mockResolvedValue([])

    const query = bomListQuerySchema.parse({ search: 'missing' })

    await expect(buildFilters(query, ctx)).resolves.toMatchObject({
      output_variant_id: { $eq: NO_MATCH_ID },
    })
  })

  it('passes an explicit outputVariantId to the search', async () => {
    jest.mocked(findBomOutputVariantIdsBySearch).mockResolvedValue([
      otherVariantId,
    ])

    await expect(buildFilters(bomListQuerySchema.parse({
      search: 'OUTPUT',
      outputVariantId: otherVariantId,
    }), ctx)).resolves.toMatchObject({
      output_variant_id: { $in: [otherVariantId] },
    })

    expect(findBomOutputVariantIdsBySearch).toHaveBeenCalledWith(
      em,
      'OUTPUT',
      scope,
      otherVariantId,
    )

    jest.mocked(findBomOutputVariantIdsBySearch).mockResolvedValue([])

    await expect(buildFilters(bomListQuerySchema.parse({
      search: 'OUTPUT',
      outputVariantId: otherVariantId,
    }), ctx)).resolves.toMatchObject({
      output_variant_id: { $eq: NO_MATCH_ID },
    })
  })

  it('does not query the catalog without a search term', async () => {
    await buildFilters(bomListQuerySchema.parse({}), ctx)

    expect(findBomOutputVariantIdsBySearch).not.toHaveBeenCalled()
  })
})

describe('BOM list decoration', () => {
  const query = bomListQuerySchema.parse({})

  it('decorates list items within the resolved scope', async () => {
    const items = [{ id: bomId }]

    await afterList({ items }, { ...ctx, query })

    expect(resolveManufacturingApiScope).toHaveBeenCalledWith(
      expect.objectContaining({ container }),
    )
    expect(decorateBomListItems).toHaveBeenCalledWith(em, items, scope)
  })

  it('skips decoration for an empty page', async () => {
    await afterList({ items: [] }, { ...ctx, query })

    expect(decorateBomListItems).not.toHaveBeenCalled()
    expect(resolveManufacturingApiScope).not.toHaveBeenCalled()
  })
})