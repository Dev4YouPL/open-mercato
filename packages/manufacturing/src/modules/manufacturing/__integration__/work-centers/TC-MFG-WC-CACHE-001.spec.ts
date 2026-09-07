import { expect, test } from '@playwright/test'
import {
  adminToken,
  cleanupResource,
  cleanupWorkCenter,
  createResourceFixture,
  createWorkCenter,
  deleteWorkCenter,
  listWorkCenters,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-CACHE-001: an identical GET repeated after every kind of mutation
 * must return fresh data.
 *
 * The list contract is enriched per request (`hooks.afterList`), so a cached
 * list body would happily serve a stale membership set after a membership-only
 * change — the case `list.disableListCache: true` exists to prevent.
 */
test.describe('TC-MFG-WC-CACHE-001: read freshness after every mutation', () => {
  test('reflects a scalar change in an identical repeated read', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-CACHE1')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Before' })).id
      const query = `?search=${encodeURIComponent(code)}&pageSize=10`

      const first = await listWorkCenters(request, token, query)
      expect(first.body.items?.[0]?.name).toBe('Before')

      const version = first.body.items?.[0]?.updatedAt as string
      expect((await updateWorkCenter(request, token, { id, name: 'After' }, version)).status).toBe(200)

      const second = await listWorkCenters(request, token, query)
      expect(second.body.items?.[0]?.name).toBe('After')
      expect(second.body.items?.[0]?.updatedAt).not.toBe(version)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('reflects a membership-only change in both list and detail reads', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-CACHE2')
    let id: string | null = null
    let resourceId: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC cache ${Date.now()}`)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource?.id ?? null

      id = (await createWorkCenter(request, token, { code, name: 'Membership' })).id
      const query = `?search=${encodeURIComponent(code)}&pageSize=10`

      const before = await listWorkCenters(request, token, query)
      expect(before.body.items?.[0]?.resourceIds).toEqual([])
      const version = before.body.items?.[0]?.updatedAt as string

      const updated = await updateWorkCenter(request, token, { id, resourceIds: [resourceId] }, version)
      expect(updated.status, JSON.stringify(updated.body)).toBe(200)

      const after = await listWorkCenters(request, token, query)
      expect(after.body.items?.[0]?.resourceIds).toEqual([resourceId])
      expect(after.body.items?.[0]?.resourceCount).toBe(1)
      // A membership-only change still advances the parent version.
      expect(after.body.items?.[0]?.updatedAt).not.toBe(version)

      const detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([resourceId])
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })

  test('drops a soft-deleted record from an identical repeated read', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-CACHE3')
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code, name: 'Doomed' })).id
      const query = `?search=${encodeURIComponent(code)}&pageSize=10`

      expect((await listWorkCenters(request, token, query)).body.items?.length).toBe(1)
      const version = (await readWorkCenter(request, token, id as string))?.updatedAt
      expect((await deleteWorkCenter(request, token, id as string, version)).status).toBe(200)

      expect((await listWorkCenters(request, token, query)).body.items ?? []).toEqual([])
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('serves an empty page without a membership lookup and a full page consistently', async ({ request }) => {
    const token = await adminToken(request)
    // An empty result must still be a well-formed enriched payload.
    const empty = await listWorkCenters(request, token, '?search=zzz-no-such-work-centre-zzz')
    expect(empty.status).toBe(200)
    expect(empty.body.items ?? []).toEqual([])

    const page = await listWorkCenters(request, token, '?pageSize=5')
    for (const item of page.body.items ?? []) {
      // Every row on a non-empty page carries the enrichment.
      expect(Array.isArray(item.resourceIds)).toBe(true)
      expect(item.resourceCount).toBe(item.resourceIds.length)
      // Deterministic ordering of the membership set.
      expect(item.resourceIds).toEqual([...item.resourceIds].sort())
    }
  })
})
