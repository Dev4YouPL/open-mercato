import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { calculateStockAdjustment, chooseDemoOrderNumber, ensureAutoSupplyProposalToggle } from '../setup'

describe('supplier demo stock reconciliation', () => {
  it('sets an empty balance to exactly 1000', () => {
    expect(calculateStockAdjustment(0)).toBe(1000)
  })

  it('does not increase a balance that is already at the target', () => {
    expect(calculateStockAdjustment(1000)).toBe(0)
  })

  it('reconciles drift instead of adding another 1000 units', () => {
    expect(calculateStockAdjustment(900)).toBe(100)
    expect(calculateStockAdjustment(1200)).toBe(-200)
  })

  it('chooses the base order number when no historical row exists', () => {
    expect(chooseDemoOrderNumber('SO-441', [], [])).toBe('SO-441')
  })

  it('uses the next suffix after canceled demo orders and reuses an active suffix', () => {
    expect(chooseDemoOrderNumber('SO-441', ['SO-441'], [])).toBe('SO-441-1')
    expect(chooseDemoOrderNumber('SO-441', ['SO-441', 'SO-441-1'], [])).toBe('SO-441-2')
    expect(chooseDemoOrderNumber('SO-441', ['SO-441', 'SO-441-1'], ['SO-441-1'])).toBe('SO-441-1')
  })

  it('creates the automatic proposal toggle idempotently', async () => {
    const findOne = jest.fn<() => Promise<{ deletedAt: Date | null } | null>>()
    findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ deletedAt: null })
    const create = jest.fn<(entity: unknown, input: unknown) => unknown>((_entity, input) => input)
    const persist = jest.fn<(entity: unknown) => void>()
    const flush = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const em = {
      findOne,
      create,
      persist,
      flush,
    } as unknown as EntityManager

    await ensureAutoSupplyProposalToggle(em)
    await ensureAutoSupplyProposalToggle(em)

    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
