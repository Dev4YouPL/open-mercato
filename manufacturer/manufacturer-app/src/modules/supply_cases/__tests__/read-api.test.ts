import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { buildFixtureIds } from '../data/fixtures'
import type { SupplyCasesStore, StoreScope } from '../data/repositories'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'

const mockGetAuthFromRequest = jest.fn<(request: Request) => Promise<AuthContext>>()
const mockGetSupplyCasesStore = jest.fn<() => SupplyCasesStore>()
const mockCreateRequestContainer = jest.fn<() => Promise<{ resolve: <T>(token: string) => T }>>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: mockGetAuthFromRequest }))
jest.mock('../di', () => ({ getSupplyCasesStore: mockGetSupplyCasesStore }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: mockCreateRequestContainer }))

import { GET as getList, metadata as listMetadata } from '../api/route'
import { GET as getDetail } from '../api/[id]/route'
import { POST as postDecision, metadata as decisionMetadata } from '../api/[id]/decision/route'

const scope: StoreScope = { tenantId: 'tenant-api', organizationId: 'org-api' }
const auth: Exclude<AuthContext, null> = {
  sub: 'user-api',
  tenantId: scope.tenantId,
  orgId: scope.organizationId,
}

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

describe('supply_cases read API routes', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-read-api-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
    mockGetAuthFromRequest.mockResolvedValue(auth)
    mockGetSupplyCasesStore.mockReturnValue(store)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: <T>() => ({ userHasAllFeatures: async () => false } as T),
    })
  })

  afterEach(async () => {
    jest.clearAllMocks()
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('declares view auth and feature metadata for the list route', () => {
    expect(listMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['supply_cases.view'] })
  })

  it('guards the decision route and requires an optimistic-lock version', async () => {
    expect(decisionMetadata.POST).toEqual({ requireAuth: true, requireFeatures: ['supply_cases.decisions.apply'] })
    const response = await postDecision(
      new Request('http://localhost/api/supply-cases/case-1/decision', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }),
      { params: { id: 'case-1' } },
    )
    expect(response.status).toBe(428)
  })

  it('dispatches a typed decision through the command bus with authenticated scope', async () => {
    const execute = jest.fn<(commandId: string, options: unknown) => Promise<{ result: { status: string; caseId: string; selectedOptionId: string; outboundCorrelationId: null } }>>(async () => ({ result: { status: 'selected', caseId: 'case-1', selectedOptionId: 'USE_INTERNAL_STOCK', outboundCorrelationId: null } }))
    mockCreateRequestContainer.mockResolvedValue({
      resolve: <T>(token: string) => (token === 'commandBus' ? { execute } : { userHasAllFeatures: async () => true }) as T,
    })
    const response = await postDecision(
      new Request('http://localhost/api/supply-cases/case-1/decision', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-19T00:00:00.000Z',
        },
        body: JSON.stringify({
          proposalId: 'proposal-1', factsHash: 'hash-1', kind: 'SELECT',
          selectedOptionId: 'USE_INTERNAL_STOCK', reason: null, idempotencyKey: 'decision-1',
        }),
      }),
      { params: { id: 'case-1' } },
    )
    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledWith('supply_cases.sourcing.apply_decision', expect.objectContaining({
      input: expect.objectContaining({ caseId: 'case-1', expectedUpdatedAt: '2026-09-19T00:00:00.000Z' }),
    }))
  })

  it('returns scoped list data through the public route', async () => {
    await store.seedScenario(scope)
    await store.seedScenario({ tenantId: 'tenant-other', organizationId: 'org-other' })

    const response = await getList(new Request('http://localhost/api/supply-cases?pageSize=1'))
    const body = await response.json() as { total: number; items: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0].id).toBe(buildFixtureIds(scope).supplyCase)
  })

  it('rejects invalid list filters instead of silently broadening the query', async () => {
    const response = await getList(new Request('http://localhost/api/supply-cases?status=NOT_A_STATUS'))

    expect(response.status).toBe(400)
  })

  it('returns 404 for a case outside the authenticated organization', async () => {
    const seeded = await store.seedScenario(scope)
    mockGetAuthFromRequest.mockResolvedValue({ ...auth, orgId: 'org-other' })

    const response = await getDetail(
      new Request(`http://localhost/api/supply-cases/${seeded.supplyCase.id}`),
      { params: { id: seeded.supplyCase.id } },
    )

    expect(response.status).toBe(404)
  })

  it('redacts message content when the optional message feature is absent', async () => {
    const seeded = await store.seedScenario(scope)

    const response = await getDetail(
      new Request(`http://localhost/api/supply-cases/${seeded.supplyCase.id}`),
      { params: { id: seeded.supplyCase.id } },
    )
    const body = await response.json() as { timeline: Array<{ body: string | null }> }

    expect(response.status).toBe(200)
    expect(body.timeline.some((event) => event.body !== null)).toBe(false)
  })
})
