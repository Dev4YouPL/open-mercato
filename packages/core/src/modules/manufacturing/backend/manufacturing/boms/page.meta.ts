export const metadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.view'],
  pageTitle: 'BOM',
  pageTitleKey: 'manufacturing.backend.boms.nav.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  pageOrder: 100,
  icon: 'layers',
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'BOM', labelKey: 'manufacturing.backend.boms.nav.title' },
  ],
} as const
