import { reorderLineCommand } from '../bomLines'
import type { ManufacturingBomLine, ManufacturingBomRevision } from '../../data/entities'

/**
 * Regression: `POST /api/manufacturing/boms/{id}/lines/{lineId}/reorder`
 * returned 500 for every swap. `position` is a Postgres `bigint`, and the
 * previous mapping hydrated it as a native JS BigInt, so persisting the
 * command's action log threw:
 *
 *   TypeError: Do not know how to serialize a BigInt
 *
 * The domain transaction had already committed at that point, so the caller
 * saw a failure for a mutation that had actually been applied — and no undo
 * entry was recorded. `data/entities.ts` now reads the column back as a
 * string, and the log payload stringifies defensively.
 */
describe('reorderLineCommand.buildLog', () => {
  const line = { id: 'a0c3a2f2-6f4c-4a9d-9a53-1b4b7f0f3f01', position: 2048n, tenantId: 't', organizationId: 'o' }
  const adjacent = { id: 'b1d4b3e3-7a5d-4b0e-8b64-2c5c8a1a4a12', position: 1024n }
  const revision = { bom: { id: 'c2e5c4f4-8b6e-4c1f-9c75-3d6d9b2b5b23' } }

  function buildLogFor(changed: boolean) {
    return reorderLineCommand.buildLog?.({
      input: {} as never,
      result: {
        line: line as unknown as ManufacturingBomLine,
        adjacentLine: changed ? (adjacent as unknown as ManufacturingBomLine) : null,
        revision: revision as unknown as ManufacturingBomRevision,
        changed,
      },
      ctx: { auth: null } as never,
    } as never)
  }

  it('produces a JSON-serialisable payload even when positions arrive as BigInt', () => {
    const log = buildLogFor(true)
    expect(log).not.toBeNull()
    expect(() => JSON.stringify(log)).not.toThrow()
    expect(JSON.parse(JSON.stringify(log)).payload.undo).toEqual({
      lineId: line.id,
      adjacentLineId: adjacent.id,
      linePosition: '2048',
      adjacentPosition: '1024',
    })
  })

  it('logs against the BOM aggregate root so undo ordering stays aggregate-safe', () => {
    const log = buildLogFor(true)
    expect(log?.resourceKind).toBe('manufacturing.bom')
    expect(log?.resourceId).toBe(revision.bom.id)
    expect(log?.relatedResourceKind).toBe('manufacturing.bom_line')
  })

  it('records no undoable action for a boundary no-op', () => {
    expect(buildLogFor(false)).toBeNull()
  })
})
