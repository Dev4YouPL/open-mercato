import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))

await buildPackage(packageDir, {
  name: 'manufacturing',
  copyJson: true,
  // Playwright integration specs are test material, not shipped runtime code.
  // They import `@playwright/test` and the core test helpers, neither of which
  // is a dependency of this package, so publishing them would hand a standalone
  // consumer unresolvable imports.
  extraIgnore: ['**/__integration__/**'],
})
