import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  RESOURCES_PATH,
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  expectStableError,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-BOOT-001: the optional-provider contract, asserted against a real
 * app whose enabled-module set decides the outcome rather than a mocked DI
 * service.
 *
 * The suite reads the running app to decide which half of the contract applies,
 * so the same file is meaningful in the `full` profile and in the
 * `no-resources` / `no-planner` profiles, where the peer is genuinely absent.
 */
async function resourcesProviderAvailable(request: Parameters<typeof adminToken>[0], token: string) {
  const response = await apiRequest(request, 'GET', `${RESOURCES_PATH}?pageSize=1`, { token })
  return response.status() === 200
}

test.describe('TC-MFG-WC-BOOT-001: optional resources provider by activation profile', () => {
  test('always allows unassigned authoring and scalar-only editing', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      // Omitted membership resolves no provider, so this must work in every profile.
      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-BOOT1'),
        name: 'Unassigned',
        description: 'Authored without resources',
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.id

      const detail = await readWorkCenter(request, token, id as string)
      expect(detail?.resourceIds).toEqual([])

      const updated = await updateWorkCenter(request, token, { id, name: 'Renamed' }, detail?.updatedAt)
      expect(updated.status, JSON.stringify(updated.body)).toBe(200)
      expect((await readWorkCenter(request, token, id as string))?.name).toBe('Renamed')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('creating with an empty membership never needs the provider', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    try {
      const created = await createWorkCenter(request, token, {
        code: uniqueCode('WC-BOOT2'),
        name: 'Explicitly empty',
        resourceIds: [],
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.id
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('an equal membership set stays idempotent without the provider', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    try {
      id = (await createWorkCenter(request, token, { code: uniqueCode('WC-BOOT3'), name: 'Equal set' })).id
      const before = await readWorkCenter(request, token, id as string)

      // Stored set is empty and the incoming set is empty: a no-op that must not
      // resolve the optional peer even when it is missing entirely.
      const noop = await updateWorkCenter(request, token, { id, resourceIds: [] }, before?.updatedAt)
      expect(noop.status, JSON.stringify(noop.body)).toBe(200)
      expect((await readWorkCenter(request, token, id as string))?.updatedAt).toBe(before?.updatedAt)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('a changed membership set follows the profile: validated when present, refused when absent', async ({
    request,
  }) => {
    const token = await adminToken(request)
    const available = await resourcesProviderAvailable(request, token)
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code: uniqueCode('WC-BOOT4'), name: 'Membership' })).id
      const before = await readWorkCenter(request, token, id as string)
      const target = '55555555-5555-4555-8555-555555555555'

      const changed = await updateWorkCenter(request, token, { id, resourceIds: [target] }, before?.updatedAt)

      if (available) {
        // The peer is enabled, so the unknown id is validated and rejected as
        // a missing scoped record rather than an unavailable provider.
        expect(changed.status).toBe(404)
        expectStableError(changed.body, 'resource_not_found')
      } else {
        expect(changed.status).toBe(503)
        expectStableError(changed.body, 'optional_provider_unavailable')
      }

      // Either way the membership and the version are untouched.
      const after = await readWorkCenter(request, token, id as string)
      expect(after?.resourceIds).toEqual([])
      expect(after?.updatedAt).toBe(before?.updatedAt)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('a removal-only change is a membership change, not an omission', async ({ request }) => {
    const token = await adminToken(request)
    const available = await resourcesProviderAvailable(request, token)
    test.skip(available, 'covered by TC-MFG-WC-MEMBERSHIP-001 when the provider is enabled')

    let id: string | null = null
    try {
      id = (await createWorkCenter(request, token, { code: uniqueCode('WC-BOOT5'), name: 'Removal only' })).id
      const before = await readWorkCenter(request, token, id as string)

      // Without the peer, even clearing membership must refuse — the write is a
      // membership mutation whichever direction it moves.
      const cleared = await updateWorkCenter(
        request,
        token,
        { id, resourceIds: ['66666666-6666-4666-8666-666666666666'] },
        before?.updatedAt,
      )
      expect(cleared.status).toBe(503)
      expectStableError(cleared.body, 'optional_provider_unavailable')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })
})
