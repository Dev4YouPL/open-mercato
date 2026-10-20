import { asValue, createContainer } from 'awilix'

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

import { metadata, POST } from '../boms/availability/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: jest.fn() }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const bomId = '33333333-3333-4333-8333-333333333333'
const userId = '77777777-7777-4777-8777-777777777777'
const timestamp = '2026-10-20T10:00:00.000Z'
const executeCommand = jest.fn()
const runAfterSuccess = jest.fn()

function request(body: unknown) {
  return new Request('http://localhost/api/manufacturing/boms/availability', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  const container = createContainer()
  container.register({ commandBus: asValue({ execute: executeCommand }) })
  jest.mocked(createRequestContainer).mockResolvedValue(container)
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
    selectedId: organizationId,
    tenantId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
  })
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess })
  jest.mocked(getTelemetryRuntime).mockReturnValue(null)
  executeCommand.mockResolvedValue({ result: { bomId, isAvailableForNewOrders: false, updatedAt: timestamp }, logEntry: null })
  runAfterSuccess.mockResolvedValue(undefined)
})

describe('BOM availability route', () => {
  it('requires manufacturing.manage and returns the state without an operation header', async () => {
    expect(metadata.POST.requireFeatures).toEqual(['manufacturing.manage'])
    const response = await POST(request({ id: bomId, isAvailableForNewOrders: false }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: bomId, isAvailableForNewOrders: false, updatedAt: timestamp })
    expect(response.headers.get('x-om-operation')).toBeNull()
    expect(runRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ operation: 'custom', resourceId: bomId }),
    }))
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid input before running mutation guards', async () => {
    const response = await POST(request({ id: bomId, isAvailableForNewOrders: 'false' }))
    expect(response.status).toBe(400)
    expect(runRouteMutationGuards).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('rejects mutation guards that change the BOM ID', async () => {
    jest.mocked(runRouteMutationGuards).mockResolvedValue({
      ok: true,
      modifiedPayload: { id: '44444444-4444-4444-8444-444444444444', isAvailableForNewOrders: false },
      runAfterSuccess,
    })
    const response = await POST(request({ id: bomId, isAvailableForNewOrders: false }))
    expect(response.status).toBe(400)
    expect(executeCommand).not.toHaveBeenCalled()
  })
})
