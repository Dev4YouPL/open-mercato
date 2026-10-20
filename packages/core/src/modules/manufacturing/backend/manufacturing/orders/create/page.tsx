'use client'

import { useRouter } from 'next/navigation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProductionOrderForm } from '../../../../components/orders/ProductionOrderForm'

export default function CreateProductionOrderPage() {
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <Page>
      <PageBody>
        <ProductionOrderForm
          key={scopeVersion}
          onCancel={() => router.push('/backend/manufacturing/orders')}
          onCreated={() => router.replace('/backend/manufacturing/orders')}
        />
      </PageBody>
    </Page>
  )
}
