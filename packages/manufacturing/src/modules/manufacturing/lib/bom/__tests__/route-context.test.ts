import { z } from 'zod'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  runBomMutationGuards,
  runBomMutationGuardCallbacks,
  reparseGuardPayload,
  type BomGuardInput,
} from '../route-context'

/**
 * The platform mutation-guard contract has three halves and a custom write
 * route must honour all of them (spec "Custom routes"): a rejection
 * short-circuits, a transformed payload reaches the command *re-validated*,
 * and `afterSuccess` fires only after the write commits, with a real ID.
 *
 * The previous helper honoured only the first: it discarded `modifiedPayload`
 * and ran the callbacks inside itself — before the command, and never at all
 * on create, where `resourceId` is still null.
 */

const payloadSchema = z.object({
  target: z.object({ productId: z.string().uuid() }),
  baseOutput: z.object({ value: z.string() }),
})

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function makeContext(features: string[] = ['*']): CommandRuntimeContext {
  const container = {
    hasRegistration: () => false,
    resolve: () => {
      throw new Error('[internal] no registration')
    },
  }
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', features } as never,
    organizationScope: null,
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
  } as unknown as CommandRuntimeContext
}

function guardInput(overrides: Partial<BomGuardInput> = {}): BomGuardInput {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    resourceKind: 'manufacturing.bom',
    resourceId: null,
    operation: 'create',
    requestMethod: 'POST',
    requestHeaders: new Headers(),
    mutationPayload: { target: { productId: PRODUCT_ID }, baseOutput: { value: '1' } },
    ...overrides,
  }
}

function register(guard: MutationGuard): void {
  registerMutationGuards([{ moduleId: 'test', guards: [guard] }])
}

afterEach(() => {
  registerMutationGuards([])
})

describe('runBomMutationGuards', () => {
  it('returns the guard rejection as a response and defers nothing', async () => {
    register({
      id: 'test.block',
      targetEntity: 'manufacturing.bom',
      operations: ['create'],
      async validate() {
        return { ok: false, status: 409, body: { error: 'locked' } }
      },
    })

    const outcome = await runBomMutationGuards(makeContext(), guardInput())

    expect(outcome.blocked).not.toBeNull()
    expect(outcome.blocked!.status).toBe(409)
    await expect(outcome.blocked!.json()).resolves.toEqual({ error: 'locked' })
    expect(outcome.callbacks).toEqual([])
  })

  it('surfaces a transformed payload instead of discarding it', async () => {
    register({
      id: 'test.transform',
      targetEntity: 'manufacturing.bom',
      operations: ['create'],
      async validate(input) {
        return {
          ok: true,
          modifiedPayload: { ...(input.mutationPayload ?? {}), baseOutput: { value: '42' } },
        }
      },
    })

    const outcome = await runBomMutationGuards(makeContext(), guardInput())

    expect(outcome.blocked).toBeNull()
    expect(outcome.modifiedPayload).toMatchObject({ baseOutput: { value: '42' } })
  })

  it('never runs afterSuccess itself — the callbacks come back deferred', async () => {
    const afterSuccess = jest.fn(async () => {})
    register({
      id: 'test.defer',
      targetEntity: 'manufacturing.bom',
      operations: ['create'],
      async validate() {
        return { ok: true, shouldRunAfterSuccess: true, metadata: { lock: 'token' } }
      },
      afterSuccess,
    })

    const outcome = await runBomMutationGuards(makeContext(), guardInput())

    expect(afterSuccess).not.toHaveBeenCalled()
    expect(outcome.callbacks).toHaveLength(1)
    expect(outcome.callbacks[0].metadata).toEqual({ lock: 'token' })
  })
})

describe('reparseGuardPayload', () => {
  it('passes the parsed request body through when no guard changed it', () => {
    const parsed = { target: { productId: PRODUCT_ID }, baseOutput: { value: '1' } }
    const result = reparseGuardPayload(payloadSchema, parsed, null)
    expect(result).toEqual({ ok: true, data: parsed })
  })

  it('re-validates a transformed payload and hands back the parsed result', () => {
    const result = reparseGuardPayload(payloadSchema, { target: { productId: PRODUCT_ID }, baseOutput: { value: '1' } }, {
      target: { productId: PRODUCT_ID },
      baseOutput: { value: '42' },
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.baseOutput.value).toBe('42')
  })

  it('rejects a guard payload the command schema would not accept', async () => {
    const result = reparseGuardPayload(payloadSchema, { target: { productId: PRODUCT_ID }, baseOutput: { value: '1' } }, {
      target: { productId: 'not-a-uuid' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('[internal] expected a rejection')
    expect(result.response.status).toBe(422)
    await expect(result.response.json()).resolves.toMatchObject({ code: 'guard_payload_invalid' })
  })
})

describe('runBomMutationGuardCallbacks', () => {
  it('calls afterSuccess with the committed resource id', async () => {
    const afterSuccess = jest.fn(async () => {})
    const guard: MutationGuard = {
      id: 'test.after',
      targetEntity: 'manufacturing.bom',
      operations: ['create'],
      async validate() {
        return { ok: true }
      },
      afterSuccess,
    }

    await runBomMutationGuardCallbacks([{ guard, metadata: { lock: 'token' } }], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      resourceKind: 'manufacturing.bom',
      resourceId: 'bom-created-by-the-command',
      operation: 'create',
      requestMethod: 'POST',
      requestHeaders: new Headers(),
    })

    expect(afterSuccess).toHaveBeenCalledTimes(1)
    expect(afterSuccess.mock.calls[0][0]).toMatchObject({
      resourceId: 'bom-created-by-the-command',
      metadata: { lock: 'token' },
    })
  })

  it('swallows a callback failure so a committed write is not reported as failed', async () => {
    const guard: MutationGuard = {
      id: 'test.throwing',
      targetEntity: 'manufacturing.bom',
      operations: ['delete'],
      async validate() {
        return { ok: true }
      },
      async afterSuccess() {
        throw new Error('[internal] cache invalidation failed')
      },
    }

    await expect(
      runBomMutationGuardCallbacks([{ guard, metadata: null }], {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceKind: 'manufacturing.bom',
        resourceId: 'bom-1',
        operation: 'delete',
        requestMethod: 'DELETE',
        requestHeaders: new Headers(),
      }),
    ).resolves.toBeUndefined()
  })
})
