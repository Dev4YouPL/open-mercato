/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

const moduleRoot = path.resolve(__dirname, '..')
const modulesRoot = path.resolve(moduleRoot, '..')
const moduleName = path.basename(moduleRoot)

const sourceExtensions = new Set(['.ts', '.tsx'])
const importPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm
const otherModuleCommandIdPattern = /['"`](wms|catalog|sales|customers)\.[a-z_]+\.[a-z_]+['"`]/

type SourceFile = {
  relativePath: string
  layer: string
  content: string
  imports: string[]
}

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(entryPath)
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : []
  })
}

function readSourceFile(absolutePath: string): SourceFile {
  const relativePath = path.relative(moduleRoot, absolutePath).split(path.sep).join('/')
  const content = fs.readFileSync(absolutePath, 'utf8')
  const imports = Array.from(content.matchAll(importPattern), (match) => match[1])
  return { relativePath, layer: relativePath.split('/')[0], content, imports }
}

function resolveImportedModule(file: SourceFile, specifier: string): string | null {
  const packageMatch = specifier.match(/^@open-mercato\/(?!shared\/)[^/]+\/modules\/([^/]+)/)
  if (packageMatch) return packageMatch[1]
  if (!specifier.startsWith('.')) return null
  const resolved = path.resolve(moduleRoot, path.dirname(file.relativePath), specifier)
  const fromModulesRoot = path.relative(modulesRoot, resolved)
  if (fromModulesRoot.startsWith('..')) return null
  return fromModulesRoot.split(path.sep)[0]
}

function resolveImportedLayer(file: SourceFile, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const resolved = path.resolve(moduleRoot, path.dirname(file.relativePath), specifier)
  const fromModuleRoot = path.relative(moduleRoot, resolved)
  if (fromModuleRoot.startsWith('..')) return null
  return fromModuleRoot.split(path.sep)[0]
}

const sourceFiles = listSourceFiles(moduleRoot).map(readSourceFile)
const filesOutsideAdapters = sourceFiles.filter((file) => file.layer !== 'adapters')

function violations(files: SourceFile[], isViolation: (file: SourceFile, specifier: string) => boolean): string[] {
  return files.flatMap((file) =>
    file.imports.filter((specifier) => isViolation(file, specifier)).map((specifier) => `${file.relativePath} -> ${specifier}`),
  )
}

describe('manufacturing module boundaries', () => {
  it('finds the module source files', () => {
    expect(sourceFiles.some((file) => file.relativePath === 'adapters/wms/wmsInventoryGateway.ts')).toBe(true)
  })

  it('imports other modules only from adapters', () => {
    const crossModuleImports = violations(filesOutsideAdapters, (file, specifier) => {
      const importedModule = resolveImportedModule(file, specifier)
      return importedModule !== null && importedModule !== moduleName
    })

    expect(crossModuleImports).toEqual([])
  })

  it('references other modules command ids only from adapters', () => {
    const offenders = filesOutsideAdapters
      .filter((file) => otherModuleCommandIdPattern.test(file.content))
      .map((file) => file.relativePath)

    expect(offenders).toEqual([])
  })

  it('wires adapters only through di.ts', () => {
    const adapterImports = violations(
      sourceFiles.filter((file) => file.layer !== 'adapters' && file.relativePath !== 'di.ts'),
      (file, specifier) => resolveImportedLayer(file, specifier) === 'adapters',
    )

    expect(adapterImports).toEqual([])
  })

  it('keeps ports free of module internals', () => {
    const allowedLayers = new Set(['ports', 'domain'])
    const portImports = violations(
      sourceFiles.filter((file) => file.layer === 'ports'),
      (file, specifier) => {
        const importedLayer = resolveImportedLayer(file, specifier)
        return importedLayer !== null && !allowedLayers.has(importedLayer)
      },
    )

    expect(portImports).toEqual([])
  })

  it('keeps domain pure: no other layers, ORM, DI or framework imports', () => {
    const domainImports = violations(
      sourceFiles.filter((file) => file.layer === 'domain'),
      (file, specifier) => {
        const importedLayer = resolveImportedLayer(file, specifier)
        if (importedLayer !== null) return importedLayer !== 'domain'
        return /^(@mikro-orm|awilix|@open-mercato\/)/.test(specifier)
      },
    )

    expect(domainImports).toEqual([])
  })
})
