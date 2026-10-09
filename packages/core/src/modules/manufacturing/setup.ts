import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['manufacturing.*'],
    admin: ['manufacturing.*'],
    employee: ['manufacturing.view', 'manufacturing.execution.view'],
  },
}

export default setup
