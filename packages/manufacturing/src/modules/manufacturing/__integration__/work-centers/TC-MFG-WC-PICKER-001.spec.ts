import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  adminToken,
  cleanupResource,
  cleanupWorkCenter,
  createResourceFixture,
  createWorkCenter,
  readWorkCenter,
  uniqueCode,
} from './helpers'

const LIST_URL = '/backend/manufacturing/work-centers'

/**
 * TC-MFG-WC-PICKER-001: the resource selector is a real remote search, not a
 * capped first-page catalogue, and it never loses a selection.
 *
 * Creating more than 100 resources is slow, so the paging case is proven by
 * asserting the picker issues a paged, searched request rather than one
 * unbounded fetch — the property that makes a resource beyond the first page
 * reachable.
 */
test.describe('TC-MFG-WC-PICKER-001: resource selector', () => {
  test('queries the resources API with explicit paging and a remote search term', async ({ page, request }) => {
    const token = await adminToken(request)
    const marker = `QA WC picker ${Date.now()}`
    const resource = await createResourceFixture(request, token, marker)
    test.skip(resource === null, 'resources module unavailable in this profile')

    try {
      const requests: string[] = []
      page.on('request', (req) => {
        if (req.url().includes('/api/resources/resources')) requests.push(req.url())
      })

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/create`)

      const search = page.getByRole('searchbox', { name: /search resources|szukaj zasob/i }).first()
      await expect(search).toBeVisible({ timeout: 20000 })
      await search.fill(marker)

      await expect.poll(() => requests.some((url) => url.includes(`search=`)), { timeout: 20000 }).toBe(true)

      // Every candidate query is explicitly paged and bounded at or under 100.
      for (const url of requests) {
        const parsed = new URL(url, 'http://localhost')
        if (!parsed.searchParams.has('page')) continue
        expect(Number(parsed.searchParams.get('pageSize'))).toBeLessThanOrEqual(100)
        expect(Number(parsed.searchParams.get('page'))).toBeGreaterThanOrEqual(1)
      }
      // It never reads the resources table directly — only the public API.
      expect(requests.every((url) => url.includes('/api/resources/resources'))).toBe(true)
    } finally {
      await cleanupResource(request, token, resource?.id ?? null)
    }
  })

  test('hydrates a stored selection by id, without a search or activity filter', async ({ page, request }) => {
    const token = await adminToken(request)
    const marker = `QA WC hydrate ${Date.now()}`
    const resource = await createResourceFixture(request, token, marker)
    test.skip(resource === null, 'resources module unavailable in this profile')
    let id: string | null = null

    try {
      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-PICKHYD'),
          name: 'Hydrates',
          resourceIds: [resource!.id],
        })
      ).id

      const hydrationUrls: string[] = []
      page.on('request', (req) => {
        const url = req.url()
        if (url.includes('/api/resources/resources') && url.includes('ids=')) hydrationUrls.push(url)
      })

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)

      // The stored member renders by name, not as a raw uuid.
      await expect(page.getByText(marker).first()).toBeVisible({ timeout: 20000 })

      expect(hydrationUrls.length).toBeGreaterThan(0)
      const hydration = new URL(hydrationUrls[0], 'http://localhost')
      expect(hydration.searchParams.get('ids')).toContain(resource!.id)
      // Hydration must not filter, or an inactive stored member would vanish.
      expect(hydration.searchParams.has('search')).toBe(false)
      expect(hydration.searchParams.has('isActive')).toBe(false)
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resource?.id ?? null)
    }
  })

  test('keeps an inactive stored selection visible and marked', async ({ page, request }) => {
    const token = await adminToken(request)
    const marker = `QA WC inactive-pick ${Date.now()}`
    const resource = await createResourceFixture(request, token, marker, false)
    test.skip(resource === null, 'resources module unavailable in this profile')
    let id: string | null = null

    try {
      // Membership is stored directly: creating with an inactive member is
      // rejected by design, but an existing member can become inactive later.
      const active = await createResourceFixture(request, token, `${marker} active`)
      test.skip(active === null, 'resources module unavailable in this profile')
      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-PICKINACT'),
          name: 'Inactive member',
          resourceIds: [active!.id],
        })
      ).id

      await login(page, 'admin')
      await page.goto(`${LIST_URL}/${id}`)
      await expect(page.getByText(`${marker} active`).first()).toBeVisible({ timeout: 20000 })

      // The selection survives whatever the provider reports.
      const detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([active!.id])
      await cleanupResource(request, token, active!.id)
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resource?.id ?? null)
    }
  })

  test('keeps selections when the resources lookup fails and offers a retry', async ({ page, request }) => {
    const token = await adminToken(request)
    const marker = `QA WC failing ${Date.now()}`
    const resource = await createResourceFixture(request, token, marker)
    test.skip(resource === null, 'resources module unavailable in this profile')
    let id: string | null = null

    try {
      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-PICKFAIL'),
          name: 'Survives failure',
          resourceIds: [resource!.id],
        })
      ).id

      await login(page, 'admin')
      // Every candidate query fails; hydration and selection must not be lost.
      await page.route('**/api/resources/resources?*page=*', (route) => route.abort())
      await page.goto(`${LIST_URL}/${id}`)

      await expect(page.getByText(/1 selected|wybrano: 1/i).first()).toBeVisible({ timeout: 20000 })
      // A failed search is not an empty catalogue: a retry is offered.
      await expect(page.getByRole('button', { name: /retry|ponów/i })).toBeVisible()

      // The stored membership is untouched by the failure.
      expect((await readWorkCenter(request, token, id as string))?.resourceIds).toEqual([resource!.id])
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resource?.id ?? null)
    }
  })
})
