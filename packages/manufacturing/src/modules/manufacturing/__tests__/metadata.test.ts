import fs from 'node:fs'
import path from 'node:path'
import { metadata } from '../index'

const moduleRoot = path.resolve(__dirname, '..')
const packageSrcRoot = path.resolve(moduleRoot, '..', '..')

const RETIRED_MODULE_IDS = ['manufacturing_base', 'manufacturing_discrete']
const OPTIONAL_PEER_MODULE_IDS = ['wms', 'resources', 'planner']

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...listSourceFiles(entryPath))
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

describe('manufacturing module metadata', () => {
  it('declares the stable module id and initial version', () => {
    expect(metadata.name).toBe('manufacturing')
    expect(metadata.version).toBe('0.1.0')
    expect(metadata.title).toBe('Manufacturing')
    expect(metadata.ejectable).toBe(true)
  })

  it('hard-requires catalog and nothing else', () => {
    expect(metadata.requires).toEqual(['catalog'])
  })

  it('keeps WMS, resources, and planner as optional peers', () => {
    for (const moduleId of OPTIONAL_PEER_MODULE_IDS) {
      expect(metadata.requires ?? []).not.toContain(moduleId)
    }
  })
})

describe('manufacturing module boundaries', () => {
  it('ships no runtime module directory under a retired id', () => {
    const modulesRoot = path.join(packageSrcRoot, 'modules')
    expect(fs.readdirSync(modulesRoot).sort()).toEqual(['manufacturing'])
    for (const retiredId of RETIRED_MODULE_IDS) {
      expect(fs.existsSync(path.join(modulesRoot, retiredId))).toBe(false)
    }
  })

  it('imports no optional peer module and no core package', () => {
    for (const file of listSourceFiles(packageSrcRoot)) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).not.toMatch(/@open-mercato\/core/)
      for (const moduleId of OPTIONAL_PEER_MODULE_IDS) {
        expect(source).not.toMatch(new RegExp(`modules/${moduleId}(/|'|")`))
      }
    }
  })
})
