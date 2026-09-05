import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Default grants are merged, never replaced: the BOM entries stay exactly as
 * P1.4a left them. Employees deliberately receive Work Centre view only — they
 * may inspect setup data but get neither manage nor any `resources` grant from
 * Manufacturing.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: [
      'manufacturing.bom.view',
      'manufacturing.bom.manage',
      'manufacturing.work_center.view',
      'manufacturing.work_center.manage',
    ],
    admin: [
      'manufacturing.bom.view',
      'manufacturing.bom.manage',
      'manufacturing.work_center.view',
      'manufacturing.work_center.manage',
    ],
    employee: ['manufacturing.work_center.view'],
  },
}

export default setup
