export const MANUFACTURING_WMS_REQUIRED_FEATURES = [
  'wms.view',
  'wms.adjust_inventory',
  'wms.receive_inventory',
] as const

export const EXECUTION_VIEW_FEATURES = ['manufacturing.execution.view'] as const

export const EXECUTION_RECORD_FEATURES = [
  'manufacturing.execution.manage',
  ...MANUFACTURING_WMS_REQUIRED_FEATURES,
] as const

export const CORRECTION_VIEW_FEATURES = ['manufacturing.corrections.view'] as const

export const CORRECTION_RECORD_FEATURES = [
  'manufacturing.corrections.manage',
  ...MANUFACTURING_WMS_REQUIRED_FEATURES,
] as const
