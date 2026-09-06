import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OrganizationScopeService } from '@open-mercato/shared/lib/auth/principal-service'
import { resolveBomRequestContext } from '../route-context'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

const auth = { sub: 'user', tenantId: 'tenant', orgId: 'actor-org', actorOrgId: 'actor-org' }

beforeEach(() => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(auth as never)
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: jest.fn() } as never)
})

function mockScopeService(scope: Awaited<ReturnType<OrganizationScopeService['resolveConcreteForRequest']>>) {
  const resolveConcreteForRequest = jest.fn().mockResolvedValue(scope)
  jest.mocked(createRequestContainer).mockResolvedValue({
    resolve: jest.fn().mockReturnValue({ resolveConcreteForRequest }),
  } as never)
  return resolveConcreteForRequest
}

it('uses the Directory-resolved selection and propagates the command scope', async () => {
  const scope = { selectedId: 'selected-org', tenantId: 'tenant', filterIds: ['selected-org'], allowedIds: ['selected-org'] }
  const resolveConcreteForRequest = mockScopeService(scope)
  const request = new Request('http://localhost/api/manufacturing/boms')
  const context = await resolveBomRequestContext(request)
  if (context instanceof Response) throw new Error('[internal] unexpected response')
  expect(context.organizationId).toBe('selected-org')
  expect(context.tenantId).toBe('tenant')
  expect(context.ctx.selectedOrganizationId).toBe('selected-org')
  expect(context.ctx.organizationScope).toEqual(scope)
  expect(resolveConcreteForRequest).toHaveBeenCalledWith({ auth, request })
})

it.each([
  { selectedId: null, tenantId: 'tenant', filterIds: null, allowedIds: null },
  { selectedId: 'actor-org', tenantId: 'tenant', filterIds: ['actor-org'], allowedIds: ['actor-org'], selectionRejected: true },
  { selectedId: 'other-org', tenantId: 'other-tenant', filterIds: ['other-org'], allowedIds: ['other-org'] },
])('rejects all-organizations, stale-selection and foreign-tenant scopes', async (scope) => {
  mockScopeService(scope)
  const response = await resolveBomRequestContext(new Request('http://localhost/api/manufacturing/boms'))
  if (!(response instanceof Response)) throw new Error('[internal] unexpected context')
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'organization_selection_invalid' })
})

it('rejects when the Directory scope service throws', async () => {
  const resolveConcreteForRequest = jest.fn().mockRejectedValue(new Error('boom'))
  jest.mocked(createRequestContainer).mockResolvedValue({
    resolve: jest.fn().mockReturnValue({ resolveConcreteForRequest }),
  } as never)
  const response = await resolveBomRequestContext(new Request('http://localhost/api/manufacturing/boms'))
  if (!(response instanceof Response)) throw new Error('[internal] unexpected context')
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'organization_selection_invalid' })
})
