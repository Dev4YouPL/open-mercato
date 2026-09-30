export const metadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.view'],
  pageTitle: 'Orders',
  pageTitleKey: 'manufacturing.backend.orders.nav.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  pageOrder: 110,
  icon: 'clipboard-list',
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'Orders', labelKey: 'manufacturing.backend.orders.nav.title' },
  ],
} as const
