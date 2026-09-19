export const features = [
  { id: 'supplier_demo.supply_cases.view', title: 'View supply cases', module: 'supplier_demo' },
  {
    id: 'supplier_demo.supply_cases.manage',
    title: 'Manage supply cases',
    module: 'supplier_demo',
    dependsOn: ['supplier_demo.supply_cases.view'],
  },
]

export default features
