import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { WorkCentersTableClient } from "../../../components/WorkCentersTableClient"
import { extensionPoints } from "../../../extension-points"

export default function ManufacturingWorkCentersListPage() {
  return (
    <Page>
      <PageBody>
        <WorkCentersTableClient extensionTableId={extensionPoints.hosts.workCentersTable.tableId} />
      </PageBody>
    </Page>
  )
}
