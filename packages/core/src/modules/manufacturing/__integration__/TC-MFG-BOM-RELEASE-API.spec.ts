import { expect, test } from '@playwright/test'

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

test('releases a BOM and rejects subsequent mutations', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()

    await fixture.createItem(
      bomId,
      fixture.componentVariantId,
    )

    await fixture.createItem(
      bomId,
      fixture.alternateVariantId,
      2,
    )

    const response = await fixture.release(bomId)

    expect(response.status()).toBe(200)
    expect(await readJsonSafe(response)).toMatchObject({
      id: bomId,
      status: 'released',
      isIncomplete: false,
    })

    const released = await fixture.readBom(bomId)
    const originalItems = await fixture.readItems(bomId)
    const firstItem = originalItems[0]

    expect(firstItem).toBeDefined()
    expect(released.status).toBe('released')
    expect(released.releasedAt).not.toBeNull()
    expect(released.releasedByUserId).not.toBeNull()

    const mutations = [
      {
        method: 'PUT',
        path: '/api/manufacturing/boms',
        data: { id: bomId, baseQuantity: '2' },
        version: released.updatedAt,
      },
      {
        method: 'PUT',
        path: '/api/manufacturing/boms',
        data: {
          id: bomId,
          outputVariantId: fixture.alternateVariantId,
        },
        version: released.updatedAt,
      },
      {
        method: 'DELETE',
        path: '/api/manufacturing/boms',
        data: { id: bomId },
        version: released.updatedAt,
      },
      {
        method: 'POST',
        path: '/api/manufacturing/bom-items',
        data: {
          bomId,
          componentVariantId: fixture.componentVariantId,
          quantity: '3',
          position: 3,
        },
        version: released.updatedAt,
      },
      {
        method: 'PUT',
        path: '/api/manufacturing/bom-items',
        data: {
          id: firstItem.id,
          bomId,
          quantity: '3',
        },
        version: firstItem.updatedAt,
      },
      {
        method: 'DELETE',
        path: '/api/manufacturing/bom-items',
        data: {
          id: firstItem.id,
          bomId,
        },
        version: firstItem.updatedAt,
      },
    ]

    for (const mutation of mutations) {
      const rejected = await fixture.call(
        mutation.method,
        mutation.path,
        mutation.data,
        mutation.version,
      )

      expect(
        rejected.status(),
        `${mutation.method} ${mutation.path}`,
      ).toBe(409)
    }

    const repeatedRelease = await fixture.release(bomId)
    expect(repeatedRelease.status()).toBe(409)

    const statusUpdate = await fixture.call(
      'PUT',
      '/api/manufacturing/boms',
      { id: bomId, status: 'draft' },
      released.updatedAt,
    )

    expect(statusUpdate.status()).toBe(400)
    expect(await fixture.readBom(bomId)).toEqual(released)
    expect(await fixture.readItems(bomId)).toEqual(originalItems)
  })
})

test('does not reuse the revision of a deleted BOM', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const firstId = await fixture.createBom()
    const secondId = await fixture.createBom()

    expect((await fixture.readBom(firstId)).revision).toBe('1')

    const second = await fixture.readBom(secondId)
    expect(second.revision).toBe('2')

    const removed = await fixture.call(
      'DELETE',
      '/api/manufacturing/boms',
      { id: secondId },
      second.updatedAt,
    )

    expect(removed.ok()).toBe(true)

    const thirdId = await fixture.createBom()
    expect((await fixture.readBom(thirdId)).revision).toBe('3')
  })
})

test('releases an empty BOM and supports incomplete filters', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    const response = await fixture.release(bomId, [])

    expect(response.status()).toBe(200)
    expect(await readJsonSafe(response)).toMatchObject({
      id: bomId,
      status: 'released',
      isIncomplete: true,
    })

    expect(await fixture.readBom(bomId)).toMatchObject({
      status: 'released',
      isIncomplete: true,
    })

    for (const isIncomplete of [true, false]) {
      const params = new URLSearchParams({
        outputVariantId: fixture.outputVariantId,
        status: 'released',
        isIncomplete: String(isIncomplete),
      })

      const listed = await fixture.call(
        'GET',
        `/api/manufacturing/boms?${params}`,
      )

      expect(listed.ok()).toBe(true)

      const body = await readJsonSafe<{
        items: Array<{ id: string }>
      }>(listed)

      expect(body?.items).toEqual(
        isIncomplete
          ? [expect.objectContaining({ id: bomId })]
          : [],
      )
    }
  })
})

