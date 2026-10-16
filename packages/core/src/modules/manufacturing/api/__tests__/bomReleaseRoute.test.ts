import { asValue, createContainer } from 'awilix'

import {
  getAuthFromRequest,
} from '@open-mercato/shared/lib/auth/server'
import {
  createRequestContainer,
} from '@open-mercato/shared/lib/di/container'
import {
  CommandInterceptorError,
} from '@open-mercato/shared/lib/commands/errors'
import {
  deserializeOperationMetadata,
} from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  CrudHttpError,
} from '@open-mercato/shared/lib/crud/errors'
import {
  runRouteMutationGuards,
} from '@open-mercato/shared/lib/crud/route-mutation-guard'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  getTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import {
  resolveOrganizationScopeForRequest,
} from '@open-mercato/core/modules/directory/utils/organizationScope'

import { metadata, POST } from '../boms/release/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock(
  '@open-mercato/core/modules/directory/utils/organizationScope',
  () => ({
    resolveOrganizationScopeForRequest: jest.fn(),
  }),
)

jest.mock(
  '@open-mercato/shared/lib/crud/route-mutation-guard',
  () => ({
    runRouteMutationGuards: jest.fn(),
  }),
)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string) => key,
  })),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const bomId = '33333333-3333-4333-8333-333333333333'
const anotherBomId = '44444444-4444-4444-8444-444444444444'
const itemId = '66666666-6666-4666-8666-666666666666'
const userId = '77777777-7777-4777-8777-777777777777'
const homeOrganizationId = '88888888-8888-4888-8888-888888888888'

const timestamp = '2026-10-08T13:00:00.000Z'

const payload = {
  id: bomId,
  expectedItems: [{
    id: itemId,
    updatedAt: timestamp,
  }],
}

const executeCommand = jest.fn()
const runAfterSuccess = jest.fn()
const reportError = jest.fn()

function createRequest(body: unknown = payload): Request {
  return new Request(
    'http://localhost/api/manufacturing/boms/release',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: timestamp,
      },
      body: JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  jest.clearAllMocks()

  executeCommand.mockReset()
  executeCommand.mockResolvedValue({
    result: {
      bomId,
      isIncomplete: false,
    },
    logEntry: null,
  })

  runAfterSuccess.mockReset()
  runAfterSuccess.mockResolvedValue(undefined)

  const container = createContainer()

  container.register({
    commandBus: asValue({
      execute: executeCommand,
    }),
  })

  jest.mocked(createRequestContainer).mockReset()
  jest.mocked(createRequestContainer).mockResolvedValue(container)

  jest.mocked(getAuthFromRequest).mockReset()
  jest.mocked(getAuthFromRequest).mockResolvedValue({
    sub: userId,
    tenantId,
    orgId: homeOrganizationId,
  })

  jest.mocked(resolveOrganizationScopeForRequest).mockReset()
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
    selectedId: organizationId,
    tenantId,
    filterIds: [organizationId],
    allowedIds: [homeOrganizationId, organizationId],
  })

  jest.mocked(runRouteMutationGuards).mockReset()
  jest.mocked(runRouteMutationGuards).mockResolvedValue({
    ok: true,
    runAfterSuccess,
  })

  jest.mocked(getTelemetryRuntime).mockReturnValue({
    reportError,
  } as unknown as NonNullable<ReturnType<typeof getTelemetryRuntime>>)
})

