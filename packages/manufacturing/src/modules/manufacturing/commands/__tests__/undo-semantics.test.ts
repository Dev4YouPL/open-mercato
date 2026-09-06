import { ManufacturingBom, ManufacturingBomLine, ManufacturingBomRevision } from '../../data/entities'

const assertNoCandidateCycle = jest.fn(async () => {})
const restoreBomCustomFields = jest.fn(async () => {})

jest.mock('../../lib/bom/locking', () => ({
  acquireBomGraphLock: jest.fn(async () => {}),
}))
jest.mock('../../lib/bom/graph-service', () => ({
  assertNoCandidateCycle: (...args: unknown[]) => assertNoCandidateCycle(...(args as [])),
}))
jest.mock('../../lib/bom/custom-fields', () => ({
  BOM_ENTITY_ID: 'manufacturing:manufacturing_bom',
  readBomCustomFields: jest.fn(async () => ({})),
  writeBomCustomFields: jest.fn(async () => {}),
  restoreBomCustomFields: (...args: unknown[]) => restoreBomCustomFields(...(args as [])),
}))

import { createLineCommand, updateLineCommand, deleteLineCommand, reorderLineCommand } from '../bomLines'
import { createBomCommand, updateBomCommand, deleteBomCommand } from '../boms'

/**
 * Semantic undo (spec "Commands, Events, Undo, and Redo": undo "verifies
 * recorded current state, rechecks uniqueness/cycles, never overwrites later
 * edits").
 *
 * Before this pass only `reorder` compared the recorded state. Undoing a line
 * create deleted a line that had been edited since; undoing an update restored
 * the old field values over someone else's later change; and no restore path
 * re-ran cycle validation, so a revert could close a cycle that did not exist
 * when the action was recorded.
 */

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const BOM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const REVISION_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const LINE_ID = 'cccccccc-3333-4333-8333-cccccccccccc'
const ADJACENT_ID = 'dddddddd-4444-4444-8444-dddddddddddd'
const PRODUCT_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const OTHER_PRODUCT_ID = 'ffffffff-6666-4666-8666-ffffffffffff'

type AnyRecord = Record<string, unknown>

function lineRow(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: LINE_ID,
    revision: { id: REVISION_ID, bom: { id: BOM_ID } },
    componentProductId: PRODUCT_ID,
    componentVariantId: null,
    enteredQuantity: '2',
    enteredUnitCode: 'kg',
    normalizedQuantity: '2',
    normalizedUnitCode: 'kg',
    uomSnapshot: { version: 1 },
    consumptionBasis: 'variable',
    yieldFactor: '1',
    supplyMode: 'stock',
    position: '1024',
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...SCOPE,
    ...overrides,
  }
}

function snapshotFrom(row: AnyRecord): AnyRecord {
  return {
    lineId: row.id,
    revisionId: (row.revision as AnyRecord).id,
    componentProductId: row.componentProductId,
    componentVariantId: row.componentVariantId,
    enteredQuantity: row.enteredQuantity,
    enteredUnitCode: row.enteredUnitCode,
    normalizedQuantity: row.normalizedQuantity,
    normalizedUnitCode: row.normalizedUnitCode,
    uomSnapshot: row.uomSnapshot,
    consumptionBasis: row.consumptionBasis,
    yieldFactor: row.yieldFactor,
    supplyMode: row.supplyMode,
    position: String(row.position),
  }
}

function bomRow(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: BOM_ID,
    productId: PRODUCT_ID,
    variantId: null,
    nextRevisionNumber: 2,
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...SCOPE,
    ...overrides,
  }
}

function revisionRow(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: REVISION_ID,
    bom: { id: BOM_ID },
    revisionNumber: 1,
    revisionLabel: 'rev A',
    status: 'draft',
    baseOutputEnteredQuantity: '1',
    baseOutputEnteredUnitCode: 'pcs',
    baseOutputNormalizedQuantity: '1',
    baseOutputNormalizedUnitCode: 'pcs',
    baseOutputUomSnapshot: { version: 1 },
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...SCOPE,
    ...overrides,
  }
}

