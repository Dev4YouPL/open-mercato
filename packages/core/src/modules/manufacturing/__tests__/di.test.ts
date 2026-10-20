/** @jest-environment node */

import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import { resolveInventoryGatewayFactory } from '../ports/inventoryGateway'
import { resolveInventoryPolicyReader } from '../ports/inventoryPolicyReader'
import { resolveOperationStore } from '../ports/operationStore'
import { resolveExecutionHistoryReader } from '../ports/executionHistoryReader'

describe('manufacturing DI', () => {
  it('builds an inventory gateway bound to the context and organization from the registered factory', async () => {
    const execute = jest.fn(async () => ({ result: { movementId: 'movement-1' }, logEntry: null }))
    const container = createContainer() as AppContainer
    container.register({ commandBus: asValue({ execute }) })
    register(container)

    const ctx = { container, auth: { sub: 'user-1', tenantId: 'tenant-1' } } as unknown as CommandRuntimeContext
    const gateway = resolveInventoryGatewayFactory(container)(ctx, 'org-1')

    expect(typeof gateway.postMovement).toBe('function')
  })

  it('builds the inventory policy reader on the container query engine', async () => {
    const query = jest.fn(async () => ({ items: [], page: 1, pageSize: 1, total: 0 }))
    const container = createContainer() as AppContainer
    container.register({ queryEngine: asValue({ query }) })
    register(container)

    const policy = await resolveInventoryPolicyReader(container).getTrackingPolicy('variant-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(policy).toMatchObject({ status: 'resolved' })
  })

  it('builds the operation store on a fork of the container entity manager', async () => {
    const findOne = jest.fn(async () => null)
    const fork = jest.fn(() => ({ findOne }))
    const container = createContainer() as AppContainer
    container.register({ em: asValue({ fork }) })
    register(container)

    const operation = await resolveOperationStore(container).find('operation-1', { tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(operation).toBeNull()
    expect(fork).toHaveBeenCalled()
  })

  it('builds the execution history reader on the container entity manager', async () => {
    const find = jest.fn(async () => [])
    const fork = jest.fn(() => ({ find }))
    const container = createContainer() as AppContainer
    container.register({ em: asValue({ fork }) })
    register(container)

    const history = await resolveExecutionHistoryReader(container).listForOrder('order-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(history).toEqual([])
    expect(fork).toHaveBeenCalled()
  })
})
