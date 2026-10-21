import { decideBomDeletion, decideRevisionDeletion } from '../bomDeletion'
import type { BomRevisionUsageFact } from '../bomDeletion'

const usage = (bomId: string, day: number): BomRevisionUsageFact => ({
  bomId,
  revision: '1',
  sourceKind: 'production_order',
  sourceId: `order-${day}`,
  sourceNumber: `MO-${day}`,
  firstUsedAt: new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`),
})

describe('BOM deletion decisions', () => {
  it('allows an unused revision and a never-used draft in a used family', () => {
    expect(decideRevisionDeletion({ id: 'draft', revision: '2', status: 'draft' }, [usage('released', 2)])).toEqual({ status: 'allowed' })
    expect(decideRevisionDeletion({ id: 'unused', revision: '1', status: 'released' }, [])).toEqual({ status: 'allowed' })
  })

  it('blocks direct uses separately from family use and sorts the evidence', () => {
    const decision = decideRevisionDeletion({ id: 'used', revision: '1', status: 'released' }, [usage('used', 2), usage('used', 1)])
    expect(decision.status).toBe('blocked')
    if (decision.status !== 'blocked') return
    expect(decision.reason).toBe('revision_used')
    expect(decision.usages.map((item) => item.sourceId)).toEqual(['order-1', 'order-2'])
  })

  it('blocks an unused released revision and whole family after any family use', () => {
    expect(decideRevisionDeletion({ id: 'other', revision: '2', status: 'released' }, [usage('used', 1)])).toMatchObject({ status: 'blocked', reason: 'bom_used' })
    expect(decideBomDeletion([])).toEqual({ status: 'allowed' })
    expect(decideBomDeletion([usage('used', 1)])).toMatchObject({ status: 'blocked', reason: 'bom_used' })
  })
})
