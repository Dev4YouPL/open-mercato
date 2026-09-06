import { DefaultOrganizationScopeService } from '../organizationScopeService'

const auth = { sub: 'user', tenantId: 'tenant', orgId: null, isSuperAdmin: true }

function createService(organizations: Array<{ id: string }>) {
  const em = { find: jest.fn().mockResolvedValue(organizations) }
  const rbac = { invalidateUserCache: jest.fn(), loadAcl: jest.fn() }
  const container = {} as never
  return { service: new DefaultOrganizationScopeService(em as never, rbac, container), em }
}

describe('DefaultOrganizationScopeService.resolveConcreteForRequest', () => {
  it('selects the sole active organization for an unrestricted caller', async () => {
    const { service, em } = createService([{ id: 'only-org' }])
    jest.spyOn(service, 'resolveForRequest').mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant',
    })

    await expect(service.resolveConcreteForRequest({ auth })).resolves.toEqual({
      selectedId: 'only-org',
      filterIds: ['only-org'],
      allowedIds: null,
      tenantId: 'tenant',
    })
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      { tenant: 'tenant', deletedAt: null },
      { fields: ['id'], limit: 2 },
    )
  })

  it('does not choose an organization when more than one is active', async () => {
    const { service } = createService([{ id: 'org-a' }, { id: 'org-b' }])
    const scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant' }
    jest.spyOn(service, 'resolveForRequest').mockResolvedValue(scope)

    await expect(service.resolveConcreteForRequest({ auth })).resolves.toEqual(scope)
  })

  it('preserves an explicitly rejected selection without falling back', async () => {
    const { service, em } = createService([{ id: 'only-org' }])
    const scope = {
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant',
      selectionRejected: true,
    }
    jest.spyOn(service, 'resolveForRequest').mockResolvedValue(scope)

    await expect(service.resolveConcreteForRequest({ auth })).resolves.toEqual(scope)
    expect(em.find).not.toHaveBeenCalled()
  })
})
