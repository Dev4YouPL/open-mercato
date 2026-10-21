import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['manufacturing.execution.manage'],
  pageTitle: 'New production execution',
  pageTitleKey: 'manufacturing.executions.form.createTitle',
  pageGroup: 'Manufacturing',
  pageGroupKey: 'manufacturing.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Manufacturing', labelKey: 'manufacturing.backend.nav.title' },
    { label: 'Executions', labelKey: 'manufacturing.backend.executions.nav.title', href: '/backend/manufacturing/executions' },
    { label: 'New production execution', labelKey: 'manufacturing.executions.form.createTitle' },
  ],
}
