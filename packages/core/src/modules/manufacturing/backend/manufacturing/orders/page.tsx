"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ManufacturingOrdersPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <EmptyState
          title={t('manufacturing.backend.orders.empty.title')}
          description={t('manufacturing.backend.orders.empty.description')}
        />
      </PageBody>
    </Page>
  )
}
