export const features = [
  { id: 'supplier_demo.supply_cases.view', title: 'View supply cases', module: 'supplier_demo' },
  {
    id: 'supplier_demo.supply_cases.manage',
    title: 'Manage supply cases',
    module: 'supplier_demo',
    dependsOn: ['supplier_demo.supply_cases.view'],
  },
  { id: 'supplier_demo.rfqs.view', title: 'View supplier RFQs', module: 'supplier_demo' },
  {
    id: 'supplier_demo.rfqs.manage',
    title: 'Manage supplier RFQs',
    module: 'supplier_demo',
    dependsOn: ['supplier_demo.rfqs.view'],
  },
]

export default features
