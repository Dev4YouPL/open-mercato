import fs from 'node:fs'
import path from 'node:path'

const packageRoot = path.resolve(__dirname, '..', '..')
const srcRoot = path.join(packageRoot, 'src')

type ExportEntry = string | { types?: string | string[]; default?: string }

const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as { name: string; exports: Record<string, ExportEntry> }

const CONVENTION_DEPTHS = [1, 2, 3, 4, 5, 6]

function wildcardSegments(depth: number): string {
  return Array.from({ length: depth }, () => '*').join('/')
}

describe('@open-mercato/manufacturing package contract', () => {
  it('publishes under the stable package name', () => {
    expect(manifest.name).toBe('@open-mercato/manufacturing')
  })

  it('maps the package root to source types and built output', () => {
    expect(manifest.exports['.']).toEqual({
      types: './src/index.ts',
      default: './dist/index.js',
    })
  })

  it('maps the module discovery entrypoint to source types and built output', () => {
    expect(manifest.exports['./modules/manufacturing/index']).toEqual({
      types: './src/modules/manufacturing/index.ts',
      default: './dist/modules/manufacturing/index.js',
    })
  })

  it('keeps the depth-aware convention-file and JSON mappings generators rely on', () => {
    for (const depth of CONVENTION_DEPTHS) {
      const segments = wildcardSegments(depth)
      expect(manifest.exports[`./${segments}`]).toEqual({
        types: [`./src/${segments}.ts`, `./src/${segments}.tsx`],
        default: `./dist/${segments}.js`,
      })
      expect(manifest.exports[`./${segments}.json`]).toBe(`./src/${segments}.json`)
    }
  })
})

describe('@open-mercato/manufacturing public surface', () => {
  it('exports no domain contract from the package root', async () => {
    const root = await import('../index')
    expect(Object.keys(root)).toEqual([])
  })

  it('exports only module metadata from the module entrypoint', async () => {
    const moduleEntry = await import('../modules/manufacturing/index')
    expect(Object.keys(moduleEntry).sort()).toEqual(['default', 'metadata'])
  })

  it('ships no convention file or domain source beyond the two entrypoints', () => {
    const sources: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue
          walk(path.join(dir, entry.name))
        } else {
          sources.push(path.relative(srcRoot, path.join(dir, entry.name)).split(path.sep).join('/'))
        }
      }
    }
    walk(srcRoot)
    expect(sources.sort()).toEqual(['index.ts', 'modules/manufacturing/index.ts'])
  })
})
