import { expect, test } from '@playwright/test'
import { z } from 'zod'

import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  withBomFixtures,
} from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = {
  dependsOnModules: [
    'manufacturing',
    'catalog',
    'wms',
    'auth',
  ],
}

const uuidSchema = z.string().uuid()

const listItemSchema = z.object({
  id: uuidSchema,
  outputVariantId: uuidSchema,
  status: z.enum(['draft', 'released']),
  isIncomplete: z.boolean(),
  isAvailableForNewOrders: z.boolean(),
  outputVariant: z.object({
    id: uuidSchema,
    name: z.string().nullable(),
    sku: z.string().nullable(),
    isActive: z.boolean(),
    isDeleted: z.boolean(),
  }).nullable(),
  availability: z.object({
    isAvailable: z.boolean(),
    reason: z.enum(['draft', 'withdrawn', 'variantMissing', 'variantInactive']).nullable(),
  }),
})

const listSchema = z.object({
  items: z.array(listItemSchema),
  total: z.number().int().nonnegative(),
})

type BomListFixture = Parameters<
  Parameters<typeof withBomFixtures>[1]
>[0]

async function listBoms(
  fixture: BomListFixture,
  params: Record<string, string>,
) {
  const query = new URLSearchParams({ pageSize: '100', ...params })
  const response = await fixture.call(
    'GET',
    `/api/manufacturing/boms?${query.toString()}`,
  )

  expect(response.status(), `GET BOM list: ${response.status()}`).toBe(200)

  return listSchema.parse(await readJsonSafe(response))
}

test('searches BOMs by output variant name and SKU', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const draftBomId = await fixture.createBom()
    const releasedBomId = await fixture.createBom(fixture.alternateVariantId)

    await fixture.createItem(releasedBomId, fixture.componentVariantId)

    const releaseResponse = await fixture.release(releasedBomId)

    expect(releaseResponse.status()).toBe(200)

    const byName = await listBoms(fixture, { search: fixture.outputName })

    expect(byName.items.map((item) => item.id)).toEqual([draftBomId])

    const bySku = await listBoms(fixture, { search: fixture.outputSku })

    expect(bySku.items.map((item) => item.id)).toEqual([draftBomId])

    const noMatch = await listBoms(fixture, {
      search: `missing-${fixture.outputSku}`,
    })

    expect(noMatch.items).toHaveLength(0)
    expect(noMatch.total).toBe(0)

    const releasedOnly = await listBoms(fixture, {
      search: fixture.alternateName,
      outputVariantId: fixture.alternateVariantId,
      status: 'released',
    })

    expect(releasedOnly.items.map((item) => item.id)).toEqual([releasedBomId])
  })
})

test('decorates BOMs with the output variant and availability', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const draftBomId = await fixture.createBom()
    const releasedBomId = await fixture.createBom(fixture.alternateVariantId)

    await fixture.createItem(releasedBomId, fixture.componentVariantId)
    expect((await fixture.release(releasedBomId)).status()).toBe(200)

    const draft = (await listBoms(fixture, { id: draftBomId })).items[0]

    expect(draft).toMatchObject({
      outputVariant: {
        id: fixture.outputVariantId,
        name: fixture.outputName,
        sku: fixture.outputSku,
        isActive: true,
        isDeleted: false,
      },
      availability: { isAvailable: false, reason: 'draft' },
    })

    const released = (await listBoms(fixture, { id: releasedBomId })).items[0]

    expect(released).toMatchObject({
      status: 'released',
      outputVariant: { id: fixture.alternateVariantId },
      availability: { isAvailable: true, reason: null },
    })

    await fixture.setVariantActive(fixture.alternateVariantId, false)

    const inactive = (await listBoms(fixture, { id: releasedBomId })).items[0]

    expect(inactive).toMatchObject({
      outputVariant: { isActive: false },
      availability: { isAvailable: false, reason: 'variantInactive' },
    })
  })
})

test('hides BOMs from another organization, also when variant names match', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const ownBomId = await fixture.createBom()
    const foreignBomId = await fixture.createForeignOrganizationBom(
      fixture.outputName,
    )

    const searched = await listBoms(fixture, { search: fixture.outputName })

    expect(searched.items.map((item) => item.id)).toEqual([ownBomId])

    const byId = await listBoms(fixture, { id: foreignBomId })

    expect(byId.items).toHaveLength(0)
  })
})

test('rejects the BOM list without manufacturing.view', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const user = await fixture.createViewer([])

    await withCredentialIsolatedRequest(async (userRequest) => {
      const userToken = await getAuthToken(
        userRequest,
        user.email,
        user.password,
      )

      const response = await apiRequest(
        userRequest,
        'GET',
        `/api/manufacturing/boms?search=${encodeURIComponent(fixture.outputName)}`,
        {
          token: userToken,
          retryTransport: false,
        },
      )

      expect(response.status()).toBe(403)
    })
  })
})
