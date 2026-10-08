'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ErrorMessage,
  LoadingMessage,
} from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'

export default function ManufacturingBomsPage() {
  const scopeVersion = useOrganizationScopeVersion()

  return <BomStartContent key={scopeVersion} />
}

function BomStartContent() {
  const t = useT()

  const [canCreate, setCanCreate] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [permissionsFailed, setPermissionsFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function checkPermissions() {
      try {
        const response = await apiCall<{ ok: boolean }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              features: [
                'manufacturing.manage',
                'catalog.products.view',
              ],
            }),
          },
        )

        if (controller.signal.aborted) {
          return
        }

        if (
          !response.ok
          || typeof response.result?.ok !== 'boolean'
        ) {
          setPermissionsFailed(true)
          return
        }

        setCanCreate(response.result.ok)
      } catch {
        if (!controller.signal.aborted) {
          setPermissionsFailed(true)
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsChecking(false)
        }
      }
    }

    void checkPermissions()

    return () => {
      controller.abort()
    }
  }, [])

  return (
    <Page>
      <PageBody>
        {isChecking ? (
          <LoadingMessage
            label={t(
              'manufacturing.boms.start.checkingPermissions',
            )}
          />
        ) : (
          <>
            {permissionsFailed ? (
              <ErrorMessage
                label={t(
                  'manufacturing.boms.detail.permissionsFailed',
                )}
              />
            ) : null}

            <EmptyState
              title={t('manufacturing.backend.boms.nav.title')}
              description={t(
                'manufacturing.boms.start.description',
              )}
              actions={canCreate ? (
                <Button asChild>
                  <Link href="/backend/manufacturing/boms/create">
                    {t('manufacturing.boms.start.create')}
                  </Link>
                </Button>
              ) : undefined}
            />
          </>
        )}
      </PageBody>
    </Page>
  )
}