import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplyCaseDetail from '../../../components/SupplyCaseDetail'

export default function SupplyCaseDetailPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <SupplyCaseDetail id={params.id} />
      </PageBody>
    </Page>
  )
}
