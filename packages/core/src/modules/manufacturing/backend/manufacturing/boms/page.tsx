'use client'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'

import { BomListTable } from '../../../components/boms/BomListTable'

export default function ManufacturingBomsPage() {
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <Page>
      <PageBody>
        <BomListTable key={scopeVersion} />
      </PageBody>
    </Page>
  )
}
