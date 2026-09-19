export const metadata = {
  requireAuth: true,
  requireFeatures: ['supply_cases.view'],
  pageTitle: 'Supply case',
  pageTitleKey: 'supply_cases.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Supply cases', labelKey: 'supply_cases.page.title', href: '/backend/supply-cases' },
    { label: 'Supply case', labelKey: 'supply_cases.detail.title' },
  ],
}
