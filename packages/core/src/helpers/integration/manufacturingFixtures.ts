import { randomUUID } from 'node:crypto'
import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'
import { z } from 'zod'

import { apiRequest, getAuthToken } from './api'
import {
  createProductFixture,
  createVariantFixture,
} from './catalogFixtures'
import {
  createUserFixture,
  setUserAclVisibility,
} from './authFixtures'
import {
  getTokenContext,
  readJsonSafe,
} from './generalFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
  withClient,
} from './dbFixtures'

const uuidSchema = z.string().uuid()

const bomSchema = z.object({
  id: uuidSchema,
  outputVariantId: uuidSchema,
  baseQuantity: z.string(),
  revision: z.string(),
  status: z.enum(['draft', 'released']),
  isIncomplete: z.boolean(),
  releasedAt: z.string().nullable(),
  releasedByUserId: uuidSchema.nullable(),
  updatedAt: z.string().datetime({ offset: true }),
})

const itemSchema = z.object({
  id: uuidSchema,
  bomId: uuidSchema,
  componentVariantId: uuidSchema,
  quantity: z.string(),
  position: z.number(),
  updatedAt: z.string().datetime({ offset: true }),
})

type BomState = z.infer<typeof bomSchema>
type ItemState = z.infer<typeof itemSchema>

type ExpectedItem = Pick<ItemState, 'id' | 'updatedAt'>
type TrackingRequirement = 'lot' | 'serial' | 'expiration'

type BomFixtures = {
  productId: string
  outputVariantId: string
  componentVariantId: string
  alternateVariantId: string
  outputName: string
  outputSku: string
  componentName: string
  alternateName: string
  call: (
    method: string,
    path: string,
    data?: unknown,
    updatedAt?: string,
  ) => Promise<APIResponse>
  createBom: (outputVariantId?: string) => Promise<string>
  createItem: (
    bomId: string,
    variantId: string,
    position?: number,
  ) => Promise<string>
  readBom: (bomId: string) => Promise<BomState>
  readItems: (bomId: string) => Promise<ItemState[]>
  release: (
    bomId: string,
    expectedItems?: readonly ExpectedItem[],
  ) => Promise<APIResponse>
  createProfile: (
    variantId: string | null,
    requirements: readonly TrackingRequirement[],
  ) => Promise<string>
  createViewer: (features?: readonly string[]) => Promise<{
    email: string
    password: string
  }>
  setVariantActive: (
    variantId: string,
    isActive: boolean,
  ) => Promise<void>
  createForeignOrganizationBom: (
    variantName: string,
  ) => Promise<string>
}

