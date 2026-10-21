'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProductionExecutionForm } from '../../../../components/executions/ProductionExecutionForm'
import { EXECUTIONS_BACKEND_PATH } from '../../../../components/executions/executionUi'

export default function CreateProductionExecutionPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <Page>
      <PageBody>
        <ProductionExecutionForm
          key={scopeVersion}
          initialOrderId={searchParams?.get('orderId') ?? null}
          onCancel={() => router.push(EXECUTIONS_BACKEND_PATH)}
          onCreated={(execution) => router.replace(`${EXECUTIONS_BACKEND_PATH}/${execution.id}`)}
        />
      </PageBody>
    </Page>
  )
}
