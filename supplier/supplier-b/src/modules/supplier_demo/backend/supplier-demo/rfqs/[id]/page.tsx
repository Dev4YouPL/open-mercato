import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplierRfqDetail from '../../../../components/SupplierRfqDetail'

export default async function SupplierRfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Page><PageBody><SupplierRfqDetail id={id} /></PageBody></Page>
}
