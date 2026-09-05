import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['manufacturing.bom.view', 'manufacturing.bom.manage'],
    admin: ['manufacturing.bom.view', 'manufacturing.bom.manage'],
  },
}

export default setup
