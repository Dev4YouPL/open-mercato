"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ManufacturingBomsPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <EmptyState
          title={t('manufacturing.backend.boms.empty.title')}
          description={t('manufacturing.backend.boms.empty.description')}
        />
      </PageBody>
    </Page>
  )
}
