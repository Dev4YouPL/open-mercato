/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProductionOrderDto, ProductionOrderReader } from '../../ports/productionOrderReader'
import { createMikroExecutionContextReader } from '../executionContextReader'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const order: ProductionOrderDto = {
  id: 'order-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productVariantId: 'table',
  sourceLocationId: 'order-issue',
  targetLocationId: 'order-receipt',
  plannedQuantity: 10,
  allowsIssue: false,
  allowsReturn: true,
  allowsConfirmation: false,
}

function readerFor(execution: Record<string, unknown> | null, foundOrder: ProductionOrderDto | null = order) {
  const findOne = jest.fn(async (..._args: unknown[]) => execution)
  const em = { fork: () => ({ findOne }) } as unknown as EntityManager
  const productionOrderReader: ProductionOrderReader = { getForExecution: jest.fn(async () => foundOrder) }
  return { reader: createMikroExecutionContextReader({ em, productionOrderReader }), findOne }
}

describe('execution context reader', () => {
  it('takes product, locations and permissions from the order of the execution', async () => {
    const { reader } = readerFor({ id: 'execution-1', orderId: 'order-1', productVariantId: 'ignored', sourceLocationId: 'ignored' })

    expect(await reader.getContext('execution-1', scope)).toEqual({
      executionId: 'execution-1',
      orderId: 'order-1',
      productVariantId: 'table',
      sourceLocationId: 'order-issue',
      targetLocationId: 'order-receipt',
      plannedQuantity: 10,
      allowsIssue: false,
      allowsReturn: true,
      allowsConfirmation: false,
    })
  })

  it('takes product and locations from a standalone execution and allows every action', async () => {
    const { reader } = readerFor({
      id: 'execution-1',
      orderId: null,
      productVariantId: 'chair',
      sourceLocationId: 'own-issue',
      targetLocationId: null,
    })

    expect(await reader.getContext('execution-1', scope)).toEqual({
      executionId: 'execution-1',
      orderId: null,
      productVariantId: 'chair',
      sourceLocationId: 'own-issue',
      targetLocationId: null,
      plannedQuantity: null,
      allowsIssue: true,
      allowsReturn: true,
      allowsConfirmation: true,
    })
  })

  it('returns no context for a missing execution within the scope', async () => {
    const { reader, findOne } = readerFor(null)

    expect(await reader.getContext('execution-1', scope)).toBeNull()
    expect(findOne.mock.calls[0][1]).toMatchObject({ id: 'execution-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null })
  })

  it('fails loudly when the order of an execution is gone', async () => {
    const { reader } = readerFor({ id: 'execution-1', orderId: 'order-1' }, null)

    await expect(reader.getContext('execution-1', scope)).rejects.toThrow('[internal]')
  })
})
