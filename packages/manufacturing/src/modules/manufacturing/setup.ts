import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['manufacturing.bom.view', 'manufacturing.bom.manage'],
  },
}

export default setup