function bomSnapshotFrom(bom: AnyRecord, revision: AnyRecord): AnyRecord {
  return {
    bomId: bom.id,
    revisionId: revision.id,
    productId: bom.productId,
    variantId: bom.variantId,
    revisionNumber: revision.revisionNumber,
    revisionLabel: revision.revisionLabel,
    baseOutputEnteredQuantity: revision.baseOutputEnteredQuantity,
    baseOutputEnteredUnitCode: revision.baseOutputEnteredUnitCode,
    baseOutputNormalizedQuantity: revision.baseOutputNormalizedQuantity,
    baseOutputNormalizedUnitCode: revision.baseOutputNormalizedUnitCode,
    baseOutputUomSnapshot: revision.baseOutputUomSnapshot,
  }
}

type Store = { boms: AnyRecord[]; revisions: AnyRecord[]; lines: AnyRecord[] }

function makeContext(store: Store) {
  const flush = jest.fn(async () => {})
  const em: AnyRecord = {
    flush,
    getKysely: () => ({}),
    async findOne(entity: unknown, where: AnyRecord) {
      const table =
        entity === ManufacturingBom ? store.boms : entity === ManufacturingBomRevision ? store.revisions : store.lines
      return (
        table.find((row) => {
          if (typeof where.id === 'string' && row.id !== where.id) return false
          if (typeof where.bom === 'string' && (row.bom as AnyRecord | undefined)?.id !== where.bom) return false
          if (typeof where.revision === 'string' && (row.revision as AnyRecord | undefined)?.id !== where.revision) return false
          if (where.deletedAt === null && row.deletedAt !== null) return false
          return true
        }) ?? null
      )
    },
    async find(entity: unknown) {
      return entity === ManufacturingBomLine ? store.lines : []
    },
  }
  em.fork = () => em
  em.transactional = async (work: (tx: unknown) => Promise<unknown>) => work(em)

  return {
    ctx: {
      container: { resolve: () => em },
      auth: { sub: 'user-1', tenantId: SCOPE.tenantId, orgId: SCOPE.organizationId },
      selectedOrganizationId: SCOPE.organizationId,
    } as never,
    em,
    flush,
  }
}

function logEntryFor(undo: AnyRecord): AnyRecord {
  return { ...SCOPE, resourceId: BOM_ID, commandPayload: { undo } }
}

beforeEach(() => {
  assertNoCandidateCycle.mockClear()
  restoreBomCustomFields.mockClear()
})

describe('manufacturing.bom_line.create undo', () => {
  it('soft-deletes the occurrence it created when the row still carries the recorded state', async () => {
    const line = lineRow()
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await createLineCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ after: snapshotFrom(line) }) as never })

    expect(line.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses when the draft the family was created with is gone', async () => {
    const bom = bomRow()
    const after = bomSnapshotFrom(bom, revisionRow())
    const store: Store = { boms: [bom], revisions: [], lines: [] }
    const { ctx } = makeContext(store)

    await expect(
      createBomCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ after }) as never }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
    expect(bom.deletedAt).toBeNull()
  })

  it('refuses when the occurrence was edited after the action was recorded', async () => {
    const recorded = snapshotFrom(lineRow())
    const line = lineRow({ enteredQuantity: '9', normalizedQuantity: '9' })
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await expect(
      createLineCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ after: recorded }) as never }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
    expect(line.deletedAt).toBeNull()
  })
})

describe('manufacturing.bom_line.update undo', () => {
  it('restores the recorded before-state when the row still matches the recorded after-state', async () => {
    const before = snapshotFrom(lineRow({ enteredQuantity: '2', normalizedQuantity: '2' }))
    const line = lineRow({ enteredQuantity: '5', normalizedQuantity: '5' })
    const after = snapshotFrom(line)
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await updateLineCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ before, after }) as never })

    expect(line.enteredQuantity).toBe('2')
    expect(line.normalizedQuantity).toBe('2')
  })

  it('refuses rather than overwriting a later edit', async () => {
    const before = snapshotFrom(lineRow({ enteredQuantity: '2' }))
    const after = snapshotFrom(lineRow({ enteredQuantity: '5', normalizedQuantity: '5' }))
    const line = lineRow({ enteredQuantity: '7', normalizedQuantity: '7' })
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await expect(
      updateLineCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ before, after }) as never }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
    expect(line.enteredQuantity).toBe('7')
  })
})

