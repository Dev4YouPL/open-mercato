'use client'

import { useRouter } from 'next/navigation'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'

import { BomForm } from '../../../../components/boms/BomForm'

export default function CreateBomPage() {
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <Page>
      <PageBody>
        <BomForm
          key={scopeVersion}
          mode="create"
          onCancel={() => {
            router.push('/backend/manufacturing/boms')
          }}
          onSaved={(bomId) => {
            router.replace(
              `/backend/manufacturing/boms/${bomId}`,
            )
          }}
        />
      </PageBody>
    </Page>
  )
}