export const features = [
  { id: 'manufacturing.bom.view', title: 'View BOM drafts', module: 'manufacturing' },
  { id: 'manufacturing.bom.manage', title: 'Author and edit BOM drafts', module: 'manufacturing' },
  { id: 'manufacturing.work_center.view', title: 'View work centres', module: 'manufacturing' },
  {
    id: 'manufacturing.work_center.manage',
    title: 'Author and edit work centres',
    module: 'manufacturing',
    /**
     * Manage covers create, update, soft-delete and resource membership, and
     * always implies view. `execute`/`reverse` belong to later production-order
     * flows and are deliberately not registered by P1.6.
     */
    dependsOn: ['manufacturing.work_center.view'],
  },
]

export default features
