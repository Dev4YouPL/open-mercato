/** @jest-environment node */

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { resolveManufacturingActor } from '../lib/manufacturingActor'

function buildCtx(auth: Record<string, unknown> | null): CommandRuntimeContext {
  return { container: {}, auth, selectedOrganizationId: 'org-selected' } as unknown as CommandRuntimeContext
}

describe('resolveManufacturingActor', () => {
  it('takes tenant and user from the context and the organization from the caller', () => {
    const actor = resolveManufacturingActor(buildCtx({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-selected' }), 'org-1')

    expect(actor).toEqual({ scope: { tenantId: 'tenant-1', organizationId: 'org-1' }, userId: 'user-1' })
  })

  it.each([
    ['no auth', null],
    ['no tenant', { sub: 'user-1', tenantId: null }],
    ['no user', { sub: '', tenantId: 'tenant-1' }],
  ])('throws with %s in the context', (_label, auth) => {
    expect(() => resolveManufacturingActor(buildCtx(auth), 'org-1')).toThrow('[internal]')
  })
})
