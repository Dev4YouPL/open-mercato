import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  WORK_CENTERS_PATH,
  adminToken,
  cleanupResource,
  cleanupWorkCenter,
  createResourceFixture,
  createWorkCenter,
  readWorkCenter,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-LIFECYCLE-001: exact undo and redo against the real command bus.
 *
 * Reversal is deliberately strict: it may only act on a record still in exactly
 * the state its recorded counterpart produced, version included. These cases
 * prove both that a clean reversal restores every field and that a reversal
 * over intervening work refuses instead of overwriting it.
 */
test.describe('TC-MFG-WC-LIFECYCLE-001: undo and redo', () => {
  test.beforeEach(() => skipIfUndoTestsDisabled())

  test('undoes a create by soft-deleting it, then redoes it with the same id', async ({ request }) => {
    const token = await adminToken(request)
    const code = uniqueCode('WC-LC1')
    let id: string | null = null

    try {
      const response = await apiRequest(request, 'POST', WORK_CENTERS_PATH, {
        token,
        data: { code, name: 'Created' },
      })
      expect(response.status()).toBe(201)
      const operation = expectOperation(response, 'work centre create')
      id = ((await response.json()) as { id: string }).id

      await undoOk(request, token, operation.undoToken, 'undo work centre create')
      expect(await readWorkCenter(request, token, id)).toBeNull()

      const redone = await redoOk(request, token, operation.logId, 'redo work centre create')
      expect(redone.logId).toBeTruthy()

      const restored = await readWorkCenter(request, token, id)
      expect(restored, 'redo must restore the same record').toBeTruthy()
      // The UUID is preserved across the whole cycle.
      expect(restored?.id).toBe(id)
      expect(restored?.code).toBe(code)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('restores the exact previous scalars when undoing an update', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-LC2'),
          name: 'Original',
          description: 'Original description',
        })
      ).id
      const before = await readWorkCenter(request, token, id as string)

      const response = await apiRequest(request, 'PUT', WORK_CENTERS_PATH, {
        token,
        data: { id, name: 'Changed', description: null, isActive: false },
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before?.updatedAt as string },
      })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'work centre update')

      await undoOk(request, token, operation.undoToken, 'undo work centre update')

      const reverted = await readWorkCenter(request, token, id as string)
      expect(reverted?.name).toBe('Original')
      expect(reverted?.description).toBe('Original description')
      expect(reverted?.isActive).toBe(true)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('refuses an undo when the record changed after the recorded action', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      id = (await createWorkCenter(request, token, { code: uniqueCode('WC-LC3'), name: 'Original' })).id
      const before = await readWorkCenter(request, token, id as string)

      const response = await apiRequest(request, 'PUT', WORK_CENTERS_PATH, {
        token,
        data: { id, name: 'Changed' },
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before?.updatedAt as string },
      })
      const operation = expectOperation(response, 'work centre update')

      // A later, unrelated edit means the recorded state no longer holds.
      const mid = await readWorkCenter(request, token, id as string)
      expect((await updateWorkCenter(request, token, { id, name: 'Later edit' }, mid?.updatedAt)).status).toBe(200)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.ok(), 'undo must refuse over a later edit').toBe(false)

      // The later edit survives untouched.
      expect((await readWorkCenter(request, token, id as string))?.name).toBe('Later edit')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('refuses an undo that would restore a code another live record now owns', async ({ request }) => {
    const token = await adminToken(request)
    const originalCode = uniqueCode('WC-LC4')
    let first: string | null = null
    let second: string | null = null

    try {
      first = (await createWorkCenter(request, token, { code: originalCode, name: 'Holder' })).id
      const before = await readWorkCenter(request, token, first as string)

      // Rename it away, then let another record take the freed code.
      const response = await apiRequest(request, 'PUT', WORK_CENTERS_PATH, {
        token,
        data: { id: first, code: uniqueCode('WC-LC4B') },
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before?.updatedAt as string },
      })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'work centre rename')

      second = (await createWorkCenter(request, token, { code: originalCode, name: 'New holder' })).id
      expect(second).toBeTruthy()

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.ok(), 'undo must refuse a historical code collision').toBe(false)
    } finally {
      await cleanupWorkCenter(request, token, first)
      await cleanupWorkCenter(request, token, second)
    }
  })

  test('restores a soft-deleted Work Centre and its retained membership', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null
    let resourceId: string | null = null

    try {
      const resource = await createResourceFixture(request, token, `QA WC undo-delete ${Date.now()}`)
      test.skip(resource === null, 'resources module unavailable in this profile')
      resourceId = resource!.id

      id = (
        await createWorkCenter(request, token, {
          code: uniqueCode('WC-LC5'),
          name: 'Deleted then restored',
          resourceIds: [resourceId],
        })
      ).id
      const before = await readWorkCenter(request, token, id as string)

      const response = await apiRequest(request, 'DELETE', `${WORK_CENTERS_PATH}?id=${encodeURIComponent(id as string)}`, {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': before?.updatedAt as string },
      })
      expect(response.status()).toBe(200)
      const operation = expectOperation(response, 'work centre delete')
      expect(await readWorkCenter(request, token, id as string)).toBeNull()

      await undoOk(request, token, operation.undoToken, 'undo work centre delete')

      const restored = await readWorkCenter(request, token, id as string)
      expect(restored).toBeTruthy()
      expect(restored?.isActive).toBe(true)
      // Membership was never deleted, so it comes back intact and unrevalidated.
      expect(restored?.resourceIds).toEqual([resourceId])
    } finally {
      await cleanupWorkCenter(request, token, id)
      await cleanupResource(request, token, resourceId)
    }
  })

  test('rejects replaying the same undo token twice', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const response = await apiRequest(request, 'POST', WORK_CENTERS_PATH, {
        token,
        data: { code: uniqueCode('WC-LC6'), name: 'Replayed' },
      })
      const operation = expectOperation(response, 'work centre create')
      id = ((await response.json()) as { id: string }).id

      await undoOk(request, token, operation.undoToken, 'first undo')
      const replay = await undoByToken(request, token, operation.undoToken)
      expect(replay.ok(), 'a consumed undo token must not apply twice').toBe(false)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })
})
