import fs from 'node:fs'
import path from 'node:path'
import { metadata } from '../index'

const MODULE_ROOT = path.join(__dirname, '..')

function collectSources(dir: string, acc: Array<{ file: string; source: string }> = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__integration__' || entry.name === 'node_modules') continue
      collectSources(full, acc)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    acc.push({ file: path.relative(MODULE_ROOT, full), source: fs.readFileSync(full, 'utf8') })
  }
  return acc
}

const sources = collectSources(MODULE_ROOT)
const workCentreSources = sources.filter(
  ({ file }) => /work-centers?/i.test(file) || /WorkCenter/.test(file),
)

describe('Work Centre module dependencies', () => {
  it('keeps catalog as the only hard runtime module requirement', () => {
    expect(metadata.requires).toEqual(['catalog'])
  })

  it('never adds resources, planner or WMS as a required module', () => {
    for (const optional of ['resources', 'planner', 'wms']) {
      expect(metadata.requires ?? []).not.toContain(optional)
    }
  })
})

describe('Work Centre cross-module boundaries', () => {
  it('covers the Work Centre sources it claims to check', () => {
    expect(workCentreSources.length).toBeGreaterThan(8)
  })

  it('imports no resources, planner or WMS ORM entity anywhere in the module', () => {
    const offenders = sources.filter(({ source }) =>
      /from ['"]@open-mercato\/core\/modules\/(resources|planner|wms)\/data\//.test(source) ||
      /\bResourcesResource\b/.test(source) ||
      /\bPlannerAvailability/.test(source),
    )
    expect(offenders.map(({ file }) => file)).toEqual([])
  })

  it('reaches the resources peer only through its public API or the query engine', () => {
    const readers = workCentreSources.filter(({ source }) => source.includes('resources'))
    for (const { file, source } of readers) {
      const usesPublicSurface =
        source.includes('/api/resources/resources') ||
        source.includes('resources:resources_resource') ||
        source.includes('resources.view') ||
        source.includes('RESOURCES_') ||
        source.includes('resourceIds') ||
        source.includes('resourceId') ||
        source.includes('resourceCount') ||
        source.includes('workCenterResourceOptions') ||
        source.includes('ManufacturingWorkCenterResource')
      expect({ file, usesPublicSurface }).toEqual({ file, usesPublicSurface: true })
    }
  })

  it('never writes to a peer module from Work Centre code', () => {
    for (const { file, source } of workCentreSources) {
      expect({ file, writes: /\/api\/(resources|planner|wms)\/[^'"`]*['"`],\s*\{\s*method:\s*['"](POST|PUT|PATCH|DELETE)/.test(source) }).toEqual({
        file,
        writes: false,
      })
    }
  })

  it('calls no scheduler, reservation or stock-posting surface', () => {
    for (const { file, source } of workCentreSources) {
      const forbidden = /\b(reserveCapacity|scheduleOperation|postStockMovement|allocateResource)\b/.test(source)
      expect({ file, forbidden }).toEqual({ file, forbidden: false })
    }
  })

  it('resolves the peer entity id at runtime rather than importing a generated registry', () => {
    for (const { file, source } of workCentreSources) {
      expect({ file, importsGenerated: source.includes("from '#generated") }).toEqual({
        file,
        importsGenerated: false,
      })
    }
  })

  it('ships no snapshot DTO — P1.7 owns that contract', () => {
    for (const { file, source } of sources) {
      expect({ file, hasSnapshotType: /WorkCenterSnapshotV1/.test(source) }).toEqual({
        file,
        hasSnapshotType: false,
      })
    }
  })

  it('declares no Site field on the Work Centre aggregate', () => {
    const entities = fs.readFileSync(path.join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')
    const workCentreBlock = entities.slice(entities.indexOf('class ManufacturingWorkCenter'))
    expect(workCentreBlock).not.toMatch(/\bsiteId\b/)
    expect(workCentreBlock).not.toMatch(/\bcapacity\b/)
    expect(workCentreBlock).not.toMatch(/availabilityRuleSetId/)
  })
})

describe('Work Centre client boundaries', () => {
  const clientFiles = workCentreSources.filter(({ source }) => source.startsWith('"use client"'))

  it('marks the three route-local islands as client components', () => {
    expect(clientFiles.map(({ file }) => path.basename(file)).sort()).toEqual(
      expect.arrayContaining([
        'WorkCenterFormClient.tsx',
        'WorkCenterResourcePicker.tsx',
        'WorkCentersTableClient.tsx',
      ]),
    )
  })

  it('keeps every page root a server component', () => {
    const pages = workCentreSources.filter(({ file }) => file.includes('backend') && file.endsWith('page.tsx'))
    expect(pages.length).toBe(3)
    for (const { file, source } of pages) {
      expect({ file, isClient: source.includes('"use client"') }).toEqual({ file, isClient: false })
    }
  })

  it('keeps each client island under the 300-line budget', () => {
    for (const { file, source } of clientFiles) {
      expect({ file, lines: source.split('\n').length < 300 }).toEqual({ file, lines: true })
    }
  })
})
