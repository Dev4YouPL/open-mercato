import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { BomListClient } from "../../../components/BomListClient"
import { extensionPoints } from "../../../extension-points"

export default function ManufacturingBomsListPage() {
  return (
    <Page>
      <PageBody>
        <BomListClient extensionTableId={extensionPoints.hosts.bomsTable.tableId} />
      </PageBody>
    </Page>
  )
}
