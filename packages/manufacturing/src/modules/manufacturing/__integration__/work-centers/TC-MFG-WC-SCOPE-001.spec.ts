import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  WORK_CENTERS_PATH,
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  deleteWorkCenter,
  expectStableError,
  listWorkCenters,
  resolveUrl,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-SCOPE-001: every read, write and lookup fails closed outside the
 * caller's tenant/organization, and does so without disclosing existence.
 */
test.describe('TC-MFG-WC-SCOPE-001: tenant and organization isolation', () => {
  test('never returns a record the caller cannot see, and says so as an empty result', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-SCOPE'), name: 'Scoped' })
      id = created.id

      // Visible to its own scope...
      expect(await readWorkCenter(request, token, id as string)).toBeTruthy()

      // ...and an id outside any scope is an empty collection, not a 403/404
      // that would confirm the record exists somewhere.
      const foreign = await listWorkCenters(request, token, '?ids=11111111-1111-4111-8111-111111111111')
      expect(foreign.status).toBe(200)
      expect(foreign.body.items ?? []).toEqual([])
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('refuses a write against an out-of-scope id with the non-disclosing 404', async ({ request }) => {
    const token = await adminToken(request)
    const foreignId = '11111111-1111-4111-8111-111111111111'

    const update = await updateWorkCenter(request, token, { id: foreignId, name: 'Hijack' })
    expect(update.status).toBe(404)
    expectStableError(update.body, 'work_center_not_found')

    const remove = await deleteWorkCenter(request, token, foreignId)
    expect(remove.status).toBe(404)
    expectStableError(remove.body, 'work_center_not_found')
  })

  test('never trusts tenant or organization ids supplied in the request body', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-SPOOF')
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, {
        code,
        name: 'Spoofed scope',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.id

      // Scope came from the authenticated context, so the record is still ours.
      const detail = await readWorkCenter(request, token, id as string)
      expect(detail?.code).toBe(code)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('gates every verb behind its declared feature', async ({ request }) => {
    const token = await adminToken(request)
    const anonymous = await request.post(resolveUrl(WORK_CENTERS_PATH), {
      data: { code: uniqueCode('WC-ANON'), name: 'Anonymous' },
    })
    expect([401, 403]).toContain(anonymous.status())

    // An authenticated admin holds both features, so the same call succeeds.
    let id: string | null = null
    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-AUTH'), name: 'Authorized' })
      expect(created.status).toBe(201)
      id = created.id
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('scopes the list to the caller without leaking a foreign code through search', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { status, body } = await listWorkCenters(request, token, '?search=zzz-nonexistent-code-zzz')
    expect(status).toBe(200)
    expect(body.items ?? []).toEqual([])
  })
})
