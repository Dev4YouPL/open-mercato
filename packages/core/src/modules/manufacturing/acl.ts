export const features = [
  { id: 'manufacturing.view', title: 'View manufacturing', module: 'manufacturing' },
  {
    id: 'manufacturing.manage',
    title: 'Manage manufacturing',
    module: 'manufacturing',
    dependsOn: ['manufacturing.view'],
  },
]

export default features
