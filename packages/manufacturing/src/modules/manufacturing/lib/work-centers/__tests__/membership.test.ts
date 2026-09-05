import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import {
  assertMembershipLimit,
  isSameMembership,
  normalizeAndAssertResourceIds,
  normalizeResourceIds,
} from '../membership'
import { WorkCenterDomainError } from '../errors'
import { buildCodeAvailabilityQuery } from '../repository'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('membership normalization', () => {
  it('de-duplicates and sorts deterministically', () => {
    expect(normalizeResourceIds([id(3), id(1), id(3), id(2)])).toEqual([id(1), id(2), id(3)])
  })

  it('produces the same order regardless of input order', () => {
    const forwards = normalizeResourceIds([id(1), id(2), id(3)])
    const backwards = normalizeResourceIds([id(3), id(2), id(1)])
    expect(forwards).toEqual(backwards)
  })

  it('drops blank entries', () => {
    expect(normalizeResourceIds([id(1), '', '   '])).toEqual([id(1)])
  })

  it('accepts exactly 100 ids', () => {
    const ids = Array.from({ length: 100 }, (_, index) => id(index))
    expect(normalizeAndAssertResourceIds(ids)).toHaveLength(100)
  })

  it('rejects 101 normalized ids with the stable code', () => {
    const ids = Array.from({ length: 101 }, (_, index) => id(index))
    expect(() => assertMembershipLimit(ids)).toThrow(WorkCenterDomainError)
    try {
      assertMembershipLimit(ids)
    } catch (error) {
      expect((error as WorkCenterDomainError).code).toBe('resource_membership_limit_exceeded')
      expect((error as WorkCenterDomainError).status).toBe(422)
    }
  })

  it('applies the limit after de-duplication, not before', () => {
    const duplicated = Array.from({ length: 200 }, (_, index) => id(index % 100))
    expect(normalizeAndAssertResourceIds(duplicated)).toHaveLength(100)
  })
})

describe('membership equality', () => {
  it('treats a reordered duplicate-laden input as unchanged once normalized', () => {
    const stored = normalizeResourceIds([id(1), id(2)])
    const incoming = normalizeResourceIds([id(2), id(1), id(1)])
    expect(isSameMembership(stored, incoming)).toBe(true)
  })

  it('detects a removal-only change', () => {
    expect(isSameMembership([id(1), id(2)], [id(1)])).toBe(false)
  })

  it('detects clearing the whole set', () => {
    expect(isSameMembership([id(1)], [])).toBe(false)
  })

  it('treats two empty sets as unchanged', () => {
    expect(isSameMembership([], [])).toBe(true)
  })
})

describe('code uniqueness SQL shape', () => {
  const scope = { tenantId: 't-1', organizationId: 'o-1' }

  // Compiled against Kysely's DummyDriver: real SQL text, no connection. A
  // dropped predicate or an unsupported builder form fails here instead of only
  // in a running app.
  const compiler = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  const compile = (code: string, excludeId: string | null) =>
    buildCodeAvailabilityQuery(scope, code, excludeId).compile(compiler)

  it('preserves the partial index predicate and case-insensitive comparison', () => {
    const sql = compile('WC-1', null).sql.replace(/\s+/g, ' ')
    expect(sql).toContain('lower("code") = lower(')
    expect(sql).toContain('"deleted_at" is null')
    expect(sql).toContain('"tenant_id" =')
    expect(sql).toContain('"organization_id" =')
  })

  it('never targets the partial index with ON CONFLICT ON CONSTRAINT', () => {
    expect(compile('WC-1', 'wc-1').sql.toLowerCase()).not.toContain('on conflict')
  })

  it('excludes the record being updated when an id is supplied', () => {
    const compiled = compile('WC-1', 'wc-1')
    expect(compiled.sql.replace(/\s+/g, ' ')).toContain('"id" <>')
    expect(compiled.parameters).toContain('wc-1')
  })

  it('omits the exclusion clause on create', () => {
    expect(compile('WC-1', null).sql).not.toContain('<>')
  })
})
