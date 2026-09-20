export const metadata = {
  requireAuth: true,
  requireFeatures: ['supplier_demo.supply_cases.view'],
  navHidden: true,
  pageTitle: 'Supply case',
  pageTitleKey: 'supplier_demo.supplyCases.detail.title',
  pageGroup: 'Supply Recovery',
  pageGroupKey: 'supplier_demo.supplyCases.nav.group',
  breadcrumb: [
    { label: 'Supply cases', labelKey: 'supplier_demo.supplyCases.page.title', href: '/backend/supplier-demo/supply-cases' },
    { label: 'Supply case', labelKey: 'supplier_demo.supplyCases.detail.title' },
  ],
}