export async function withBomFixtures(
  request: APIRequestContext,
  run: (fixture: BomFixtures) => Promise<void>,
): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      '[internal] Run BOM integration tests through the ephemeral runner',
    )
  }

  const token = await getAuthToken(request, 'admin')
  const scope = getTokenContext(token)

  uuidSchema.parse(scope.tenantId)
  uuidSchema.parse(scope.organizationId)

  const tag = randomUUID()
  const outputName = `BOM output ${tag}`
  const outputSku = `MFG-O-${tag}`
  const componentName = `BOM component ${tag}`
  const alternateName = `BOM alternate ${tag}`

  const bomIds: string[] = []
  const profileIds: string[] = []
  const userIds: string[] = []
  const foreignCleanupTasks: Array<() => Promise<void>> = []

  let productId: string | null = null

  async function call(
    method: string,
    path: string,
    data?: unknown,
    updatedAt?: string,
  ): Promise<APIResponse> {
    return apiRequest(request, method, path, {
      token,
      data,
      retryTransport: false,
      headers: {
        Cookie: [
          `om_selected_org=${scope.organizationId}`,
          `om_selected_tenant=${scope.tenantId}`,
        ].join('; '),
        ...(updatedAt
          ? {
              'x-om-ext-optimistic-lock-expected-updated-at':
                updatedAt,
            }
          : {}),
      },
    })
  }

  async function create(
    path: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const response = await call('POST', path, data)

    expect(
      response.ok(),
      `POST ${path}: ${response.status()}`,
    ).toBe(true)

    const body = await readJsonSafe(response)

    return z.object({ id: uuidSchema }).parse(body).id
  }

  async function readBom(bomId: string): Promise<BomState> {
    const response = await call(
      'GET',
      `/api/manufacturing/boms?id=${bomId}&pageSize=1`,
    )

    expect(response.ok()).toBe(true)

    const body = z.object({
      items: z.array(bomSchema),
    }).parse(await readJsonSafe(response))

    expect(body.items).toHaveLength(1)

    return bomSchema.parse(body.items[0])
  }

  async function readItems(
    bomId: string,
  ): Promise<ItemState[]> {
    const items: ItemState[] = []
    let page = 1
    let totalPages = 1

    do {
      const params = new URLSearchParams({
        bomId,
        page: String(page),
        pageSize: '100',
        sortField: 'id',
        sortDir: 'asc',
      })

      const response = await call(
        'GET',
        `/api/manufacturing/bom-items?${params}`,
      )

      expect(response.ok()).toBe(true)

      const body = z.object({
        items: z.array(itemSchema),
        totalPages: z.number().int().nonnegative(),
      }).parse(await readJsonSafe(response))

      items.push(...body.items)
      totalPages = body.totalPages
      page += 1
    } while (page <= totalPages)

    return items
  }

  async function deleteCreatedRecord(
    path: string,
    id: string,
  ): Promise<void> {
    const response = await call(
      'DELETE',
      `${path}?id=${encodeURIComponent(id)}`,
    )

    expect(
      response.ok() || response.status() === 404,
      `Cleanup ${path}: ${response.status()}`,
    ).toBe(true)
  }

  async function cleanupBoms(): Promise<void> {
    await deleteBomRecords(bomIds, scope.organizationId)
  }

  async function deleteBomRecords(
    ids: readonly string[],
    organizationId: string,
  ): Promise<void> {
    if (ids.length === 0) return

    await withClient(async (client) => {
      await client.query('begin')

      try {
        const parameters = [
          ids,
          scope.tenantId,
          organizationId,
        ]

        const items = await client.query<{ id: string }>(
          `select id
           from manufacturing_bom_items
           where bom_id = any($1::uuid[])
             and tenant_id = $2
             and organization_id = $3`,
          parameters,
        )

        const recordIds = [
          ...ids,
          ...items.rows.map((item) => item.id),
        ]

        await client.query(
          `delete from entity_indexes
           where entity_type like 'manufacturing:%'
             and entity_id = any($1::text[])
             and tenant_id = $2
             and organization_id = $3`,
          [
            recordIds,
            scope.tenantId,
            organizationId,
          ],
        )

        await client.query(
          `delete from manufacturing_bom_items
           where bom_id = any($1::uuid[])
             and tenant_id = $2
             and organization_id = $3`,
          parameters,
        )

        await client.query(
          `delete from manufacturing_boms
           where id = any($1::uuid[])
             and tenant_id = $2
             and organization_id = $3`,
          parameters,
        )

        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    })
  }

  try {
    productId = await createProductFixture(request, token, {
      title: `BOM integration ${tag}`,
      sku: `MFG-P-${tag}`,
    })

    await withClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `select id from catalog_products
         where id = $1
           and tenant_id = $2
           and organization_id = $3`,
        [
          productId,
          scope.tenantId,
          scope.organizationId,
        ],
      )

      expect(
        result.rows,
        'The API and DB fixtures must use the same test database',
      ).toHaveLength(1)
    })

    const outputVariantId = await createVariantFixture(
      request,
      token,
      {
        productId,
        name: outputName,
        sku: outputSku,
      },
    )

    const componentVariantId = await createVariantFixture(
      request,
      token,
      {
        productId,
        name: componentName,
        sku: `MFG-C-${tag}`,
      },
    )

    const alternateVariantId = await createVariantFixture(
      request,
      token,
      {
        productId,
        name: alternateName,
        sku: `MFG-A-${tag}`,
      },
    )

    const fixture: BomFixtures = {
      productId,
      outputVariantId,
      componentVariantId,
      alternateVariantId,
      outputName,
      outputSku,
      componentName,
      alternateName,
      call,
      readBom,
      readItems,

      async createBom(bomOutputVariantId = outputVariantId) {
        const id = await create(
          '/api/manufacturing/boms',
          {
            outputVariantId: bomOutputVariantId,
            baseQuantity: '1',
          },
        )

        bomIds.push(id)
        return id
      },

      async createItem(bomId, variantId, position = 1) {
        return create('/api/manufacturing/bom-items', {
          bomId,
          componentVariantId: variantId,
          quantity: '1',
          position,
        })
      },

      async release(bomId, expectedItems) {
        const bom = await readBom(bomId)
        const snapshot = expectedItems ?? (
          await readItems(bomId)
        ).map(({ id, updatedAt }) => ({
          id,
          updatedAt,
        }))

        return call(
          'POST',
          '/api/manufacturing/boms/release',
          {
            id: bomId,
            expectedItems: snapshot,
          },
          bom.updatedAt,
        )
      },

      async createProfile(variantId, requirements) {
        const id = await create(
          '/api/wms/inventory-profiles',
          {
            ...scope,
            catalogProductId: productId,
            catalogVariantId: variantId,
            defaultUom: 'szt',
            defaultStrategy: requirements.includes('expiration')
              ? 'fefo'
              : 'fifo',
            trackLot: requirements.includes('lot'),
            trackSerial: requirements.includes('serial'),
            trackExpiration: requirements.includes('expiration'),
          },
        )

        profileIds.push(id)
        return id
      },

      async createViewer(features = ['manufacturing.view']) {
        const email = `bom-viewer-${randomUUID()}@example.com`
        const password = `${randomUUID()}Aa1!`

        const userId = await createUserFixture(
          request,
          token,
          {
            email,
            password,
            organizationId: scope.organizationId,
            roles: [],
          },
        )

        userIds.push(userId)

        const response = await call(
          'PUT',
          '/api/auth/users/acl',
          {
            userId,
            tenantId: scope.tenantId,
            isSuperAdmin: false,
            features: [...features],
            organizations: [scope.organizationId],
          },
        )

        expect(response.ok()).toBe(true)

        return { email, password }
      },

      async setVariantActive(variantId, isActive) {
        await withClient(async (client) => {
          const result = await client.query(
            `update catalog_product_variants
             set is_active = $1, updated_at = now()
             where id = $2
               and tenant_id = $3
               and organization_id = $4`,
            [
              isActive,
              variantId,
              scope.tenantId,
              scope.organizationId,
            ],
          )

          expect(result.rowCount).toBe(1)
        })
      },

      async createForeignOrganizationBom(variantName) {
        const foreignTag = randomUUID()
        const email = `bom-foreign-${foreignTag}@example.com`
        const password = `${foreignTag}Aa1!`

        const organizationId = await createOrganizationInDb({
          name: `BOM foreign org ${foreignTag}`,
          tenantId: scope.tenantId,
        })

        foreignCleanupTasks.push(() => (
          deleteOrganizationInDb(organizationId)
        ))

        const userId = await createUserFixture(request, token, {
          email,
          password,
          organizationId,
          roles: [],
        })

        foreignCleanupTasks.unshift(
          () => deleteCreatedRecord('/api/auth/users', userId),
          () => deleteUserAclInDb(userId),
        )

        await setUserAclVisibility(request, token, {
          userId,
          organizations: [organizationId],
          features: [
            'manufacturing.view',
            'manufacturing.manage',
            'catalog.products.view',
            'catalog.products.manage',
          ],
        })

        const foreignToken = await getAuthToken(request, email, password)

        expect(getTokenContext(foreignToken).organizationId).toBe(
          organizationId,
        )

        const foreignProductId = await createProductFixture(
          request,
          foreignToken,
          {
            title: `BOM foreign ${foreignTag}`,
            sku: `MFG-FP-${foreignTag}`,
          },
        )

        foreignCleanupTasks.unshift(async () => {
          const response = await apiRequest(
            request,
            'DELETE',
            `/api/catalog/products?id=${foreignProductId}`,
            { token: foreignToken, retryTransport: false },
          )

          expect(
            response.ok() || response.status() === 404,
            `Cleanup foreign product: ${response.status()}`,
          ).toBe(true)
        })

        const foreignVariantId = await createVariantFixture(
          request,
          foreignToken,
          {
            productId: foreignProductId,
            name: variantName,
            sku: `MFG-FO-${foreignTag}`,
          },
        )

        const response = await apiRequest(
          request,
          'POST',
          '/api/manufacturing/boms',
          {
            token: foreignToken,
            retryTransport: false,
            data: {
              outputVariantId: foreignVariantId,
              baseQuantity: '1',
            },
          },
        )

        expect(
          response.ok(),
          `POST foreign BOM: ${response.status()}`,
        ).toBe(true)

        const bomId = z.object({ id: uuidSchema }).parse(
          await readJsonSafe(response),
        ).id

        foreignCleanupTasks.unshift(() => (
          deleteBomRecords([bomId], organizationId)
        ))

        return bomId
      },
    }

    await run(fixture)
  } finally {
    const cleanupTasks: Array<() => Promise<void>> = [
      cleanupBoms,
      ...foreignCleanupTasks,
      ...profileIds.map((id) => (
        () => deleteCreatedRecord(
          '/api/wms/inventory-profiles',
          id,
        )
      )),
      ...userIds.map((id) => (
        () => deleteCreatedRecord('/api/auth/users', id)
      )),
    ]

    if (productId) {
      const createdProductId = productId

      cleanupTasks.push(() => deleteCreatedRecord(
        '/api/catalog/products',
        createdProductId,
      ))
    }

    const errors: unknown[] = []

    for (const cleanup of cleanupTasks) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        '[internal] BOM integration cleanup failed',
      )
    }
  }
}