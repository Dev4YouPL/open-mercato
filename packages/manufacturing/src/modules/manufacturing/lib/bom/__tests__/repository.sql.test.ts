import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { loadDirectLineSummaries, listActiveDrafts } from '../repository'

/**
 * The BOM read paths build their queries through Kysely, and this package ships
 * no PostgreSQL test, so a malformed query would pass every mocked suite and
 * only fail in a running app.
 *
 * These cases run the real query builder against Kysely's `DummyDriver`, which
 * compiles SQL without connecting to anything: a bad column, a mistyped
 * operator or an unsupported builder form fails here, and the compiled text is
 * asserted so a silently dropped `where` cannot pass either. It does not
 * replace an integration test against a real schema — it closes the narrower
 * gap of queries that are never compiled at all.
 */

type CompiledQuery = { sql: string; parameters: readonly unknown[] }

function createRecordingEm() {
  const compiled: CompiledQuery[] = []
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  const recording = new Proxy(db, {
    get(target, property) {
      if (property !== 'selectFrom') return Reflect.get(target, property)
      return (...args: unknown[]) => {
        const builder = (target as any).selectFrom(...args)
        return new Proxy(builder, {
          get(builderTarget, builderProperty) {
            if (builderProperty !== 'execute') {
              const value = Reflect.get(builderTarget, builderProperty)
              if (typeof value !== 'function') return value
              return (...builderArgs: unknown[]) => {
                const next = value.apply(builderTarget, builderArgs)
                return next && typeof next === 'object' && 'execute' in next
                  ? new Proxy(next, this as ProxyHandler<object>)
                  : next
              }
            }
            return async () => {
              compiled.push((builderTarget as any).compile())
              return []
            }
          },
        })
      }
    },
  })

  const em = {
    getKysely: () => recording,
    find: async () => [],
    map: (_entity: unknown, data: unknown) => data,
  }
  return { em: em as never, compiled }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const REVISION_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

describe('loadDirectLineSummaries SQL', () => {
  it('compiles a scoped grouped count and a scoped produce-occurrence read', async () => {
    const { em, compiled } = createRecordingEm()

    await loadDirectLineSummaries(em, { ...SCOPE, revisionIds: [REVISION_ID] })

    expect(compiled).toHaveLength(2)

    const [counts, produce] = compiled
    expect(counts.sql).toContain('from "manufacturing_bom_lines"')
    expect(counts.sql).toContain('count(*)')
    expect(counts.sql).toContain('group by "revision_id"')
    expect(counts.sql).toContain('"tenant_id" =')
    expect(counts.sql).toContain('"organization_id" =')
    expect(counts.sql).toContain('"deleted_at" is null')
    expect(counts.parameters).toEqual([SCOPE.tenantId, SCOPE.organizationId, REVISION_ID])

    expect(produce.sql).toContain('select "revision_id", "component_product_id", "component_variant_id"')
    expect(produce.sql).toContain('"supply_mode" =')
    expect(produce.sql).toContain('"deleted_at" is null')
    expect(produce.parameters).toEqual([SCOPE.tenantId, SCOPE.organizationId, REVISION_ID, 'produce'])
  })
})

describe('listActiveDrafts SQL', () => {
  it('compiles a tenant- and organization-scoped keyset page over live drafts', async () => {
    const { em, compiled } = createRecordingEm()

    await listActiveDrafts(em, { ...SCOPE, limit: 25 })

    const page = compiled[0]
    expect(page.sql).toContain('from "manufacturing_boms" as "b"')
    expect(page.sql).toContain('inner join "manufacturing_bom_revisions" as "r"')
    expect(page.sql).toContain('order by "b"."updated_at" desc, "b"."id" desc')
    expect(page.sql).toContain('limit')
    expect(page.parameters).toContain(SCOPE.tenantId)
    expect(page.parameters).toContain(SCOPE.organizationId)
  })

  it('narrows by product and variant when those filters are supplied', async () => {
    const { em, compiled } = createRecordingEm()

    await listActiveDrafts(em, { ...SCOPE, limit: 25, productId: 'product-1', variantId: 'variant-1' })

    expect(compiled[0].sql).toContain('"b"."product_id" =')
    expect(compiled[0].sql).toContain('"b"."variant_id" =')
    expect(compiled[0].parameters).toContain('product-1')
    expect(compiled[0].parameters).toContain('variant-1')
  })
})
