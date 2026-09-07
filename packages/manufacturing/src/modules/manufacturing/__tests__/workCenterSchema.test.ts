import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SNAPSHOT = path.join(MIGRATIONS_DIR, '.snapshot-open-mercato.json')

function readWorkCenterMigration(): string {
  const file = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))
    .find((entry) => entry.source.includes('manufacturing_work_centers'))
  if (!file) throw new Error('[internal] no migration creates the Work Centre tables')
  return file.source
}

const migration = readWorkCenterMigration()
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) as {
  tables: Array<{ name: string; indexes?: Array<{ keyName?: string }>; columns?: Record<string, unknown> }>
}
const tableNames = snapshot.tables.map((table) => table.name)

describe('Work Centre migration', () => {
  it('creates both additive tables', () => {
    expect(migration).toContain('create table "manufacturing_work_centers"')
    expect(migration).toContain('create table "manufacturing_work_center_resources"')
  })

  it('enforces case-insensitive code uniqueness only over live rows', () => {
    expect(migration).toContain(
      'create unique index "manufacturing_work_centers_code_unique_idx" on "manufacturing_work_centers" ("tenant_id", "organization_id", lower("code")) where "deleted_at" is null',
    )
  })

  it('indexes the tenant/organization scope', () => {
    expect(migration).toContain(
      'create index "manufacturing_work_centers_scope_idx" on "manufacturing_work_centers" ("tenant_id", "organization_id")',
    )
  })

  it('makes membership unique per parent and scope', () => {
    expect(migration).toContain(
      'create unique index "manufacturing_work_center_resources_unique_idx" on "manufacturing_work_center_resources" ("tenant_id", "organization_id", "work_center_id", "resource_id")',
    )
  })

  it('binds membership to a parent in the same scope through a composite foreign key', () => {
    expect(migration).toContain(
      'foreign key ("work_center_id", "tenant_id", "organization_id") references "manufacturing_work_centers" ("id", "tenant_id", "organization_id")',
    )
  })

  it('backs that composite key with a matching parent unique index', () => {
    expect(migration).toContain(
      'create unique index "manufacturing_work_centers_scope_unique_idx" on "manufacturing_work_centers" ("id", "tenant_id", "organization_id")',
    )
  })

  it('creates no foreign key into the resources module', () => {
    expect(migration).not.toContain('references "resources_resources"')
    expect(migration).not.toMatch(/references "resources_/)
  })

  it('touches no table outside the Work Centre aggregate', () => {
    const created = Array.from(migration.matchAll(/create table "(\w+)"/g)).map((match) => match[1])
    expect(created.sort()).toEqual(['manufacturing_work_center_resources', 'manufacturing_work_centers'])
    expect(migration).not.toContain('alter table "manufacturing_boms"')
    expect(migration).not.toContain('alter table "manufacturing_bom_lines"')
  })

  it('drops both new tables on rollback and nothing else', () => {
    const down = migration.slice(migration.indexOf('override down'))
    expect(down).toContain('drop table if exists "manufacturing_work_center_resources" cascade')
    expect(down).toContain('drop table if exists "manufacturing_work_centers" cascade')
    expect(down).not.toContain('manufacturing_boms')
  })
})

describe('Work Centre schema snapshot', () => {
  it('records both new tables', () => {
    expect(tableNames).toEqual(expect.arrayContaining(['manufacturing_work_centers', 'manufacturing_work_center_resources']))
  })

  it('keeps the existing BOM tables', () => {
    expect(tableNames).toEqual(
      expect.arrayContaining(['manufacturing_boms', 'manufacturing_bom_revisions', 'manufacturing_bom_lines']),
    )
  })

  it('gives the parent an updated_at optimistic-lock column and a soft-delete marker', () => {
    const parent = snapshot.tables.find((table) => table.name === 'manufacturing_work_centers')
    expect(Object.keys(parent?.columns ?? {})).toEqual(
      expect.arrayContaining(['id', 'tenant_id', 'organization_id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at', 'deleted_at']),
    )
  })

  it('stores resource_id as a scalar column on the membership table', () => {
    const membership = snapshot.tables.find((table) => table.name === 'manufacturing_work_center_resources')
    expect(Object.keys(membership?.columns ?? {})).toEqual(
      expect.arrayContaining(['work_center_id', 'resource_id', 'tenant_id', 'organization_id']),
    )
  })
})
