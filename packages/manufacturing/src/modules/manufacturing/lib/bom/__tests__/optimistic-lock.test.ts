import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { BomOptimisticLockConflictError, assertAggregateVersion } from '../errors'

/**
 * The BOM draft revision is the optimistic-lock aggregate root, and the spec
 * requires these endpoints to behave exactly like the platform guard: a stale
 * token must produce the canonical `record_modified` /
 * `optimistic_lock_conflict` body. A BOM-specific code was returned before,
 * which `extractOptimisticLockConflict` did not recognise, so the shared
 * "record changed" banner never appeared and the author saw a generic toast.
 * `bom.version_conflict` stays reserved for a stale direct-line cursor.
 */
describe('assertAggregateVersion', () => {
  const current = new Date('2026-08-31T23:18:08.567Z')

  it('passes when no expected token is supplied', () => {
    expect(() => assertAggregateVersion(current, undefined)).not.toThrow()
    expect(() => assertAggregateVersion(current, null)).not.toThrow()
  })

  it('passes when the supplied token matches the aggregate', () => {
    expect(() => assertAggregateVersion(current, current.toISOString())).not.toThrow()
  })

  it('rejects a stale token with the canonical platform conflict body', () => {
    const stale = '2026-08-31T23:17:08.567Z'
    let thrown: unknown
    try {
      assertAggregateVersion(current, stale)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BomOptimisticLockConflictError)
    const conflict = thrown as BomOptimisticLockConflictError
    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: current.toISOString(),
      expectedUpdatedAt: stale,
    })
  })

  it('produces a body the shared client conflict helper recognises', () => {
    const stale = '2026-08-31T23:17:08.567Z'
    const conflict = new BomOptimisticLockConflictError(current.toISOString(), stale)
    expect(extractOptimisticLockConflict({ status: conflict.status, body: conflict.body })).toEqual(conflict.body)
  })
})
