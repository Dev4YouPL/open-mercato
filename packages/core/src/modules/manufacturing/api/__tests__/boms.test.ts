import { createContainer } from 'awilix'

import {
  makeCrudRoute,
} from '@open-mercato/shared/lib/crud/factory'
import type {
  CrudCtx,
} from '@open-mercato/shared/lib/crud/factory'

import { bomListQuerySchema } from '../../data/validators'
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

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const bomId = '33333333-3333-4333-8333-333333333333'
const outputVariantId = '44444444-4444-4444-8444-444444444444'
const userId = '77777777-7777-4777-8777-777777777777'

const timestamp = '2026-10-08T13:00:00.000Z'

const listConfig = jest.mocked(makeCrudRoute).mock.calls[0]?.[0].list

if (!listConfig?.transformItem || !listConfig.buildFilters) {
  throw new Error('[internal] Missing manufacturing BOM list configuration')
}

const transformItem = listConfig.transformItem
const buildFilters = listConfig.buildFilters

const ctx: CrudCtx = {
  container: createContainer(),
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
})