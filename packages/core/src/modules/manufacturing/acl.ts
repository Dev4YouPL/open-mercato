export const features = [
  { id: 'manufacturing.view', title: 'View manufacturing', module: 'manufacturing' },
  {
    id: 'manufacturing.manage',
    title: 'Manage manufacturing',
    module: 'manufacturing',
    dependsOn: ['manufacturing.view'],
  },
  { id: 'manufacturing.execution.view', title: 'View production execution', module: 'manufacturing' },
  {
    id: 'manufacturing.execution.manage',
    title: 'Record production execution',
    module: 'manufacturing',
    dependsOn: ['manufacturing.execution.view', 'wms.view', 'wms.adjust_inventory', 'wms.receive_inventory'],
  },
  { id: 'manufacturing.corrections.view', title: 'View production corrections', module: 'manufacturing' },
  {
    id: 'manufacturing.corrections.manage',
    title: 'Reverse production documents',
    module: 'manufacturing',
    dependsOn: ['manufacturing.corrections.view', 'wms.view', 'wms.adjust_inventory', 'wms.receive_inventory'],
  },
]

export default features
