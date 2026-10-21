import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.execution.view'],
  pageTitle: 'Production execution',
  pageTitleKey: 'manufacturing.executions.detail.title',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'Executions', labelKey: 'manufacturing.backend.executions.nav.title', href: '/backend/manufacturing/executions' },
    { label: 'Production execution', labelKey: 'manufacturing.executions.detail.title' },
  ],
}
