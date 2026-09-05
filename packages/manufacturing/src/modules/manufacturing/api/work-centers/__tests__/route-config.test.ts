import fs from 'node:fs'
import path from 'node:path'

const ROUTE_FILE = path.join(__dirname, '..', 'route.ts')
const source = fs.readFileSync(ROUTE_FILE, 'utf8')

/**
 * The CRUD route is configuration, and several of its contract points are
 * invisible to a type check: which sort keys exist, that list caching is off,
 * that the GET lifecycle is exported rather than wrapped, and that `mapInput`
 * keeps the root id so the factory's row guards still run. These assert the
 * configuration itself.
 */
describe('Work Centre CRUD route configuration', () => {
  it('exports the factory GET directly rather than wrapping its Response', () => {
    expect(source).toContain('export const GET = crud.GET')
    expect(source).not.toMatch(/export\s+async\s+function\s+GET/)
  })

  it('exports the remaining verbs from the same factory', () => {
    expect(source).toContain('export const POST = crud.POST')
    expect(source).toContain('export const PUT = crud.PUT')
    expect(source).toContain('export const DELETE = crud.DELETE')
  })

  it('gates GET on view and every write on manage', () => {
    expect(source).toContain("GET: { requireAuth: true, requireFeatures: ['manufacturing.work_center.view'] }")
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(source).toContain(`${method}: { requireAuth: true, requireFeatures: ['manufacturing.work_center.manage'] }`)
    }
  })

  it('disables list caching for the enriched contract', () => {
    expect(source).toContain('disableListCache: true')
  })

  it('declares a stable default sort with an id tiebreaker', () => {
    expect(source).toContain("defaultSort: { field: F.code, dir: 'asc' }")
    expect(source).toContain('tiebreakSortField: F.id')
  })

  it('maps every sortable accessor and leaves resourceCount out', () => {
    const map = source.slice(source.indexOf('sortFieldMap: {'), source.indexOf('// Primary keys'))
    for (const key of ['code:', 'name:', 'createdAt:', 'isActive:', 'updatedAt:']) {
      expect(map).toContain(key)
    }
    expect(map).not.toContain('resourceCount')
  })

  it('uses the undefined-returning boolean parser for the activity filter', () => {
    // Regression: `parseBooleanToken` returns null for an absent value, and
    // `null !== undefined`, so the guard applied `is_active IS NULL` to every
    // unfiltered list request and returned nothing.
    expect(source).toContain('parseBooleanFlag(query.isActive)')
    expect(source).not.toContain('parseBooleanToken(query.isActive)')
  })

  it('applies no activity filter unless the caller asked for one', () => {
    const filters = source.slice(source.indexOf('buildFilters:'), source.indexOf('transformItem:'))
    expect(filters).toContain('if (isActive !== undefined) filters[F.is_active] = isActive')
  })

  it('routes writes to the exact command ids', () => {
    expect(source).toContain("commandId: 'manufacturing.work_center.create'")
    expect(source).toContain("commandId: 'manufacturing.work_center.update'")
    expect(source).toContain("commandId: 'manufacturing.work_center.delete'")
  })

  it('keeps the root id in update mapInput instead of the child-aggregate wrapper', () => {
    const updateAction = source
      .slice(source.indexOf('update: {'), source.indexOf('delete: {'))
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '')
    expect(updateAction).toContain('updateWorkCenterSchema')
    // The schema carries a required root `id`, so the factory can resolve the
    // candidate row it guards.
    expect(updateAction).not.toContain('{ body }')
  })

  it('declares the indexer with the canonical entity id and no cache aliases', () => {
    expect(source).toContain('indexer: { entityType: WORK_CENTER_ENTITY_ID, cacheAliases: [] }')
  })

  it('never adds a parallel detail route', () => {
    const routeDir = path.join(__dirname, '..')
    const nested = fs
      .readdirSync(routeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    expect(nested).toEqual([])
  })

  it('does not import a resources or planner ORM entity', () => {
    expect(source).not.toContain('ResourcesResource')
    expect(source).not.toMatch(/from '@open-mercato\/core\/modules\/(resources|planner)/)
  })
})

describe('Work Centre response mapping', () => {
  it('maps scalars to camelCase synchronously and defers membership to afterList', () => {
    const transform = source.slice(source.indexOf('transformItem:'), source.indexOf('hooks: {'))
    expect(transform).toContain('isActive: item.is_active')
    expect(transform).toContain('updatedAt: item.updated_at')
    expect(transform).not.toContain('await')
    expect(transform).not.toContain('resourceIds')
  })

  it('adds membership in afterList and skips the query for an empty page', () => {
    const hook = source.slice(source.indexOf('afterList: async'), source.indexOf('actions: {'))
    expect(hook).toContain('if (items.length === 0) return')
    expect(hook).toContain('loadMembershipByWorkCenter')
    expect(hook).toContain('resourceCount')
    // One batch call for the whole page, never one per row.
    expect(hook.match(/loadMembershipByWorkCenter/g)).toHaveLength(1)
  })

  it('scopes membership by the organization set the parent query used', () => {
    // Regression: pinning a single selected organization blanked every row's
    // membership in all-organizations mode, where `selectedId`/`orgId` are null.
    const hook = source.slice(source.indexOf('afterList: async'), source.indexOf('actions: {'))
    expect(hook).toContain('organizationIds')
    expect(hook).toContain('{ tenantId, organizationIds }')
    // It must never substitute an empty membership set as a fallback.
    expect(hook).not.toContain('item.resourceIds = []')
  })

  it('never drops updatedAt from the public contract', () => {
    expect(source).toContain('updatedAt: item.updated_at')
  })
})
