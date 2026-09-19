"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ReportSupplyDisruptionForm from '../../../../components/ReportSupplyDisruptionForm'

export default function SupplierDemoReportDisruptionPage() {
  return (
    <Page>
      <PageBody>
        <React.Suspense fallback={null}>
          <ReportSupplyDisruptionForm />
        </React.Suspense>
      </PageBody>
    </Page>
  )
}
