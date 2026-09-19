import { defineConfig } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverIntegrationSpecFiles } from '@open-mercato/cli/lib/testing/integration-discovery'

const captureScreenshots = process.env.PW_CAPTURE_SCREENSHOTS === '1'
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'
const isLiveMailRun = process.env.LIVE_MAIL_E2E === '1' && process.env.LIVE_MAIL_E2E_APPROVED === '1'
// Standalone apps generated from this template declare `"type": "module"`,
// so the CommonJS `__dirname` is undefined when Playwright loads this config
// under the Node ESM loader. Reconstruct it from `import.meta.url`.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..', '..')
const qaTestResultsRoot = path.join(projectRoot, '.ai', 'qa', 'test-results')
const testEnvDescriptorPath = path.join(projectRoot, '.ai', 'qa', 'test-env.json')

type TestEnvDescriptor = {
  baseUrl?: string
  credentials?: {
    email?: string
    password?: string
  }
  supplyCases?: {
    dataDir?: string
    tenantId?: string
    organizationId?: string
  }
}

function readTestEnvDescriptor(): TestEnvDescriptor | null {
  if (!existsSync(testEnvDescriptorPath)) return null
  try {
    return JSON.parse(readFileSync(testEnvDescriptorPath, 'utf8')) as TestEnvDescriptor
  } catch {
    return null
  }
}

const testEnvDescriptor = readTestEnvDescriptor()
if (testEnvDescriptor?.supplyCases?.dataDir) {
  process.env.OM_SUPPLY_CASES_DATA_DIR = testEnvDescriptor.supplyCases.dataDir
}
if (testEnvDescriptor?.supplyCases?.tenantId) {
  process.env.OM_QA_TENANT_ID = testEnvDescriptor.supplyCases.tenantId
}
if (testEnvDescriptor?.supplyCases?.organizationId) {
  process.env.OM_QA_ORGANIZATION_ID = testEnvDescriptor.supplyCases.organizationId
}
if (testEnvDescriptor?.credentials?.email) {
  process.env.OM_QA_EMAIL = testEnvDescriptor.credentials.email
}
if (testEnvDescriptor?.credentials?.password) {
  process.env.OM_QA_PASSWORD = testEnvDescriptor.credentials.password
}
const normalizePath = (value: string) => value.split(path.sep).join('/')
const STATIC_TEST_IGNORES = [
  `${normalizePath(path.join(projectRoot, '.claude'))}/**`,
  `${normalizePath(path.join(projectRoot, '.codex'))}/**`,
  `${normalizePath(path.join(projectRoot, '.cursor'))}/**`,
  `${normalizePath(path.join(projectRoot, 'node_modules'))}/**`,
]
const discoveredSpecs = discoverIntegrationSpecFiles(projectRoot, path.join(projectRoot, '.ai', 'qa', 'tests'))
const discoveredSpecPaths = discoveredSpecs.map((entry) => entry.path)

export default defineConfig({
  testDir: projectRoot,
  testMatch: discoveredSpecPaths.length > 0 ? discoveredSpecPaths : ['.ai/qa/tests/__no_tests__/*.spec.ts'],
  testIgnore: [
    ...STATIC_TEST_IGNORES,
  ],
  timeout: isLiveMailRun ? 300_000 : 20_000,
  expect: {
    timeout: isLiveMailRun ? 30_000 : 20_000,
  },
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || testEnvDescriptor?.baseUrl || 'http://localhost:3000',
    headless: true,
    screenshot: captureScreenshots ? 'on' : 'only-on-failure',
    trace: 'on-first-retry',
  },
  reporter: isGitHubActions
    ? [
        ['github'],
        ['list'],
        ['json', { outputFile: path.join(qaTestResultsRoot, 'results.json') }],
        ['html', { outputFolder: path.join(qaTestResultsRoot, 'html'), open: 'never' }],
      ]
    : [
        ['list'],
        ['json', { outputFile: path.join(qaTestResultsRoot, 'results.json') }],
        ['html', { outputFolder: path.join(qaTestResultsRoot, 'html'), open: 'never' }],
      ],
  outputDir: path.join(qaTestResultsRoot, 'artifacts'),
})
