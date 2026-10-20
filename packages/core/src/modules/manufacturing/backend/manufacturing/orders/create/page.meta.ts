import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.manage', 'wms.view'],
  pageTitle: 'New production order',
  pageTitleKey: 'manufacturing.orders.form.createTitle',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'Orders', labelKey: 'manufacturing.backend.orders.nav.title', href: '/backend/manufacturing/orders' },
    { label: 'New production order', labelKey: 'manufacturing.orders.form.createTitle' },
  ],
}
