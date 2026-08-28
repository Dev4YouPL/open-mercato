import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleRegistry } from '../module-registry'

const PACKAGE_NAME = '@open-mercato/manufacturing'
const MODULE_ID = 'manufacturing'
const IMPORT_BASE = `${PACKAGE_NAME}/modules/${MODULE_ID}`

function findManufacturingPackageRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'packages', 'manufacturing')
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate packages/manufacturing from the test directory')
}

const manufacturingPackageRoot = findManufacturingPackageRoot()
const manufacturingManifest = JSON.parse(
  fs.readFileSync(path.join(manufacturingPackageRoot, 'package.json'), 'utf8'),
) as { exports: Record<string, { default?: string }> }

/**
 * The subpath a standalone app imports. Reading it from the manifest instead of
 * hardcoding the dist layout is what makes this test fail when the published
 * export map and the real build output stop agreeing.
 */
const publishedModuleEntry = manufacturingManifest.exports[`./modules/${MODULE_ID}/index`]?.default

/**
 * Runs the package's real `build.mjs`, so the standalone fixture is seeded with
 * genuine esbuild output instead of a hand-written approximation of it. The
 * `test` turbo task does not depend on `^build`, so dist may legitimately be
 * absent when this file runs.
 */
function buildManufacturingPackage(): string {
  const result = spawnSync(process.execPath, ['build.mjs'], {
    cwd: manufacturingPackageRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`[internal] manufacturing package build failed: ${result.stderr || result.stdout}`)
  }
  if (!publishedModuleEntry) {
    throw new Error(`[internal] package.json exports no ./modules/${MODULE_ID}/index default path`)
  }
  const builtEntry = path.join(manufacturingPackageRoot, publishedModuleEntry)
  if (!fs.existsSync(builtEntry)) {
    throw new Error(`[internal] the build did not emit the published entrypoint ${publishedModuleEntry}`)
  }
  return builtEntry
}

/**
 * The registry generator refuses to emit when a module's `requires` list names a
 * module that is not enabled, so the hard `catalog` dependency has to be
 * satisfied by the fixture for discovery to run at all.
 */
function scaffoldCatalogStub(tmpDir: string): string {
  const catalogBase = path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'catalog')
  fs.mkdirSync(catalogBase, { recursive: true })
  fs.writeFileSync(
    path.join(catalogBase, 'index.ts'),
    "export const metadata = { name: 'catalog', title: 'Catalog' }\n",
  )
  return catalogBase
}

function createResolver(
  tmpDir: string,
  manufacturingPkgBase: string,
  options: { isMonorepo: boolean },
): PackageResolver {
  const outputDir = path.join(tmpDir, 'output', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
  const catalogPkgBase = scaffoldCatalogStub(tmpDir)
  const enabled: ModuleEntry[] = [
    { id: 'catalog', from: '@open-mercato/core' },
    { id: MODULE_ID, from: PACKAGE_NAME },
  ]

  return {
    isMonorepo: () => options.isMonorepo,
    getRootDir: () => tmpDir,
    getAppDir: () => path.join(tmpDir, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
      pkgBase: entry.id === MODULE_ID ? manufacturingPkgBase : catalogPkgBase,
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `${entry.from}/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => manufacturingPackageRoot,
  }
}

function readGenerated(tmpDir: string, filename: string): string {
  return fs.readFileSync(path.join(tmpDir, 'output', 'generated', filename), 'utf8')
}

describe('manufacturing module discovery after explicit activation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manufacturing-discovery-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves the module entrypoint from monorepo package source', async () => {
    const pkgBase = path.join(manufacturingPackageRoot, 'src', 'modules', MODULE_ID)
    const resolver = createResolver(tmpDir, pkgBase, { isMonorepo: true })

    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')
    expect(output).toContain(`from "${IMPORT_BASE}/index"`)
    expect(output).toContain(`id: "${MODULE_ID}"`)
    expect(output).toMatch(/info: I\d+_manufacturing\.metadata/)
  })

  it('publishes the module entrypoint at the exported dist path', () => {
    expect(publishedModuleEntry).toBe(`./dist/modules/${MODULE_ID}/index.js`)
    const builtEntry = buildManufacturingPackage()
    expect(fs.readFileSync(builtEntry, 'utf8')).toContain(`name: "${MODULE_ID}"`)
  })

  it('resolves the module entrypoint from built standalone package output', async () => {
    const builtEntry = buildManufacturingPackage()
    const pkgBase = path.join(
      tmpDir,
      'node_modules',
      '@open-mercato',
      'manufacturing',
      'dist',
      'modules',
      MODULE_ID,
    )
    fs.mkdirSync(pkgBase, { recursive: true })
    fs.copyFileSync(builtEntry, path.join(pkgBase, 'index.js'))
    const resolver = createResolver(tmpDir, pkgBase, { isMonorepo: false })

    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')
    expect(output).toContain(`from "${IMPORT_BASE}/index"`)
    expect(output).toMatch(/info: I\d+_manufacturing\.metadata/)
  })

  it('emits no route, api, or convention surface for the bootstrap module', async () => {
    const pkgBase = path.join(manufacturingPackageRoot, 'src', 'modules', MODULE_ID)
    const resolver = createResolver(tmpDir, pkgBase, { isMonorepo: true })

    await generateModuleRegistry({ resolver, quiet: true })

    const output = readGenerated(tmpDir, 'modules.generated.ts')
    expect(output).not.toContain(`${IMPORT_BASE}/frontend/`)
    expect(output).not.toContain(`${IMPORT_BASE}/backend/`)
    expect(output).not.toContain(`${IMPORT_BASE}/api/`)
    expect(output).not.toContain('/backend/manufacturing')
    expect(output).not.toContain('apis: [{')
  })
})
