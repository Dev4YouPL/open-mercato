import { expect, test } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withBomFixtures } from '@open-mercato/core/helpers/integration/manufacturingFixtures'

export const integrationMeta = { dependsOnModules: ['manufacturing', 'catalog', 'wms', 'auth'] }

test('previews and deletes an unused BOM family with its revisions and items', async ({ request }) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    await fixture.createItem(bomId, fixture.componentVariantId)
    const previewResponse = await fixture.call('GET', `/api/manufacturing/boms/deletion-preview?id=${bomId}`)
    expect(previewResponse.status()).toBe(200)
    const preview = await readJsonSafe(previewResponse) as { bomVersion: string; bomDeletion: { allowed: boolean } }
    expect(preview.bomDeletion.allowed).toBe(true)

    const deleted = await fixture.call('POST', '/api/manufacturing/boms/delete-all', {
      outputVariantId: fixture.outputVariantId,
      expectedVersion: preview.bomVersion,
    })
    expect(deleted.status()).toBe(200)
    expect(await readJsonSafe(deleted)).toMatchObject({ outputVariantId: fixture.outputVariantId, deletedBomIds: [bomId] })
    const list = await fixture.call('GET', `/api/manufacturing/boms?outputVariantId=${fixture.outputVariantId}&pageSize=100`)
    expect((await readJsonSafe(list) as { items: unknown[] }).items).toHaveLength(0)
  })
})

test('allows deleting an unused released revision and reports used revision conflicts', async ({ request }) => {
  await withBomFixtures(request, async (fixture) => {
    const bomId = await fixture.createBom()
    await fixture.createItem(bomId, fixture.componentVariantId)
    expect((await fixture.release(bomId)).status()).toBe(200)
    const preview = await readJsonSafe(await fixture.call('GET', `/api/manufacturing/boms/deletion-preview?id=${bomId}`)) as { revisionVersion: string; revision: { updatedAt: string } }
    const removed = await fixture.call('DELETE', '/api/manufacturing/boms', { id: bomId, expectedVersion: preview.revisionVersion }, preview.revision.updatedAt)
    expect(removed.status()).toBe(200)
  })
})
