import { asValue, createContainer } from 'awilix'

import { E } from '#generated/entities.ids.generated'

import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

import {
  loadEffectiveTrackingPolicies,
  resolveEffectiveTrackingPolicy,
} from '../wmsTrackingPolicy'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    wms: {
      product_inventory_profile: 'wms:product_inventory_profile',
    },
  },
}))

const entityRegistry = E as unknown as {
  wms?: {
    product_inventory_profile?: string
  }
}

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const firstVariantId = '33333333-3333-4333-8333-333333333333'
const secondVariantId = '44444444-4444-4444-8444-444444444444'

const query = jest.fn()

function createTestContainer() {
  const container = createContainer()
  const queryEngine: QueryEngine = { query }

  container.register({
    queryEngine: asValue(queryEngine),
  })

  return container
}

function createProfile(
  variantId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: variantId,
    catalog_variant_id: variantId,
    track_lot: false,
    track_serial: false,
    track_expiration: false,
    ...overrides,
  }
}

function createQueryResult(items: Record<string, unknown>[]) {
  return {
    items,
    page: 1,
    pageSize: items.length,
    total: items.length,
  }
}

beforeEach(() => {
  query.mockReset()

  entityRegistry.wms = {
    product_inventory_profile: 'wms:product_inventory_profile',
  }
})

describe('resolveEffectiveTrackingPolicy', () => {
  it('returns no requirements when the profile is absent', () => {
    expect(resolveEffectiveTrackingPolicy(null)).toEqual({
      requiresLot: false,
      requiresSerial: false,
      requiresExpiration: false,
    })
  })

  it('maps each profile flag to its requirement', () => {
    expect(resolveEffectiveTrackingPolicy({
      trackLot: true,
      trackSerial: false,
      trackExpiration: true,
    })).toEqual({
      requiresLot: true,
      requiresSerial: false,
      requiresExpiration: true,
    })
  })

  it.each([
    {
      name: 'lot tracking only',
      profile: {
        trackLot: true,
        trackSerial: false,
        trackExpiration: false,
      },
      expected: {
        requiresLot: true,
        requiresSerial: false,
        requiresExpiration: false,
      },
    },
    {
      name: 'serial tracking only',
      profile: {
        trackLot: false,
        trackSerial: true,
        trackExpiration: false,
      },
      expected: {
        requiresLot: false,
        requiresSerial: true,
        requiresExpiration: false,
      },
    },
    {
      name: 'expiration tracking only',
      profile: {
        trackLot: false,
        trackSerial: false,
        trackExpiration: true,
      },
      expected: {
        requiresLot: false,
        requiresSerial: false,
        requiresExpiration: true,
      },
    },
    {
      name: 'all tracking requirements',
      profile: {
        trackLot: true,
        trackSerial: true,
        trackExpiration: true,
      },
      expected: {
        requiresLot: true,
        requiresSerial: true,
        requiresExpiration: true,
      },
    },
  ])('resolves $name', ({ profile, expected }) => {
    expect(resolveEffectiveTrackingPolicy(profile)).toEqual(expected)
  })
})

describe('loadEffectiveTrackingPolicies', () => {
  it('returns an empty map when WMS is disabled', async () => {
    entityRegistry.wms = undefined

    const container = createContainer()

    await expect(
      loadEffectiveTrackingPolicies(
        container,
        [firstVariantId],
        scope,
      ),
    ).resolves.toEqual(new Map())

    expect(query).not.toHaveBeenCalled()
  })

  it('does not query when the variant list is empty', async () => {
    await expect(
      loadEffectiveTrackingPolicies(
        createTestContainer(),
        [],
        scope,
      ),
    ).resolves.toEqual(new Map())

    expect(query).not.toHaveBeenCalled()
  })

  it('deduplicates IDs and scopes the profile query', async () => {
    query.mockResolvedValue(createQueryResult([]))

    await loadEffectiveTrackingPolicies(
      createTestContainer(),
      [firstVariantId, secondVariantId, firstVariantId],
      scope,
    )

    expect(query).toHaveBeenCalledTimes(1)

    expect(query).toHaveBeenCalledWith(
      'wms:product_inventory_profile',
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        filters: {
          deleted_at: { $eq: null },
          catalog_variant_id: {
            $in: [firstVariantId, secondVariantId],
          },
        },
        fields: [
          'id',
          'catalog_variant_id',
          'track_lot',
          'track_serial',
          'track_expiration',
        ],
        page: {
          page: 1,
          pageSize: 2,
        },
      },
    )
  })

  it('normalizes boolean, string and numeric flags', async () => {
    query.mockResolvedValue(createQueryResult([
      createProfile(firstVariantId, {
        track_lot: true,
        track_serial: 'false',
        track_expiration: 1,
      }),
      createProfile(secondVariantId, {
        track_lot: 'yes',
        track_serial: 0,
        track_expiration: null,
      }),
    ]))

    const policies = await loadEffectiveTrackingPolicies(
      createTestContainer(),
      [firstVariantId, secondVariantId],
      scope,
    )

    expect(policies.get(firstVariantId)).toEqual({
      requiresLot: true,
      requiresSerial: false,
      requiresExpiration: true,
    })

    expect(policies.get(secondVariantId)).toEqual({
      requiresLot: true,
      requiresSerial: false,
      requiresExpiration: false,
    })
  })

  it('ignores product profiles and leaves missing profiles absent', async () => {
    query.mockResolvedValue(createQueryResult([
      createProfile(firstVariantId, {
        catalog_variant_id: null,
        track_lot: true,
        track_serial: true,
        track_expiration: true,
      }),
    ]))

    const policies = await loadEffectiveTrackingPolicies(
      createTestContainer(),
      [firstVariantId],
      scope,
    )

    expect(policies.size).toBe(0)
  })

  it('loads profiles beyond the first 100 variants', async () => {
    const variantIds = Array.from(
      { length: 101 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    )

    query
      .mockResolvedValueOnce(createQueryResult(
        variantIds.slice(0, 100).map((variantId) =>
          createProfile(variantId),
        ),
      ))
      .mockResolvedValueOnce(createQueryResult([
        createProfile(variantIds[100], {
          track_serial: true,
        }),
      ]))

    const policies = await loadEffectiveTrackingPolicies(
      createTestContainer(),
      variantIds,
      scope,
    )

    expect(query).toHaveBeenCalledTimes(2)
    expect(policies.size).toBe(101)

    expect(policies.get(variantIds[100])).toEqual({
      requiresLot: false,
      requiresSerial: true,
      requiresExpiration: false,
    })
  })

  it('propagates read failures instead of allowing release', async () => {
    const error = new Error('[internal] WMS profile read failed')

    query.mockRejectedValue(error)

    await expect(
      loadEffectiveTrackingPolicies(
        createTestContainer(),
        [firstVariantId],
        scope,
      ),
    ).rejects.toBe(error)
  })

  it('rejects malformed profile rows', async () => {
    query.mockResolvedValue(createQueryResult([
      createProfile(firstVariantId, {
        track_lot: { invalid: true },
      }),
    ]))

    await expect(
      loadEffectiveTrackingPolicies(
        createTestContainer(),
        [firstVariantId],
        scope,
      ),
    ).rejects.toThrow()
  })
})