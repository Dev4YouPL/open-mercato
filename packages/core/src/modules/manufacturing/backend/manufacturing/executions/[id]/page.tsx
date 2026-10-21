'use client'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProductionExecutionDetail } from '../../../../components/executions/ProductionExecutionDetail'

type ProductionExecutionPageProps = {
  params: { id: string }
}

export default function ProductionExecutionPage({ params }: ProductionExecutionPageProps) {
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <Page>
      <PageBody>
        <ProductionExecutionDetail key={`${params.id}:${scopeVersion}`} executionId={params.id} />
      </PageBody>
    </Page>
  )
}
