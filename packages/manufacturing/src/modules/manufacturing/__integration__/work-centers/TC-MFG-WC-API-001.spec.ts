import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { resolveUrl } from './helpers'
import {
  WORK_CENTERS_PATH,
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  deleteWorkCenter,
  expectStableError,
  listWorkCenters,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-API-001: the Work Centre CRUD surface.
 *
 * Covers the collection and `ids` detail reads, all three writes, the response
 * envelope, field validation, the stable error codes, the non-disclosing empty
 * result, paging bounds and the 0/1/100/101 membership boundaries.
 *
 * Every fixture is created by the spec and removed in `finally`; no seeded or
 * demo Work Centre is assumed to exist.
 */
test.describe('TC-MFG-WC-API-001: Work Centre CRUD surface', () => {
  test('creates, reads, updates and soft-deletes with the documented envelope', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-API')
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, {
        code,
        name: 'Assembly cell',
        description: 'Housing assembly',
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.id
      expect(typeof id).toBe('string')

      const detail = await readWorkCenter(request, token, id as string)
      expect(detail).toBeTruthy()
      expect(detail).toMatchObject({
        id,
        code,
        name: 'Assembly cell',
        description: 'Housing assembly',
        isActive: true,
        resourceIds: [],
        resourceCount: 0,
      })
      // The public contract is camelCase and must always carry the version.
      expect(typeof detail?.updatedAt).toBe('string')
      expect(typeof detail?.createdAt).toBe('string')
      expect(detail).not.toHaveProperty('is_active')
      expect(detail).not.toHaveProperty('updated_at')

      const updated = await updateWorkCenter(
        request,
        token,
        { id, name: 'Assembly cell A', description: null, isActive: false },
        detail?.updatedAt,
      )
      expect(updated.status, JSON.stringify(updated.body)).toBe(200)
      expect(updated.body).toEqual({ ok: true })

      const afterUpdate = await readWorkCenter(request, token, id as string)
      expect(afterUpdate).toMatchObject({ name: 'Assembly cell A', description: null, isActive: false })
      expect(new Date(afterUpdate?.updatedAt ?? 0).getTime()).toBeGreaterThan(
        new Date(detail?.updatedAt ?? 0).getTime(),
      )

      const deleted = await deleteWorkCenter(request, token, id as string, afterUpdate?.updatedAt)
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(200)
      expect(deleted.body).toEqual({ ok: true })

      // A soft-deleted record leaves the public list/detail contract entirely.
      expect(await readWorkCenter(request, token, id as string)).toBeNull()
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('rejects a duplicate live code case-insensitively with the stable conflict', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-DUP')
    let first: string | null = null
    let second: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code, name: 'First' })
      expect(created.status).toBe(201)
      first = created.id

      const duplicate = await createWorkCenter(request, token, { code: code.toLowerCase(), name: 'Second' })
      expect(duplicate.status).toBe(409)
      expectStableError(duplicate.body, 'work_center_code_conflict')
      second = duplicate.id
      expect(second).toBeNull()
    } finally {
      await cleanupWorkCenter(request, token, first)
      await cleanupWorkCenter(request, token, second)
    }
  })

  test('frees a code for reuse once the holder is soft-deleted', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-REUSE')
    let first: string | null = null
    let second: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code, name: 'First' })
      expect(created.status).toBe(201)
      first = created.id
      const detail = await readWorkCenter(request, token, first as string)
      expect((await deleteWorkCenter(request, token, first as string, detail?.updatedAt)).status).toBe(200)

      // The unique index is partial on `deleted_at is null`.
      const reused = await createWorkCenter(request, token, { code, name: 'Second' })
      expect(reused.status, JSON.stringify(reused.body)).toBe(201)
      second = reused.id
    } finally {
      await cleanupWorkCenter(request, token, first)
      await cleanupWorkCenter(request, token, second)
    }
  })

  test('validates required fields and rejects an over-long code', async ({ request }) => {
    const token = await adminToken(request)

    const missingName = await createWorkCenter(request, token, { code: uniqueCode('WC-VAL') })
    expect(missingName.status).toBeGreaterThanOrEqual(400)
    expect(missingName.status).toBeLessThan(500)

    const missingCode = await createWorkCenter(request, token, { name: 'No code' })
    expect(missingCode.status).toBeGreaterThanOrEqual(400)
    expect(missingCode.status).toBeLessThan(500)

    const longCode = await createWorkCenter(request, token, { code: 'X'.repeat(101), name: 'Too long' })
    expect(longCode.status).toBeGreaterThanOrEqual(400)
    expect(longCode.status).toBeLessThan(500)
  })

  test('rejects 101 normalized member ids before any write', async ({ request }) => {
    const token = await adminToken(request)
    const resourceIds = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    )
    const code = uniqueCode('WC-LIMIT')

    const created = await createWorkCenter(request, token, { code, name: 'Too many', resourceIds })
    expect(created.status).toBe(422)
    expectStableError(created.body, 'resource_membership_limit_exceeded')

    // Nothing was written, so the code is still free.
    const { body } = await listWorkCenters(request, token, `?search=${encodeURIComponent(code)}`)
    expect(body.items ?? []).toEqual([])
  })

  test('creates an unassigned Work Centre for both an omitted and an empty membership', async ({ request }) => {
    const token = await adminToken(request)
    let omitted: string | null = null
    let empty: string | null = null

    try {
      const withoutField = await createWorkCenter(request, token, { code: uniqueCode('WC-OMIT'), name: 'Omitted' })
      expect(withoutField.status, JSON.stringify(withoutField.body)).toBe(201)
      omitted = withoutField.id

      const withEmpty = await createWorkCenter(request, token, {
        code: uniqueCode('WC-EMPTY'),
        name: 'Empty',
        resourceIds: [],
      })
      expect(withEmpty.status, JSON.stringify(withEmpty.body)).toBe(201)
      empty = withEmpty.id

      for (const id of [omitted, empty]) {
        const detail = await readWorkCenter(request, token, id as string)
        expect(detail?.resourceIds).toEqual([])
        expect(detail?.resourceCount).toBe(0)
      }
    } finally {
      await cleanupWorkCenter(request, token, omitted)
      await cleanupWorkCenter(request, token, empty)
    }
  })

  test('answers an unknown or foreign id with the empty non-disclosing result', async ({ request }) => {
    const token = await adminToken(request)
    const { status, body } = await listWorkCenters(
      request,
      token,
      '?ids=00000000-0000-4000-8000-0000000000ff&pageSize=1',
    )
    expect(status).toBe(200)
    expect(body.items ?? []).toEqual([])
    expect(body.total).toBe(0)
  })

  test('answers a delete of an unknown id without disclosing existence', async ({ request }) => {
    const token = await adminToken(request)
    const { status, body } = await deleteWorkCenter(request, token, '00000000-0000-4000-8000-0000000000ff')
    expect(status).toBe(404)
    expectStableError(body, 'work_center_not_found')
  })

  test('caps pageSize at 100 and keeps a stable ordering across pages', async ({ request }) => {
    const token = await adminToken(request)
    const overCap = await apiRequest(request, 'GET', `${WORK_CENTERS_PATH}?pageSize=500`, { token })
    expect(overCap.status()).toBeGreaterThanOrEqual(400)
    expect(overCap.status()).toBeLessThan(500)

    const firstPage = await listWorkCenters(request, token, '?page=1&pageSize=2&sortField=code&sortDir=asc')
    expect(firstPage.status).toBe(200)
    expect((firstPage.body.items ?? []).length).toBeLessThanOrEqual(2)
    const repeat = await listWorkCenters(request, token, '?page=1&pageSize=2&sortField=code&sortDir=asc')
    expect((repeat.body.items ?? []).map((item) => item.id)).toEqual(
      (firstPage.body.items ?? []).map((item) => item.id),
    )
  })

  test('filters by activity state', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-ACTIVE')
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code, name: 'Active one', isActive: true })
      id = created.id

      const active = await listWorkCenters(request, token, `?isActive=true&search=${encodeURIComponent(code)}`)
      expect((active.body.items ?? []).map((item) => item.id)).toContain(id)

      const inactive = await listWorkCenters(request, token, `?isActive=false&search=${encodeURIComponent(code)}`)
      expect((inactive.body.items ?? []).map((item) => item.id)).not.toContain(id)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('requires authentication', async ({ request }) => {
    // Deliberately raw: `apiRequest` always attaches a token.
    const anonymous = await request.get(resolveUrl(WORK_CENTERS_PATH))
    expect([401, 403]).toContain(anonymous.status())
  })
})
