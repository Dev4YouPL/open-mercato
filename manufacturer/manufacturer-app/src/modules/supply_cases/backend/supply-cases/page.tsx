import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import SupplyCasesTable from '../../components/SupplyCasesTable'
import SupplyActivityFeed from '../../components/SupplyActivityFeed'

export default async function SupplyCasesPage() {
  const { t } = await resolveTranslations()
  return (
    <Page>
      <PageHeader
        title={t('supply_cases.page.title', 'Supply cases')}
        description={t('supply_cases.page.description', 'Operational queue for supply exceptions.')}
      />
      <PageBody>
        <SupplyActivityFeed />
        <SupplyCasesTable />
      </PageBody>
    </Page>
  )
}
