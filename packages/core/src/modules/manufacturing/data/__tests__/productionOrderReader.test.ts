/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { createMikroProductionOrderReader } from '../productionOrderReader'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function readerReturning(row: Record<string, unknown> | null) {
  const findOne = jest.fn(async (..._args: unknown[]) => row)
  const em = { fork: () => ({ findOne }) } as unknown as EntityManager
  return { reader: createMikroProductionOrderReader({ em }), findOne }
}

const orderRow = {
  id: 'order-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productVariantId: 'table',
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
  status: 'released',
}

describe('production order reader', () => {
  it('maps an order to the execution contract with permissions derived from its status', async () => {
    const { reader } = readerReturning(orderRow)

    expect(await reader.getForExecution('order-1', scope)).toEqual({
      id: 'order-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      productVariantId: 'table',
      sourceLocationId: 'issue-location',
      targetLocationId: 'receipt-location',
      allowsIssue: true,
      allowsReturn: true,
      allowsConfirmation: true,
    })
  })

  it('allows only returns on a cancelled order', async () => {
    const { reader } = readerReturning({ ...orderRow, status: 'cancelled' })

    expect(await reader.getForExecution('order-1', scope)).toMatchObject({
      allowsIssue: false,
      allowsReturn: true,
      allowsConfirmation: false,
    })
  })

  it('reads only non-deleted orders within the scope', async () => {
    const { reader, findOne } = readerReturning(null)

    expect(await reader.getForExecution('order-1', scope)).toBeNull()
    expect(findOne.mock.calls[0][1]).toMatchObject({
      id: 'order-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
  })
})
