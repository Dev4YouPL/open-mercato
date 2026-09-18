export const features = [
  {
    id: 'supply_cases.view',
    title: 'View supply cases',
    module: 'supply_cases',
  },
  {
    id: 'supply_cases.messages.view',
    title: 'View supply message timeline',
    module: 'supply_cases',
    dependsOn: ['supply_cases.view'],
  },
  {
    id: 'supply_cases.manage',
    title: 'Operate supply cases',
    module: 'supply_cases',
    dependsOn: ['supply_cases.view'],
  },
  {
    id: 'supply_cases.decisions.apply',
    title: 'Apply sourcing and resolution decisions',
    module: 'supply_cases',
    dependsOn: ['supply_cases.view'],
  },
]

export default features
