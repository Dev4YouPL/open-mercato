export const metadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.view'],
  pageTitle: 'Executions',
  pageTitleKey: 'manufacturing.backend.executions.nav.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  pageOrder: 120,
  icon: 'clipboard-check',
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'Executions', labelKey: 'manufacturing.backend.executions.nav.title' },
  ],
} as const
