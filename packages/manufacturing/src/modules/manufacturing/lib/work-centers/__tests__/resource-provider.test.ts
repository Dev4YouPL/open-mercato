import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveOptionalResourceReferences } from '../resource-provider'
import { WorkCenterDomainError } from '../errors'

const SCOPE = { tenantId: 't-1', organizationId: 'o-1', actorId: 'user-1' }
const R1 = '00000000-0000-4000-8000-000000000001'
const R2 = '00000000-0000-4000-8000-000000000002'

type ContainerParts = {
  granted?: boolean
  rbacService?: unknown
  queryEngine?: unknown
  onQuery?: (entityId: string, opts: Record<string, unknown>) => unknown
}

function createContainer(parts: ContainerParts = {}) {
  const queryCalls: Array<{ entityId: string; opts: Record<string, unknown> }> = []
  const rbacCalls: Array<{ userId: string; features: string[]; scope: unknown }> = []
  const container = {
    resolve(key: string) {
      if (key === 'rbacService') {
        if ('rbacService' in parts) {
          if (parts.rbacService === undefined) throw new Error('[internal] not registered')
          return parts.rbacService
        }
        return {
          userHasAllFeatures: async (userId: string, features: string[], scope: unknown) => {
            rbacCalls.push({ userId, features, scope })
            return parts.granted ?? true
          },
        }
      }
      if (key === 'queryEngine') {
        if ('queryEngine' in parts) {
          if (parts.queryEngine === undefined) throw new Error('[internal] not registered')
          return parts.queryEngine
        }
        return {
          query: async (entityId: string, opts: Record<string, unknown>) => {
            queryCalls.push({ entityId, opts })
            return parts.onQuery
              ? parts.onQuery(entityId, opts)
              : { items: [{ id: R1, is_active: true }], page: 1, pageSize: 100, total: 1 }
          },
        }
      }
      throw new Error(`[internal] unknown key ${key}`)
    },
  }
  return { container: container as never, queryCalls, rbacCalls }
}

function registerResourcesPeer(present: boolean) {
  registerEntityIds(
    present
      ? ({ resources: { resources_resource: 'resources:resources_resource' } } as never)
      : ({ catalog: { catalog_product: 'catalog:catalog_product' } } as never),
  )
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(WorkCenterDomainError)
  await promise.catch((error: WorkCenterDomainError) => expect(error.code).toBe(code))
}

describe('optional resources provider', () => {
  beforeEach(() => registerResourcesPeer(true))

  it('resolves the peer entity id and queries with explicit scope and projection', async () => {
    const { container, queryCalls } = createContainer()
    await resolveOptionalResourceReferences(container, [R1], SCOPE)
    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0].entityId).toBe('resources:resources_resource')
    expect(queryCalls[0].opts).toMatchObject({
      tenantId: 't-1',
      organizationId: 'o-1',
      withDeleted: false,
      fields: ['id', 'is_active'],
      filters: { id: { $in: [R1] } },
      page: { page: 1, pageSize: 100 },
    })
  })

  it('checks resources.view for the authenticated actor before querying', async () => {
    const { container, rbacCalls } = createContainer()
    await resolveOptionalResourceReferences(container, [R1], SCOPE)
    expect(rbacCalls).toEqual([
      { userId: 'user-1', features: ['resources.view'], scope: { tenantId: 't-1', organizationId: 'o-1' } },
    ])
  })

  it('uses one bounded lookup for a full 100-id set', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    const { container, queryCalls } = createContainer({
      onQuery: () => ({ items: ids.map((id) => ({ id, is_active: true })), page: 1, pageSize: 100, total: 100 }),
    })
    await resolveOptionalResourceReferences(container, ids, SCOPE)
    expect(queryCalls).toHaveLength(1)
  })

  it('authorizes an empty target set but performs no resource-id query', async () => {
    const { container, queryCalls, rbacCalls } = createContainer()
    await resolveOptionalResourceReferences(container, [], SCOPE)
    expect(rbacCalls).toHaveLength(1)
    expect(queryCalls).toHaveLength(0)
  })

  it('maps an absent peer to optional_provider_unavailable before any check', async () => {
    registerResourcesPeer(false)
    const { container, rbacCalls, queryCalls } = createContainer()
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
    expect(rbacCalls).toHaveLength(0)
    expect(queryCalls).toHaveLength(0)
  })

  it('maps an absent peer to optional_provider_unavailable even for an empty target set', async () => {
    registerResourcesPeer(false)
    const { container } = createContainer()
    await expectCode(resolveOptionalResourceReferences(container, [], SCOPE), 'optional_provider_unavailable')
  })

  it('maps a denied resources.view to resource_lookup_forbidden without querying', async () => {
    const { container, queryCalls } = createContainer({ granted: false })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'resource_lookup_forbidden')
    expect(queryCalls).toHaveLength(0)
  })

  it('maps a missing actor to resource_lookup_forbidden', async () => {
    const { container } = createContainer()
    await expectCode(
      resolveOptionalResourceReferences(container, [R1], { ...SCOPE, actorId: null }),
      'resource_lookup_forbidden',
    )
  })

  it('fails closed to optional_provider_unavailable when the RBAC service is unregistered', async () => {
    const { container } = createContainer({ rbacService: undefined })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
  })

  it('fails closed when the RBAC service lacks userHasAllFeatures', async () => {
    const { container } = createContainer({ rbacService: {} })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
  })

  it('fails closed when the authorization check throws', async () => {
    const { container } = createContainer({
      rbacService: {
        userHasAllFeatures: async () => {
          throw new Error('[internal] rbac exploded')
        },
      },
    })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
  })

  it('honours a wildcard grant through the canonical service', async () => {
    const { container } = createContainer({
      rbacService: { userHasAllFeatures: async () => true },
    })
    await expect(resolveOptionalResourceReferences(container, [R1], SCOPE)).resolves.toBeUndefined()
  })

  it('maps a failed scoped query to optional_provider_unavailable', async () => {
    const { container } = createContainer({
      onQuery: () => {
        throw new Error('[internal] query exploded')
      },
    })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
  })

  it('maps a missing scoped row to the non-disclosing resource_not_found', async () => {
    const { container } = createContainer({
      onQuery: () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
    })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'resource_not_found')
  })

  it('maps an inactive in-scope row to resource_inactive', async () => {
    const { container } = createContainer({
      onQuery: () => ({ items: [{ id: R1, is_active: false }], page: 1, pageSize: 100, total: 1 }),
    })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'resource_inactive')
  })

  it('rejects the whole set when only one member is missing', async () => {
    const { container } = createContainer({
      onQuery: () => ({ items: [{ id: R1, is_active: true }], page: 1, pageSize: 100, total: 1 }),
    })
    await expectCode(resolveOptionalResourceReferences(container, [R1, R2], SCOPE), 'resource_not_found')
  })

  it('fails closed when the query engine itself is unregistered', async () => {
    const { container } = createContainer({ queryEngine: undefined })
    await expectCode(resolveOptionalResourceReferences(container, [R1], SCOPE), 'optional_provider_unavailable')
  })
})
