import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.view'],
  pageTitle: 'BOM details',
  pageTitleKey: 'manufacturing.boms.detail.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
}