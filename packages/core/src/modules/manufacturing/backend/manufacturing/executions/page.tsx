"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProductionExecutionsTable } from '../../../components/executions/ProductionExecutionsTable'

export default function ManufacturingExecutionsPage() {
  return (
    <Page>
      <PageBody>
        <ProductionExecutionsTable />
      </PageBody>
    </Page>
  )
}
