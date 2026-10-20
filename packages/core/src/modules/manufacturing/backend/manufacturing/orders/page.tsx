"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProductionOrdersTable } from '../../../components/orders/ProductionOrdersTable'

export default function ManufacturingOrdersPage() {
  return (
    <Page>
      <PageBody>
        <ProductionOrdersTable />
      </PageBody>
    </Page>
  )
}
