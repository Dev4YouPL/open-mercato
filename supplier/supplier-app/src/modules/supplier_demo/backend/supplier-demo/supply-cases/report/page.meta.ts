export const metadata = {
  requireAuth: true,
  requireFeatures: ['supplier_demo.supply_cases.manage'],
  navHidden: true,
  pageTitle: 'Report supply disruption',
  pageTitleKey: 'supplier_demo.supplyCases.dialog.title',
  breadcrumb: [
    { label: 'Supply cases', labelKey: 'supplier_demo.supplyCases.page.title', href: '/backend/supplier-demo/supply-cases' },
    { label: 'Report supply disruption', labelKey: 'supplier_demo.supplyCases.dialog.title' },
  ],
} as const
