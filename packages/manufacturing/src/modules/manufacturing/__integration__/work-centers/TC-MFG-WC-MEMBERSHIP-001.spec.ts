import { expect, test } from '@playwright/test'
import {
  adminToken,
  cleanupResource,
  cleanupWorkCenter,
  createResourceFixture,
  createWorkCenter,
  expectStableError,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-MEMBERSHIP-001: the aggregate-owned membership contract against a
 * live resources provider.
 *
 * The provider-absent half of this contract is covered by TC-MFG-WC-BOOT-001,
 * which runs the same requests in a profile without the resources module.
 */
test.describe('TC-MFG-WC-MEMBERSHIP-001: parent-owned resource membership', () => {
  test('creates with members, then adds, removes and clears the set atomically', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    const resourceIds: string[] = []

    try {
      for (let index = 0; index < 3; index += 1) {
        const resource = await createResourceFixture(request, token, `QA WC member ${Date.now()}-${index}`)
        test.skip(resource === null, 'resources module unavailable in this profile')
        resourceIds.push(resource!.id)
      }
      const [first, second, third] = resourceIds

      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-MEM'),
        name: 'With members',
        // Deliberately unsorted and duplicated: the response must normalize.
        resourceIds: [second, first, first],
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.id

      let detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([first, second].sort())
      expect(detail?.resourceCount).toBe(2)

      // Add one.
      expect(
        (await updateWorkCenter(request, token, { id, resourceIds: [first, second, third] }, detail?.updatedAt))
          .status,
      ).toBe(200)
      detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([first, second, third].sort())

      // Partial removal.
      expect((await updateWorkCenter(request, token, { id, resourceIds: [third] }, detail?.updatedAt)).status).toBe(200)
      detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([third])

      // Removal-only to an empty set.
      expect((await updateWorkCenter(request, token, { id, resourceIds: [] }, detail?.updatedAt)).status).toBe(200)
      detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([])
      expect(detail?.resourceCount).toBe(0)
    } finally {
      await cleanupWorkCenter(request, token, id)
      for (const resourceId of resourceIds) await cleanupResource(request, token, resourceId)
    }
  })

  test('preserves membership when resourceIds is omitted from an update', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    let resourceId: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC preserve ${Date.now()}`)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource!.id

      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-KEEP'),
        name: 'Keeps members',
        resourceIds: [resourceId],
      })
      id = created.id
      const before = await readWorkCenter(request, token, id as string)

      // A scalar-only edit: the field is absent, so membership is untouched.
      expect(
        (await updateWorkCenter(request, token, { id, name: 'Renamed' }, before?.updatedAt)).status,
      ).toBe(200)

      const after = await readWorkCenter(request, token, id as string)
      expect(after?.name).toBe('Renamed')
      expect(after?.resourceIds).toEqual([resourceId])
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })

  test('rejects an unknown resource id without writing anything', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-BADREF')

    const created = await createWorkCenter(request, token, {
      code,
      name: 'Bad reference',
      resourceIds: ['44444444-4444-4444-8444-444444444444'],
    })
    expect([404, 503]).toContain(created.status)
    if (created.status === 404) expectStableError(created.body, 'resource_not_found')

    // Nothing partial was left behind, so the code is still free.
    const retry = await createWorkCenter(request, token, { code, name: 'Now valid' })
    try {
      expect(retry.status, JSON.stringify(retry.body)).toBe(201)
    } finally {
      await cleanupWorkCenter(request, token, retry.id)
    }
  })

  test('rejects an inactive resource with its own code', async ({ request }) => {
    const token = await adminToken(request)
    let resourceId: string | null = null
    let id: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC inactive ${Date.now()}`, false)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource!.id

      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-INACT'),
        name: 'Inactive member',
        resourceIds: [resourceId],
      })
      id = created.id
      expect([422, 503]).toContain(created.status)
      if (created.status === 422) expectStableError(created.body, 'resource_inactive')
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })

  test('retains a stored member after the resource is deleted', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    let resourceId: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC retained ${Date.now()}`)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource!.id

      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-RETAIN'),
        name: 'Retains history',
        resourceIds: [resourceId],
      })
      id = created.id

      await cleanupResource(request, token, resourceId)
      resourceId = null

      // Membership is kept for history; Manufacturing never silently drops it.
      const detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toHaveLength(1)
      expect(detail?.resourceCount).toBe(1)

      // A scalar-only edit still works over the now-unresolvable member.
      expect((await updateWorkCenter(request, token, { id, name: 'Still editable' }, detail?.updatedAt)).status).toBe(
        200,
      )
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })

  test('accepts an equal set as an idempotent no-op', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    let resourceId: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC equal ${Date.now()}`)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource!.id

      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-EQ'),
          name: 'Equal set',
          resourceIds: [resourceId],
        })
      ).id
      const before = await readWorkCenter(request, token, id as string)

      const noop = await updateWorkCenter(request, token, { id, resourceIds: [resourceId] }, before?.updatedAt)
      expect(noop.status, JSON.stringify(noop.body)).toBe(200)

      const after = await readWorkCenter(request, token, id as string)
      expect(after?.updatedAt).toBe(before?.updatedAt)
      expect(after?.resourceIds).toEqual([resourceId])
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })
})
