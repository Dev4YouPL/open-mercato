import { expect, test } from '@playwright/test'
import {
  adminToken,
  cleanupWorkCenter,
  createWorkCenter,
  deleteWorkCenter,
  readWorkCenter,
  sameInstant,
  uniqueCode,
  updateWorkCenter,
} from './helpers'

/**
 * TC-MFG-WC-CONCURRENCY-001: real-PostgreSQL contention on the aggregate.
 *
 * These run against the live app and database, which is the only place the
 * `pg_advisory_xact_lock` ordering and the post-lock version comparison are
 * actually exercised. Each case fires two writes that carry the SAME expected
 * version and asserts exactly one wins with no partial state.
 */
test.describe('TC-MFG-WC-CONCURRENCY-001: same-version contenders', () => {
  test('lets exactly one of two same-version edits commit', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-CC1'), name: 'Base' })
      id = created.id
      const before = await readWorkCenter(request, token, id as string)
      const version = before?.updatedAt as string

      const [first, second] = await Promise.all([
        updateWorkCenter(request, token, { id, name: 'Winner A' }, version),
        updateWorkCenter(request, token, { id, name: 'Winner B' }, version),
      ])

      const statuses = [first.status, second.status].sort()
      expect(statuses, `expected one 200 and one 409, got ${JSON.stringify(statuses)}`).toEqual([200, 409])

      const conflict = first.status === 409 ? first : second
      expect(conflict.body.code).toBe('optimistic_lock_conflict')
      // The unified conflict bar keys off this body shape.
      expect(typeof conflict.body.currentUpdatedAt).toBe('string')
      // The conflict body normalizes to canonical ISO-8601 while the list read
      // returns PostgreSQL's own spelling, so compare instants, not strings.
      expect(sameInstant(conflict.body.expectedUpdatedAt, version)).toBe(true)

      const after = await readWorkCenter(request, token, id as string)
      expect(['Winner A', 'Winner B']).toContain(after?.name)
      expect(after?.updatedAt).not.toBe(version)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('serializes an edit against a delete on the same version', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-CC2'), name: 'Base' })
      id = created.id
      const version = (await readWorkCenter(request, token, id as string))?.updatedAt as string

      const [edit, remove] = await Promise.all([
        updateWorkCenter(request, token, { id, name: 'Edited' }, version),
        deleteWorkCenter(request, token, id as string, version),
      ])

      expect([edit.status, remove.status].sort()).toEqual([200, 409])
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('does not serialize two different Work Centres on one lock', async ({ request }) => {
    const token = await adminToken(request)
    let first: string | null = null
    let second: string | null = null

    try {
      first = (await createWorkCenter(request, token, { code: uniqueCode('WC-CC3A'), name: 'A' })).id
      second = (await createWorkCenter(request, token, { code: uniqueCode('WC-CC3B'), name: 'B' })).id
      const firstVersion = (await readWorkCenter(request, token, first as string))?.updatedAt as string
      const secondVersion = (await readWorkCenter(request, token, second as string))?.updatedAt as string

      // Distinct aggregates take distinct lock keys, so both must succeed.
      const [a, b] = await Promise.all([
        updateWorkCenter(request, token, { id: first, name: 'A edited' }, firstVersion),
        updateWorkCenter(request, token, { id: second, name: 'B edited' }, secondVersion),
      ])
      expect([a.status, b.status]).toEqual([200, 200])
    } finally {
      await cleanupWorkCenter(request, token, first)
      await cleanupWorkCenter(request, token, second)
    }
  })

  test('keeps the additive contract for a headerless write', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-CC4'), name: 'Base' })
      id = created.id
      // No expected-version header at all: the guard is strictly additive.
      const updated = await updateWorkCenter(request, token, { id, name: 'Headerless' })
      expect(updated.status, JSON.stringify(updated.body)).toBe(200)
      expect((await readWorkCenter(request, token, id as string))?.name).toBe('Headerless')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('rejects a stale version after an intervening commit', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-CC5'), name: 'Base' })
      id = created.id
      const stale = (await readWorkCenter(request, token, id as string))?.updatedAt as string

      expect((await updateWorkCenter(request, token, { id, name: 'First' }, stale)).status).toBe(200)
      const second = await updateWorkCenter(request, token, { id, name: 'Second' }, stale)
      expect(second.status).toBe(409)
      expect(second.body.code).toBe('optimistic_lock_conflict')

      // The refused write left nothing behind.
      expect((await readWorkCenter(request, token, id as string))?.name).toBe('First')
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })

  test('treats an equal-set no-op update as idempotent without bumping the version', async ({ request }) => {
    const token = await adminToken(request)
    let id: string | null = null

    try {
      const created = await createWorkCenter(request, token, { code: uniqueCode('WC-CC6'), name: 'Base' })
      id = created.id
      const before = await readWorkCenter(request, token, id as string)

      // Same scalars, same (empty) membership: validated against the version,
      // but nothing actually changes, so the version must not move.
      const noop = await updateWorkCenter(
        request,
        token,
        { id, name: before?.name, resourceIds: [] },
        before?.updatedAt,
      )
      expect(noop.status, JSON.stringify(noop.body)).toBe(200)

      const after = await readWorkCenter(request, token, id as string)
      expect(after?.updatedAt).toBe(before?.updatedAt)
    } finally {
      await cleanupWorkCenter(request, token, id)
    }
  })
})
