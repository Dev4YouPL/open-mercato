"use client"
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ManufacturingOrdersPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <EmptyState
          title={t('manufacturing.backend.orders.empty.title')}
          description={t('manufacturing.backend.orders.empty.description')}
          actions={
            <Button asChild>
              <Link href="/backend/manufacturing/orders/create">{t('manufacturing.orders.actions.create')}</Link>
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}
