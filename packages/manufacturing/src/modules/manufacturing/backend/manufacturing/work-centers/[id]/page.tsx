import { Page, PageBody } from "@open-mercato/ui/backend/Page"
import { WorkCenterDetailClient } from "../../../../components/WorkCenterDetailClient"

export default async function ManufacturingWorkCenterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <WorkCenterDetailClient workCenterId={id} />
      </PageBody>
    </Page>
  )
}
