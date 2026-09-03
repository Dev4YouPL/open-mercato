import { ManufacturingBom, ManufacturingBomLine, ManufacturingBomRevision } from '../../../data/entities'
import { loadDirectLineSummaries, listActiveDrafts } from '../repository'
import { resolveComponentTargets, componentTargetKey } from '../target-resolution'
import { encodeBomCursor } from '../cursor'

/**
 * Two listing defects the P1.4a review found:
 *
 * - `unresolvedProduceCount` counted every `produce` occurrence rather than
 *   the ones whose component resolves to no live child BOM, so correctly
 *   resolved dependencies were reported to the operator as warnings.
 * - The list ran two counts per row and resolved a child family per line,
 *   which is up to 201 queries for a full page of 100.
 */

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const REVISION_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const RESOLVED_PRODUCT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const ORPHAN_PRODUCT = 'cccccccc-3333-4333-8333-cccccccccccc'
const CHILD_BOM = 'dddddddd-4444-4444-8444-dddddddddddd'
const CHILD_REVISION = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'

type AnyRecord = Record<string, unknown>

function makeEm(options: {
  counts?: Array<{ revision_id: string; count: number }>
  lines?: AnyRecord[]
  families?: AnyRecord[]
  drafts?: AnyRecord[]
  rows?: AnyRecord[]
}) {
  const kyselyCalls: string[] = []
  const findCalls: string[] = []

  const builder = (table: string): AnyRecord => {
    const self: AnyRecord = {}
    for (const method of ['innerJoin', 'select', 'where', 'orderBy', 'groupBy', 'limit']) {
      self[method] = () => self
    }
    self.execute = async () => (table === 'counts' ? (options.counts ?? []) : (options.rows ?? []))
    return self
  }

  const em: AnyRecord = {
    getKysely: () => ({
      selectFrom: (from: string) => {
        kyselyCalls.push(from)
        return builder(from.includes(' as b') ? 'rows' : 'counts')
      },
    }),
    async find(entity: unknown) {
      if (entity === ManufacturingBomLine) {
        findCalls.push('lines')
        return options.lines ?? []
      }
      if (entity === ManufacturingBom) {
        findCalls.push('families')
        return options.families ?? []
      }
      if (entity === ManufacturingBomRevision) {
        findCalls.push('drafts')
        return options.drafts ?? []
      }
      return []
    },
    map: (_entity: unknown, data: AnyRecord) => data,
  }
  return { em: em as never, kyselyCalls, findCalls }
}

function produceLine(revisionId: string, componentProductId: string, componentVariantId: string | null = null): AnyRecord {
  return {
    id: `line-${componentProductId}-${revisionId}`,
    revision: { id: revisionId },
    componentProductId,
    componentVariantId,
    supplyMode: 'produce',
  }
}

describe('resolveComponentTargets', () => {
  it('resolves variant-first, then product fallback, and reports the rest as unresolved', async () => {
    const { em, findCalls } = makeEm({
      families: [
        { id: CHILD_BOM, productId: RESOLVED_PRODUCT, variantId: null },
        { id: 'variant-bom', productId: RESOLVED_PRODUCT, variantId: 'variant-1' },
      ],
      drafts: [
        { id: CHILD_REVISION, bom: { id: CHILD_BOM } },
        { id: 'variant-revision', bom: { id: 'variant-bom' } },
      ],
    })

    const resolved = await resolveComponentTargets(em, {
      ...SCOPE,
      targets: [
        { componentProductId: RESOLVED_PRODUCT, componentVariantId: 'variant-1' },
        { componentProductId: RESOLVED_PRODUCT, componentVariantId: null },
        { componentProductId: ORPHAN_PRODUCT, componentVariantId: null },
      ],
    })

    expect(resolved.get(componentTargetKey({ componentProductId: RESOLVED_PRODUCT, componentVariantId: 'variant-1' }))).toEqual({
      state: 'variant',
      childBomId: 'variant-bom',
      childRevisionId: 'variant-revision',
    })
    expect(resolved.get(componentTargetKey({ componentProductId: RESOLVED_PRODUCT, componentVariantId: null }))).toEqual({
      state: 'product_fallback',
      childBomId: CHILD_BOM,
      childRevisionId: CHILD_REVISION,
    })
    expect(resolved.get(componentTargetKey({ componentProductId: ORPHAN_PRODUCT, componentVariantId: null }))).toEqual({
      state: 'unresolved',
    })
    expect(findCalls).toEqual(['families', 'drafts'])
  })

  it('costs the same two reads whatever the page size', async () => {
    const { em, findCalls } = makeEm({ families: [], drafts: [] })
    const targets = Array.from({ length: 100 }, (_, index) => ({
      componentProductId: `product-${index}`,
      componentVariantId: null,
    }))

    await resolveComponentTargets(em, { ...SCOPE, targets })

    expect(findCalls).toEqual(['families'])
  })
})

describe('loadDirectLineSummaries', () => {
  it('counts only the produce occurrences whose component resolves to nothing', async () => {
    const { em } = makeEm({
      counts: [{ revision_id: REVISION_A, count: 4 }],
      lines: [produceLine(REVISION_A, RESOLVED_PRODUCT), produceLine(REVISION_A, ORPHAN_PRODUCT)],
      families: [{ id: CHILD_BOM, productId: RESOLVED_PRODUCT, variantId: null }],
      drafts: [{ id: CHILD_REVISION, bom: { id: CHILD_BOM } }],
    })

    const summaries = await loadDirectLineSummaries(em, { ...SCOPE, revisionIds: [REVISION_A] })

    expect(summaries.get(REVISION_A)).toEqual({ count: 4, unresolvedProduceCount: 1 })
  })

  it('reports an empty summary for a draft with no lines without querying further', async () => {
    const { em, findCalls } = makeEm({ counts: [], lines: [] })

    const summaries = await loadDirectLineSummaries(em, { ...SCOPE, revisionIds: [REVISION_A] })

    expect(summaries.get(REVISION_A)).toEqual({ count: 0, unresolvedProduceCount: 0 })
    expect(findCalls).toEqual(['lines'])
  })
})

describe('listActiveDrafts cursor handling', () => {
  it('rejects a cursor minted for another page size instead of returning an empty page', async () => {
    const { em } = makeEm({ rows: [] })
    const cursorToken = encodeBomCursor({
      updatedAt: new Date('2026-09-01T10:00:00.000Z').toISOString(),
      id: CHILD_BOM,
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      pageSize: 25,
      filterDigest: 'x',
    })

    const page = await listActiveDrafts(em, { ...SCOPE, limit: 50, cursorToken })

    expect(page.staleCursor).toBe(true)
    expect(page.items).toEqual([])
  })

  it('rejects a malformed cursor', async () => {
    const { em } = makeEm({ rows: [] })

    const page = await listActiveDrafts(em, { ...SCOPE, limit: 25, cursorToken: 'not-a-cursor' })

    expect(page.staleCursor).toBe(true)
  })

  it('reports the end of the results as a normal page, not a stale cursor', async () => {
    const { em } = makeEm({ rows: [] })

    const page = await listActiveDrafts(em, { ...SCOPE, limit: 25 })

    expect(page).toMatchObject({ items: [], hasMore: false, nextCursor: null, staleCursor: false })
  })
})
