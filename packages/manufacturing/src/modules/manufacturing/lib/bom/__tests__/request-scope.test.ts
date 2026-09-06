import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveBomRequestContext } from '../route-context'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const auth = { sub: 'user', tenantId: 'tenant', orgId: 'actor-org', actorOrgId: 'actor-org' }

beforeEach(() => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(auth as never)
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: jest.fn() } as never)
})

it('uses the Directory-resolved selection and propagates the command scope', async () => {
  const scope = { selectedId: 'selected-org', tenantId: 'tenant', filterIds: ['selected-org'], allowedIds: ['selected-org'] }
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue(scope as never)
  const request = new Request('http://localhost/api/manufacturing/boms')
  const context = await resolveBomRequestContext(request)
  if (context instanceof Response) throw new Error('[internal] unexpected response')
  expect(context.organizationId).toBe('selected-org')
  expect(context.tenantId).toBe('tenant')
  expect(context.ctx.selectedOrganizationId).toBe('selected-org')
  expect(context.ctx.organizationScope).toEqual(scope)
  expect(jest.mocked(resolveOrganizationScopeForRequest)).toHaveBeenCalledWith(
    expect.objectContaining({ auth, request }),
  )
})

it.each([
  { selectedId: null, tenantId: 'tenant', filterIds: null, allowedIds: null },
  { selectedId: 'actor-org', tenantId: 'tenant', filterIds: ['actor-org'], allowedIds: ['actor-org'], selectionRejected: true },
  { selectedId: 'other-org', tenantId: 'other-tenant', filterIds: ['other-org'], allowedIds: ['other-org'] },
])('rejects all-organizations, stale-selection and foreign-tenant scopes', async (scope) => {
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue(scope as never)
  const response = await resolveBomRequestContext(new Request('http://localhost/api/manufacturing/boms'))
  if (!(response instanceof Response)) throw new Error('[internal] unexpected context')
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'organization_selection_invalid' })
})

it('rejects when the Directory resolver throws', async () => {
  jest.mocked(resolveOrganizationScopeForRequest).mockRejectedValue(new Error('boom'))
  const response = await resolveBomRequestContext(new Request('http://localhost/api/manufacturing/boms'))
  if (!(response instanceof Response)) throw new Error('[internal] unexpected context')
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'organization_selection_invalid' })
})
