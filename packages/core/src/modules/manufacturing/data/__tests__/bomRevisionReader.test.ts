/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { createMikroBomRevisionReader } from '../bomRevisionReader'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

const bomRow = {
  id: 'bom-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  outputVariantId: 'table',
  baseQuantity: '2.000000',
  revision: 'A',
  status: 'released',
  isAvailableForNewOrders: true,
}

const itemRows = [
  { id: 'item-1', componentVariantId: 'top', quantity: '2.000000', position: 1 },
  { id: 'item-2', componentVariantId: 'leg', quantity: '8.000000', position: 2 },
  { id: 'item-3', componentVariantId: 'oil', quantity: '0.250000', position: 3 },
]

function readerReturning(bom: Record<string, unknown> | null, items: Record<string, unknown>[] = itemRows) {
  const findOne = jest.fn(async (..._args: unknown[]) => bom)
  const find = jest.fn(async (..._args: unknown[]) => items)
  const em = { fork: () => ({ findOne, find }) } as unknown as EntityManager
  return { reader: createMikroBomRevisionReader({ em }), findOne, find }
}

describe('BOM revision reader', () => {
  it('maps a released BOM revision to the order contract with quantities per unit of product', async () => {
    const { reader } = readerReturning(bomRow)

    expect(await reader.getForOrder('bom-1', scope)).toEqual({
      id: 'bom-1',
      productVariantId: 'table',
      isReleased: true,
      isAvailable: true,
      components: [
        { variantId: 'top', quantity: 1 },
        { variantId: 'leg', quantity: 4 },
        { variantId: 'oil', quantity: 0.125 },
      ],
    })
  })

  it('reports a draft revision as neither released nor available', async () => {
    const { reader } = readerReturning({ ...bomRow, status: 'draft' })

    expect(await reader.getForOrder('bom-1', scope)).toMatchObject({ isReleased: false, isAvailable: false })
  })

  it('reports a withdrawn released revision as released but unavailable', async () => {
    const { reader } = readerReturning({ ...bomRow, isAvailableForNewOrders: false })

    expect(await reader.getForOrder('bom-1', scope)).toMatchObject({ isReleased: true, isAvailable: false })
  })

  it('reads only non-deleted revisions and items within the scope', async () => {
    const { reader, findOne, find } = readerReturning(bomRow)

    await reader.getForOrder('bom-1', scope)

    expect(findOne.mock.calls[0][1]).toMatchObject({ id: 'bom-1', ...scope, deletedAt: null })
    expect(find.mock.calls[0][1]).toMatchObject({ bom: 'bom-1', ...scope, deletedAt: null })
  })

  it('returns null for a missing revision without reading items', async () => {
    const { reader, find } = readerReturning(null)

    expect(await reader.getForOrder('bom-1', scope)).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })
})
