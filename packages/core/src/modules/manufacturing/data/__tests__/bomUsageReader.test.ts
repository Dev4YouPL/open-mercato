import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadBomFamilyUsages, lockBomFamilies, assertReadCommitted } from '../bomUsageReader'
import { ProductionOrder } from '../entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const scope = { tenantId: 'tenant', organizationId: 'org' }

describe('BOM usage reader', () => {
  it('locks deduplicated family keys in stable order and requires a transaction', async () => {
    const execute = jest.fn().mockResolvedValue(undefined)
    const em = { isInTransaction: jest.fn(() => true), execute } as unknown as EntityManager
    await lockBomFamilies(em, scope, ['B', 'a', 'B'])
    expect(execute.mock.calls.map((call) => call[1]?.[0])).toEqual([
      'manufacturing.bom_family:tenant:org:a',
      'manufacturing.bom_family:tenant:org:b',
    ])
    const outsideTransaction = { isInTransaction: () => false } as unknown as EntityManager
    await expect(lockBomFamilies(outsideTransaction, scope, ['a'])).rejects.toThrow('open transaction')
  })

  it('counts soft-deleted orders and maps revision numbers without a soft-delete filter', async () => {
    jest.mocked(findWithDecryption).mockResolvedValue([{
      id: 'order-id', bomRevisionId: 'bom-id', orderNumber: 'MO-1', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }] as never)
    const result = await loadBomFamilyUsages({} as EntityManager, scope, 'variant', new Map([['bom-id', '3']]))
    expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), ProductionOrder, {
      tenantId: 'tenant', organizationId: 'org', bomRevisionId: { $in: ['bom-id'] },
    }, expect.objectContaining({ refresh: true }), scope)
    expect(result[0]).toMatchObject({ bomId: 'bom-id', revision: '3', sourceNumber: 'MO-1', sourceKind: 'production_order' })
  })

  it('only accepts READ COMMITTED isolation', async () => {
    await expect(assertReadCommitted({ execute: async () => [{ level: 'read committed' }] } as unknown as EntityManager)).resolves.toBeUndefined()
    await expect(assertReadCommitted({ execute: async () => [{ level: 'serializable' }] } as unknown as EntityManager)).rejects.toThrow('READ COMMITTED')
  })
})
