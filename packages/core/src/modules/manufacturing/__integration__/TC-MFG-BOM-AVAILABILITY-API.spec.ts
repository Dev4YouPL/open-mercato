import { expect, test } from '@playwright/test'

import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withBomFixtures } from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = {
  dependsOnModules: ['manufacturing', 'catalog', 'wms', 'auth'],
}

test('withdraws and restores released BOM availability without changing revision contents', async ({ request }) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    await fixture.createItem(bomId, fixture.componentVariantId)
    expect((await fixture.release(bomId)).status()).toBe(200)
    const before = await fixture.readBom(bomId)
    expect(before.isAvailableForNewOrders).toBe(true)
    const itemsBefore = await fixture.readItems(bomId)

    const availableList = await fixture.call('GET', `/api/manufacturing/boms?outputVariantId=${fixture.outputVariantId}&availableForNewOrders=true`)
    expect(availableList.status()).toBe(200)
    expect((await readJsonSafe(availableList) as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(bomId)

    const withdrawnResponse = await fixture.setAvailability(bomId, false, before.updatedAt)
    expect(withdrawnResponse.status()).toBe(200)
    expect(withdrawnResponse.headers()['x-om-operation']).toBeUndefined()
    expect(await readJsonSafe(withdrawnResponse)).toMatchObject({ id: bomId, isAvailableForNewOrders: false })

    const withdrawn = await fixture.readBom(bomId)
    expect(withdrawn).toMatchObject({ status: 'released', isAvailableForNewOrders: false, releasedAt: before.releasedAt })
    expect(await fixture.readItems(bomId)).toEqual(itemsBefore)
    const withdrawnList = await fixture.call('GET', `/api/manufacturing/boms?id=${bomId}&availableForNewOrders=false`)
    expect(withdrawnList.status()).toBe(200)
    expect((await readJsonSafe(withdrawnList) as { items: unknown[] }).items).toHaveLength(1)

    const noOp = await fixture.setAvailability(bomId, false, withdrawn.updatedAt)
    expect(noOp.status()).toBe(200)
    expect((await fixture.readBom(bomId)).updatedAt).toBe(withdrawn.updatedAt)

    const stale = await fixture.setAvailability(bomId, true, before.updatedAt)
    expect(stale.status()).toBe(409)
    const restored = await fixture.readBom(bomId)
    expect((await fixture.setAvailability(bomId, true, restored.updatedAt)).status()).toBe(200)
    expect((await fixture.readBom(bomId)).isAvailableForNewOrders).toBe(true)

    const draftId = await fixture.createBom()
    const draft = await fixture.readBom(draftId)
    const rejected = await fixture.setAvailability(draftId, false, draft.updatedAt)
    expect(rejected.status()).toBe(409)
    expect(await readJsonSafe(rejected)).toMatchObject({ code: 'manufacturing.bom_availability.not_released' })

    const foreignBomId = await fixture.createForeignOrganizationBom(fixture.outputName)
    const foreign = await fixture.setAvailability(foreignBomId, false, draft.updatedAt)
    expect(foreign.status()).toBe(404)
  })
})

test('requires manufacturing.manage to change BOM availability', async ({ request }) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    await fixture.createItem(bomId, fixture.componentVariantId)
    expect((await fixture.release(bomId)).status()).toBe(200)
    const user = await fixture.createViewer(['manufacturing.view'])

    await withCredentialIsolatedRequest(async (userRequest) => {
      const token = await getAuthToken(userRequest, user.email, user.password)
      const bom = await fixture.readBom(bomId)
      const response = await apiRequest(userRequest, 'POST', '/api/manufacturing/boms/availability', {
        token,
        data: { id: bomId, isAvailableForNewOrders: false },
        headers: {
          'x-om-ext-optimistic-lock-expected-updated-at': bom.updatedAt,
          Cookie: `om_selected_org=${fixture.organizationId}`,
        },
      })
      expect(response.status()).toBe(403)
    })
  })
})
