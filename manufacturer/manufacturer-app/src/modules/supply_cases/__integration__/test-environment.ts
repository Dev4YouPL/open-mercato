import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJsonSupplyCasesStore } from '../data/json/store'

type QaDescriptor = {
  supplyCases?: {
    dataDir?: string
  }
}

export function createQaSupplyCasesStore() {
  const configuredDataDir = process.env.OM_SUPPLY_CASES_DATA_DIR?.trim()
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  const descriptorPaths = [
    path.resolve(appRoot, '.ai/qa/test-env.json'),
    path.resolve(process.cwd(), '.ai/qa/test-env.json'),
  ]
  if (configuredDataDir) return createJsonSupplyCasesStore({ dataDir: configuredDataDir })
  const descriptorPath = descriptorPaths.find((candidate) => existsSync(candidate))
  if (!descriptorPath) {
    const appQaDataDir = path.resolve(appRoot, '.ai/qa/supply-cases-data')
    return createJsonSupplyCasesStore({ dataDir: appQaDataDir })
  }

  try {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8').replace(/^\uFEFF/, '')) as QaDescriptor
    const dataDir = descriptor.supplyCases?.dataDir?.trim()
    return dataDir ? createJsonSupplyCasesStore({ dataDir }) : createJsonSupplyCasesStore()
  } catch {
    return createJsonSupplyCasesStore()
  }
}