for (const change of ['add', 'delete', 'update'] as const) {
  test(`rejects an outdated item snapshot after ${change}`, async ({
    request,
  }) => {
    await withBomFixtures(request, async (fixture) => {
      const bomId = await fixture.createBom()

      await fixture.createItem(
        bomId,
        fixture.componentVariantId,
      )

      const items = await fixture.readItems(bomId)
      const originalItem = items[0]

      expect(originalItem).toBeDefined()

      const expectedItems = items.map(({ id, updatedAt }) => ({
        id,
        updatedAt,
      }))

      if (change === 'add') {
        await fixture.createItem(
          bomId,
          fixture.alternateVariantId,
          2,
        )
      } else {
        const changed = await fixture.call(
          change === 'delete' ? 'DELETE' : 'PUT',
          '/api/manufacturing/bom-items',
          {
            id: originalItem.id,
            bomId,
            ...(change === 'update' ? { quantity: '2' } : {}),
          },
          originalItem.updatedAt,
        )

        expect(changed.ok()).toBe(true)
      }

      const itemsBeforeRelease = await fixture.readItems(bomId)
      const response = await fixture.release(
        bomId,
        expectedItems,
      )

      expect(response.status()).toBe(409)
      expect(await readJsonSafe(response)).toMatchObject({
        code: 'manufacturing.bom_release.items_changed',
      })

      expect(await fixture.readBom(bomId)).toMatchObject({
        status: 'draft',
        isIncomplete: false,
        releasedAt: null,
        releasedByUserId: null,
      })

      expect(await fixture.readItems(bomId)).toEqual(
        itemsBeforeRelease,
      )
    })
  })
}

const trackingCases = [
  {
    role: 'component',
    requirement: 'lot',
  },
  {
    role: 'output',
    requirement: 'serial',
  },
  {
    role: 'component',
    requirement: 'expiration',
  },
] as const

for (const scenario of trackingCases) {
  test(`blocks ${scenario.role} requiring ${scenario.requirement}`, async ({
    request,
  }) => {
    await withBomFixtures(request, async (fixture) => {
      const bomId = await fixture.createBom()

      await fixture.createItem(
        bomId,
        fixture.componentVariantId,
      )

      const variantId = scenario.role === 'output'
        ? fixture.outputVariantId
        : fixture.componentVariantId

      await fixture.createProfile(
        variantId,
        [scenario.requirement],
      )

      const before = await fixture.readBom(bomId)
      const response = await fixture.release(bomId)

      expect(response.status()).toBe(422)
      expect(await readJsonSafe(response)).toMatchObject({
        code: 'manufacturing.bom_release.tracking_required',
        violations: [
          expect.objectContaining({
            variantId,
            role: scenario.role,
            requirements: [scenario.requirement],
          }),
        ],
      })

      expect(await fixture.readBom(bomId)).toEqual(before)
    })
  })
}

test('ignores tracking configured only on the product', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()

    await fixture.createItem(
      bomId,
      fixture.componentVariantId,
    )

    await fixture.createProfile(null, ['expiration'])

    const response = await fixture.release(bomId)

    expect(response.status()).toBe(200)
    expect(await fixture.readBom(bomId)).toMatchObject({
      status: 'released',
      isIncomplete: false,
    })
  })
})

test('rejects a user without manufacturing.manage', async ({
  request,
}) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    const viewer = await fixture.createViewer()

    await withCredentialIsolatedRequest(
      async (viewerRequest) => {
        const viewerToken = await getAuthToken(
          viewerRequest,
          viewer.email,
          viewer.password,
        )

        const response = await apiRequest(
          viewerRequest,
          'POST',
          '/api/manufacturing/boms/release',
          {
            token: viewerToken,
            retryTransport: false,
            data: {
              id: bomId,
              expectedItems: [],
            },
          },
        )

        expect(response.status()).toBe(403)
      },
    )

    expect((await fixture.readBom(bomId)).status).toBe('draft')
  })
})
