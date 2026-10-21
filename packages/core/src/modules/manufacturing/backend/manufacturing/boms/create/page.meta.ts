import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: [
    'manufacturing.manage',
    'catalog.products.view',
  ],
  pageTitle: 'New BOM',
  pageTitleKey: 'manufacturing.boms.form.createTitle',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
}