import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { seedManufacturingExamples } from './lib/exampleSeed'

export const setup: ModuleSetupConfig = {
  seedExamples: seedManufacturingExamples,
  defaultRoleFeatures: {
    superadmin: ['manufacturing.*'],
    admin: ['manufacturing.*'],
    employee: ['manufacturing.view', 'manufacturing.execution.view'],
  },
}

export default setup