describe('BOM release route', () => {
  it.each([false, true])(
    'returns the released BOM with isIncomplete=%s',
    async (isIncomplete) => {
      executeCommand.mockResolvedValue({
        result: {
          bomId,
          isIncomplete,
        },
        logEntry: null,
      })

      const req = createRequest()
      const response = await POST(req)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: bomId,
        status: 'released',
        isIncomplete,
      })

      expect(executeCommand).toHaveBeenCalledWith(
        'manufacturing.boms.release',
        {
          input: payload,
          ctx: expect.objectContaining({
            auth: expect.objectContaining({
              sub: userId,
              tenantId,
            }),
            selectedOrganizationId: organizationId,
            organizationIds: [organizationId],
            request: req,
          }),
        },
      )

      expect(runRouteMutationGuards).toHaveBeenCalledWith(
        expect.objectContaining({
          req,
          auth: {
            userId,
            tenantId,
            organizationId,
          },
          input: {
            resourceKind: 'manufacturing.bom',
            resourceId: bomId,
            operation: 'custom',
            mutationPayload: payload,
          },
        }),
      )

      expect(runAfterSuccess).toHaveBeenCalledTimes(1)
      expect(
        executeCommand.mock.invocationCallOrder[0],
      ).toBeLessThan(
        runAfterSuccess.mock.invocationCallOrder[0],
      )

      expect(response.headers.get('x-om-operation')).toBeNull()
    },
  )

  it('attaches operation metadata when the log supplies an undo token', async () => {
    executeCommand.mockResolvedValue({
      result: {
        bomId,
        isIncomplete: false,
      },
      logEntry: {
        id: itemId,
        commandId: 'manufacturing.boms.release',
        undoToken: 'operation-token',
        actionLabel: 'Release BOM',
        resourceKind: 'manufacturing.bom',
        resourceId: bomId,
        createdAt: new Date(timestamp),
      },
    })

    const response = await POST(createRequest())

    expect(
      deserializeOperationMetadata(
        response.headers.get('x-om-operation'),
      ),
    ).toMatchObject({
      commandId: 'manufacturing.boms.release',
      resourceId: bomId,
      executedAt: timestamp,
    })
  })

  it.each([
    { id: bomId },
    { id: 'invalid', expectedItems: [] },
    { ...payload, status: 'released' },
  ])('rejects invalid input: %j', async (body) => {
    const response = await POST(createRequest(body))

    expect(response.status).toBe(400)
    expect(executeCommand).not.toHaveBeenCalled()
    expect(runRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const response = await POST(new Request(
      'http://localhost/api/manufacturing/boms/release',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{',
      },
    ))

    expect(response.status).toBe(400)
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('returns 401 without authentication', async () => {
    jest.mocked(getAuthFromRequest).mockResolvedValue(null)

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('requires an organization context', async () => {
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: null,
    })

    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: null,
      tenantId,
      filterIds: null,
      allowedIds: [],
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(400)
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('rejects a denied organization selection', async () => {
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
      selectedId: homeOrganizationId,
      tenantId,
      filterIds: [homeOrganizationId],
      allowedIds: [homeOrganizationId],
      selectionRejected: true,
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('returns a mutation guard rejection without executing the command', async () => {
    const body = {
      error: 'Record locked',
      code: 'record_locked',
    }

    jest.mocked(runRouteMutationGuards).mockResolvedValue({
      ok: false,
      errorStatus: 423,
      errorBody: body,
      response: Response.json(body, { status: 423 }),
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual(body)
    expect(executeCommand).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('uses a valid payload transformed by a mutation guard', async () => {
    const modifiedPayload = {
      id: bomId,
      expectedItems: [],
    }

    jest.mocked(runRouteMutationGuards).mockResolvedValue({
      ok: true,
      modifiedPayload,
      runAfterSuccess,
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    expect(executeCommand).toHaveBeenCalledWith(
      'manufacturing.boms.release',
      expect.objectContaining({
        input: modifiedPayload,
      }),
    )
  })

  it('rejects a guard transformation targeting another BOM', async () => {
    jest.mocked(runRouteMutationGuards).mockResolvedValue({
      ok: true,
      modifiedPayload: {
        ...payload,
        id: anotherBomId,
      },
      runAfterSuccess,
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(400)
    expect(executeCommand).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it.each([404, 409, 422])(
    'preserves command error status %s and its response body',
    async (status) => {
      const body = {
        error: 'Release rejected',
        code: 'manufacturing.bom_release.tracking_required',
        violations: [{
          variantId: anotherBomId,
          role: 'component',
          name: 'Component',
          sku: 'COMP-01',
          requirements: ['lot'],
        }],
      }

      executeCommand.mockRejectedValue(
        new CrudHttpError(status, body),
      )

      const response = await POST(createRequest())

      expect(response.status).toBe(status)
      expect(await response.json()).toEqual(body)
      expect(runAfterSuccess).not.toHaveBeenCalled()
    },
  )

  it('preserves a command interceptor rejection', async () => {
    const body = {
      error: 'Operation denied',
      code: 'operation_denied',
    }

    executeCommand.mockRejectedValue(
      new CommandInterceptorError('Operation denied', {
        status: 403,
        body,
      }),
    )

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(body)
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('reports unexpected errors and returns a generic 500 response', async () => {
    const error = new Error('[internal] Database unavailable')

    executeCommand.mockRejectedValue(error)

    const response = await POST(createRequest())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'manufacturing.errors.bomReleaseFailed',
    })

    expect(reportError).toHaveBeenCalledWith(error, {
      module: 'manufacturing',
      code: 'manufacturing.bom_release_request_failed',
    })

    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('declares authentication and the manufacturing manage feature', () => {
    expect(metadata.POST).toEqual({
      requireAuth: true,
      requireFeatures: ['manufacturing.manage'],
    })
  })
})