describe('manufacturing.bom_line.delete undo', () => {
  it('re-validates the graph before bringing a produce occurrence back', async () => {
    const line = lineRow({ supplyMode: 'produce', deletedAt: new Date('2026-09-01T11:00:00.000Z') })
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await deleteLineCommand.undo!({
      input: {} as never,
      ctx,
      logEntry: logEntryFor({ before: snapshotFrom(line) }) as never,
    })

    expect(line.deletedAt).toBeNull()
    expect(assertNoCandidateCycle).toHaveBeenCalled()
  })

  it('refuses when the soft-deleted row no longer matches what was recorded', async () => {
    const recorded = snapshotFrom(lineRow({ componentProductId: PRODUCT_ID }))
    const line = lineRow({
      componentProductId: OTHER_PRODUCT_ID,
      deletedAt: new Date('2026-09-01T11:00:00.000Z'),
    })
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line] }
    const { ctx } = makeContext(store)

    await expect(
      deleteLineCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ before: recorded }) as never }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
    expect(line.deletedAt).toBeInstanceOf(Date)
  })
})

describe('manufacturing.bom_line.reorder undo', () => {
  it('refuses instead of silently doing nothing when the order changed since', async () => {
    const line = lineRow({ position: '4096' })
    const adjacent = lineRow({ id: ADJACENT_ID, position: '2048' })
    const store: Store = { boms: [bomRow()], revisions: [revisionRow()], lines: [line, adjacent] }
    const { ctx } = makeContext(store)

    await expect(
      reorderLineCommand.undo!({
        input: {} as never,
        ctx,
        logEntry: logEntryFor({
          lineId: LINE_ID,
          adjacentLineId: ADJACENT_ID,
          linePosition: '1024',
          adjacentPosition: '2048',
        }) as never,
      }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
  })
})

describe('manufacturing.bom.update undo', () => {
  it('refuses when the draft changed since, and leaves the custom fields alone', async () => {
    const bom = bomRow()
    const revision = revisionRow({ revisionLabel: 'edited by someone else' })
    const after = bomSnapshotFrom(bomRow(), revisionRow({ revisionLabel: 'rev B' }))
    const before = bomSnapshotFrom(bomRow(), revisionRow())
    const store: Store = { boms: [bom], revisions: [revision], lines: [] }
    const { ctx } = makeContext(store)

    await expect(
      updateBomCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ before, after }) as never }),
    ).rejects.toMatchObject({ code: 'bom.version_conflict' })
    expect(restoreBomCustomFields).not.toHaveBeenCalled()
  })

  it('reverts the custom fields only after the domain revert has committed', async () => {
    const bom = bomRow()
    const revision = revisionRow({ revisionLabel: 'rev B' })
    const after = bomSnapshotFrom(bomRow(), revisionRow({ revisionLabel: 'rev B' }))
    const before = bomSnapshotFrom(bomRow(), revisionRow({ revisionLabel: 'rev A' }))
    const store: Store = { boms: [bom], revisions: [revision], lines: [] }
    const { ctx } = makeContext(store)

    await updateBomCommand.undo!({ input: {} as never, ctx, logEntry: logEntryFor({ before, after }) as never })

    expect(revision.revisionLabel).toBe('rev A')
    expect(restoreBomCustomFields).toHaveBeenCalledTimes(1)
  })
})

describe('manufacturing.bom.delete undo', () => {
  it('re-validates the graph after restoring the family', async () => {
    const markedAt = new Date('2026-09-01T11:00:00.000Z')
    const bom = bomRow({ deletedAt: markedAt })
    const revision = revisionRow({ deletedAt: markedAt })
    const line = lineRow({ deletedAt: markedAt })
    const store: Store = { boms: [bom], revisions: [revision], lines: [line] }
    const { ctx } = makeContext(store)

    await deleteBomCommand.undo!({
      input: {} as never,
      ctx,
      logEntry: logEntryFor({
        after: { bomId: BOM_ID, revisionId: REVISION_ID, deletedAt: markedAt.toISOString(), ...SCOPE },
      }) as never,
    })

    expect(bom.deletedAt).toBeNull()
    expect(line.deletedAt).toBeNull()
    expect(assertNoCandidateCycle).toHaveBeenCalled()
  })
})
