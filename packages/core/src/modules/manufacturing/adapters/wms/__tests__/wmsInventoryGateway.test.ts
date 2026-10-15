/** @jest-environment node */

import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toPositiveQuantity } from '../../../domain/quantity'
import type { InventoryMovementKind, InventoryMovementRequestDto } from '../../../ports/inventoryGateway'
import {
  createWmsInventoryGateway,
  MANUFACTURING_MOVEMENT_SOURCE,
  WMS_ADJUST_COMMAND_ID,
  WMS_MANUFACTURING_REFERENCE_TYPE,
  WMS_RECEIVE_COMMAND_ID,
} from '../wmsInventoryGateway'

const operationId = '11111111-1111-4111-8111-111111111111'
const ctx = {
  container: {},
  auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-selected' },
  selectedOrganizationId: 'org-selected',
} as unknown as CommandRuntimeContext

function buildRequest(kind: InventoryMovementKind): InventoryMovementRequestDto {
  const quantity = toPositiveQuantity(4)
  if (quantity === null) throw new Error('[internal] invalid test quantity')
  return { operationId, kind, warehouseId: 'warehouse-1', locationId: 'location-1', variantId: 'variant-1', quantity }
}

function buildGateway(execute: jest.Mock, isCommandAvailable = jest.fn(async () => true)) {
  const commandBus = { execute } as unknown as CommandBus
  return createWmsInventoryGateway({ commandBus, ctx, organizationId: 'org-1', isCommandAvailable })
}

function acceptingBus(movementId = 'movement-1') {
  return jest.fn(async () => ({ result: { movementId }, logEntry: null }))
}

describe('WMS inventory gateway', () => {
  it.each([
    ['consume', WMS_ADJUST_COMMAND_ID, { delta: -4 }],
    ['restock', WMS_ADJUST_COMMAND_ID, { delta: 4 }],
    ['receiveOutput', WMS_RECEIVE_COMMAND_ID, { quantity: 4 }],
  ] as const)('maps %s to %s', async (kind, commandId, quantityFields) => {
    const execute = acceptingBus()
    await buildGateway(execute).postMovement(buildRequest(kind))

    expect(execute).toHaveBeenCalledTimes(1)
    const [calledCommandId, options] = execute.mock.calls[0]
    expect(calledCommandId).toBe(commandId)
    expect(options.ctx).toBe(ctx)
    expect(options.input).toMatchObject({
      ...quantityFields,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      warehouseId: 'warehouse-1',
      locationId: 'location-1',
      catalogVariantId: 'variant-1',
      performedBy: 'user-1',
    })
  })

  it('takes tenant and user from the command context and the organization bound at creation', async () => {
    const execute = acceptingBus()
    await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(execute.mock.calls[0][1].input).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      performedBy: 'user-1',
    })
  })

  it.each([
    ['no auth', { ...ctx, auth: null }],
    ['no tenant', { ...ctx, auth: { sub: 'user-1', tenantId: null } }],
  ])('refuses to create a gateway with %s in the context', (_label, invalidCtx) => {
    const commandBus = { execute: acceptingBus() } as unknown as CommandBus
    expect(() =>
      createWmsInventoryGateway({ commandBus, ctx: invalidCtx as unknown as CommandRuntimeContext, organizationId: 'org-1' }),
    ).toThrow('[internal]')
  })

  it('uses the operation id as the WMS reference so retries replay the same movement', async () => {
    const execute = acceptingBus()
    await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(execute.mock.calls[0][1].input).toMatchObject({
      referenceType: WMS_MANUFACTURING_REFERENCE_TYPE,
      referenceId: operationId,
      metadata: { source: MANUFACTURING_MOVEMENT_SOURCE, operationId, movementKind: 'consume' },
    })
  })

  it('posts exactly one WMS movement per request and returns its id', async () => {
    const execute = acceptingBus('movement-42')
    const result = await buildGateway(execute).postMovement(buildRequest('receiveOutput'))

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'accepted', movementId: 'movement-42' })
  })

  it('returns the same movement when WMS replays an already posted operation', async () => {
    const execute = acceptingBus('movement-7')
    const gateway = buildGateway(execute)

    const first = await gateway.postMovement(buildRequest('consume'))
    const retry = await gateway.postMovement(buildRequest('consume'))

    expect(retry).toEqual(first)
    expect(execute.mock.calls[0][1].input).toEqual(execute.mock.calls[1][1].input)
  })

  it('rejects without calling WMS when the WMS command is not registered', async () => {
    const execute = acceptingBus()
    const result = await buildGateway(execute, jest.fn(async () => false)).postMovement(buildRequest('consume'))

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'rejected', code: 'inventory_unavailable' })
  })

  it.each([
    [new CrudHttpError(409, { error: 'insufficient_stock' }), 'insufficient_stock'],
    [new CrudHttpError(422, { error: 'invalid_location' }), 'invalid_location'],
    [new CrudHttpError(403, { error: 'Forbidden' }), 'Forbidden'],
    [new CrudHttpError(400, { message: 'no error field' }), 'http_400'],
    [new CommandInterceptorError('Blocked', { status: 423, body: { error: 'locked_period' } }), 'locked_period'],
  ])('maps a definitive WMS refusal to rejected (%#)', async (error, code) => {
    const execute = jest.fn(async () => {
      throw error
    })
    const result = await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(result).toMatchObject({ status: 'rejected', code })
  })

  it('maps a WMS input validation failure to rejected', async () => {
    const execute = jest.fn(async () => {
      z.object({ referenceId: z.string().uuid() }).parse({ referenceId: 'not-a-uuid' })
    })
    const result = await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(result).toMatchObject({ status: 'rejected', code: 'invalid_input' })
  })

  it.each([
    new Error('connection terminated'),
    new CrudHttpError(500, { error: 'internal' }),
    new CrudHttpError(503, { error: 'unavailable' }),
    new CommandInterceptorError('Interceptor crashed'),
  ])('maps an outcome WMS cannot vouch for to unknown (%#)', async (error) => {
    const execute = jest.fn(async () => {
      throw error
    })
    const result = await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(result).toEqual({ status: 'unknown', cause: error })
  })

  it('treats a WMS success without a movement id as unknown', async () => {
    const execute = jest.fn(async () => ({ result: {}, logEntry: null }))
    const result = await buildGateway(execute).postMovement(buildRequest('consume'))

    expect(result).toMatchObject({ status: 'unknown' })
  })
})
