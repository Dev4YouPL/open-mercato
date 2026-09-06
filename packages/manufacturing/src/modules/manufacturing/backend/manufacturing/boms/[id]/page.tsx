"use client"

import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { BomEditorClient } from "../../../../components/BomEditorClient"

export default function ManufacturingBomEditorPage({ params }: { params?: { id?: string } }) {
  const bomId = params?.id ?? ""
  return (
    <Page>
      <PageBody className="space-y-6">
        <BomEditorClient bomId={bomId} />
      </PageBody>
    </Page>
  )
}
