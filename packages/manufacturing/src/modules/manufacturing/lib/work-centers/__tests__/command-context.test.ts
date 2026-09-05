import { assertCurrentManageGrant, requireWorkCenterScope, reversalVersion } from '../command-context'
import { WorkCenterDomainError } from '../errors'
import { toWorkCenterHttpError, withLocalizedWorkCenterErrors } from '../http-errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const SCOPE = { tenantId: 't-1', organizationId: 'o-1' }

function containerWith(rbacService: unknown) {
  return {
    resolve(key: string) {
      if (key !== 'rbacService') throw new Error(`[internal] unknown key ${key}`)
      if (rbacService === undefined) throw new Error('[internal] not registered')
      return rbacService
    },
  } as never
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await promise.then(
    () => {
      throw new Error('[internal] expected a rejection')
    },
    (error: WorkCenterDomainError) => expect(error.code).toBe(code),
  )
}

describe('reversal version', () => {
  const recorded = '2026-09-05T10:00:00.000Z'

  it('is deterministic for a given recorded version', () => {
    expect(reversalVersion(recorded).toISOString()).toBe(reversalVersion(recorded).toISOString())
  })

  it('is exactly one millisecond past the version it reverts', () => {
    expect(reversalVersion(recorded).toISOString()).toBe('2026-09-05T10:00:00.001Z')
  })

  it('stays strictly increasing across an undo/redo cycle', () => {
    const undone = reversalVersion(recorded)
    const redone = reversalVersion(undone)
    expect(undone.getTime()).toBeGreaterThan(new Date(recorded).getTime())
    expect(redone.getTime()).toBeGreaterThan(undone.getTime())
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(reversalVersion(new Date(recorded)).toISOString()).toBe(reversalVersion(recorded).toISOString())
  })
})

describe('current manage grant', () => {
  it('passes when the caller currently holds manage in the target scope', async () => {
    const calls: unknown[] = []
    const container = containerWith({
      userHasAllFeatures: async (userId: string, features: string[], scope: unknown) => {
        calls.push({ userId, features, scope })
        return true
      },
    })
    await assertCurrentManageGrant(container, 'user-1', SCOPE, 'work_center_undo_forbidden')
    expect(calls).toEqual([
      { userId: 'user-1', features: ['manufacturing.work_center.manage'], scope: SCOPE },
    ])
  })

  it('refuses an undo when the grant was revoked', async () => {
    const container = containerWith({ userHasAllFeatures: async () => false })
    await expectCode(
      assertCurrentManageGrant(container, 'user-1', SCOPE, 'work_center_undo_forbidden'),
      'work_center_undo_forbidden',
    )
  })

  it('refuses a redo with its own code', async () => {
    const container = containerWith({ userHasAllFeatures: async () => false })
    await expectCode(
      assertCurrentManageGrant(container, 'user-1', SCOPE, 'work_center_redo_forbidden'),
      'work_center_redo_forbidden',
    )
  })

  it('fails closed without an authenticated actor', async () => {
    const container = containerWith({ userHasAllFeatures: async () => true })
    await expectCode(
      assertCurrentManageGrant(container, null, SCOPE, 'work_center_undo_forbidden'),
      'work_center_undo_forbidden',
    )
  })

  it('fails closed when the RBAC service is unavailable', async () => {
    await expectCode(
      assertCurrentManageGrant(containerWith(undefined), 'user-1', SCOPE, 'work_center_undo_forbidden'),
      'work_center_undo_forbidden',
    )
  })
})

describe('scope derivation', () => {
  const ctx = { auth: { tenantId: 't-auth', orgId: 'o-auth' }, selectedOrganizationId: 'o-selected' } as never

  it('prefers the explicit command input over the ambient context', () => {
    expect(requireWorkCenterScope(ctx, { tenantId: 't-1', organizationId: 'o-1' })).toEqual(SCOPE)
  })

  it('falls back to the authenticated tenant and selected organization', () => {
    expect(requireWorkCenterScope(ctx, {})).toEqual({ tenantId: 't-auth', organizationId: 'o-selected' })
  })

  it('fails closed with the non-disclosing code when no scope resolves', () => {
    expect(() => requireWorkCenterScope({ auth: null } as never, {})).toThrow(WorkCenterDomainError)
  })
})

describe('http error envelope', () => {
  it('maps a domain error to its documented status and stable code', async () => {
    const mapped = await toWorkCenterHttpError(new WorkCenterDomainError('resource_inactive'))
    expect(isCrudHttpError(mapped)).toBe(true)
    expect((mapped as CrudHttpError).status).toBe(422)
    expect((mapped as CrudHttpError).body.code).toBe('resource_inactive')
    expect(typeof (mapped as CrudHttpError).body.error).toBe('string')
  })

  it('passes a CrudHttpError through untouched so the conflict body survives', async () => {
    const conflict = new CrudHttpError(409, {
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: 'a',
      expectedUpdatedAt: 'b',
    })
    expect(await toWorkCenterHttpError(conflict)).toBe(conflict)
  })

  it('leaves an unrelated error alone', async () => {
    const other = new Error('[internal] something else')
    expect(await toWorkCenterHttpError(other)).toBe(other)
  })

  it('wraps a handler so a domain throw leaves as an HTTP error', async () => {
    const wrapped = withLocalizedWorkCenterErrors(async () => {
      throw new WorkCenterDomainError('work_center_code_conflict')
    })
    await wrapped().then(
      () => {
        throw new Error('[internal] expected a rejection')
      },
      (error: unknown) => {
        expect(isCrudHttpError(error)).toBe(true)
        expect((error as CrudHttpError).status).toBe(409)
        expect((error as CrudHttpError).body.code).toBe('work_center_code_conflict')
      },
    )
  })

  it('returns the handler result untouched on success', async () => {
    const wrapped = withLocalizedWorkCenterErrors(async () => 'ok')
    await expect(wrapped()).resolves.toBe('ok')
  })
})
