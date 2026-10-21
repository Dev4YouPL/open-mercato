'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'

import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ErrorMessage,
  LoadingMessage,
  RecordNotFoundState,
} from '@open-mercato/ui/backend/detail'
import {
  Page,
  PageBody,
  PageHeader,
} from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'

import { BomForm } from '../../../../components/boms/BomForm'
import { BomItemsSection } from '../../../../components/boms/BomItemsSection'
import type { BomRecord } from '../../../../components/boms/formConfig'
import { bomListItemSchema } from '../../../../api/openapi'

import {
  BomStatusBadges,
} from '../../../../components/boms/BomStatusBadges'

import {
  BomReleaseAction,
} from '../../../../components/boms/BomReleaseAction'
import { BomDeleteAction } from '../../../../components/boms/BomDeleteAction'
import type { BomDeletionBlockedFailure } from '../../../../components/boms/BomDeleteAction'
import { BomDeletionBlockedNotice } from '../../../../components/boms/BomDeletionBlockedNotice'

import {
  BomReleaseBlockedNotice,
} from '../../../../components/boms/BomReleaseBlockedNotice'
import { BomAvailabilityBadge } from '../../../../components/boms/BomAvailabilityBadge'
import { BomAvailabilityToggle } from '../../../../components/boms/BomAvailabilityToggle'

import type {
  BomReleaseTrackingViolation,
} from '../../../../lib/bomReleaseClient'

import { Alert } from '@open-mercato/ui/primitives/alert'

const uuidSchema = z.string().uuid()

const bomLookupResponseSchema = z.object({
  items: z.array(bomListItemSchema),
})

const featureCheckResponseSchema = z.object({
  ok: z.boolean(),
  granted: z.array(z.string()),
})

type PageProps = {
  params: {
    id: string
  }
}

export default function ManufacturingBomDetailPage({
  params,
}: PageProps) {
  const scopeVersion = useOrganizationScopeVersion()

  return (
    <BomDetailContent
      key={`${params.id}:${scopeVersion}`}
      bomId={params.id}
    />
  )
}

function BomDetailContent({ bomId }: { bomId: string }) {
  const t = useT()
  const router = useRouter()

  const [bom, setBom] = useState<BomRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canManageManufacturing, setCanManageManufacturing] =
    useState(false)
  const [permissionsFailed, setPermissionsFailed] =
    useState(false)

  const [itemsReloadToken, setItemsReloadToken] = useState(0)
  const [releaseViolations, setReleaseViolations] = useState<
    BomReleaseTrackingViolation[] | null
  >(null)
  const [deletionBlocked, setDeletionBlocked] = useState<BomDeletionBlockedFailure | null>(null)

  const requestRef = useRef<AbortController | null>(null)

  const handleCancel = useCallback(() => {
    router.back()
  }, [router])

  const reloadBom = useCallback(async () => {
    setReleaseViolations(null)
    setDeletionBlocked(null)
    requestRef.current?.abort()

    const controller = new AbortController()
    requestRef.current = controller

    if (!uuidSchema.safeParse(bomId).success) {
      setBom(null)
      setNotFound(true)
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const params = new URLSearchParams({
        id: bomId,
        page: '1',
        pageSize: '1',
      })

      const checkPermissions = async () => {
        try {
          const payload = await readApiResultOrThrow<unknown>(
            '/api/auth/feature-check',
            {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                features: ['manufacturing.manage'],
              }),
            },
            {
              errorMessage: t(
                'manufacturing.boms.detail.permissionsFailed',
              ),
            },
          )

          const parsed = featureCheckResponseSchema.safeParse(
            payload,
          )

          if (!parsed.success) {
            return {
              canManage: false,
              failed: true,
            }
          }

          return {
            canManage: hasAllFeatures(
              ['manufacturing.manage'],
              parsed.data.granted,
            ),
            failed: false,
          }
        } catch {
          return {
            canManage: false,
            failed: true,
          }
        }
      }

      const [payload, permissions] = await Promise.all([
        readApiResultOrThrow<unknown>(
          `/api/manufacturing/boms?${params.toString()}`,
          { signal: controller.signal },
          {
            errorMessage: t(
              'manufacturing.boms.detail.loadFailed',
            ),
          },
        ),
        checkPermissions(),
      ])

      if (controller.signal.aborted) {
        return
      }

      const parsed = bomLookupResponseSchema.safeParse(payload)

      if (!parsed.success) {
        throw createCrudFormError(
          t('manufacturing.boms.detail.loadFailed'),
        )
      }

      const record = parsed.data.items[0] ?? null

      if (record && record.id !== bomId) {
        throw createCrudFormError(
          t('manufacturing.boms.detail.loadFailed'),
        )
      }

      setBom(record)
      setItemsReloadToken((current) => current + 1)
      setNotFound(record === null)
      setError(null)
      setCanManageManufacturing(permissions.canManage)
      setPermissionsFailed(permissions.failed)
    } catch (loadError) {
      if (controller.signal.aborted) {
        return
      }

      setBom(null)
      setCanManageManufacturing(false)

      if (
        typeof loadError === 'object'
        && loadError !== null
        && 'status' in loadError
        && loadError.status === 404
      ) {
        setNotFound(true)
        setError(null)
        return
      }

      setNotFound(false)
      setError(t('manufacturing.boms.detail.loadFailed'))

      throw loadError
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [bomId, t])


  useEffect(() => {
    void reloadBom().catch(() => { })

    return () => {
      requestRef.current?.abort()
    }
  }, [reloadBom])

  const backButton = (
    <Button
      type="button"
      variant="outline"
      onClick={handleCancel}
    >
      {t('manufacturing.boms.detail.back')}
    </Button>
  )

  if (isLoading && !bom) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage
            label={t('manufacturing.boms.detail.loading')}
          />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('manufacturing.boms.detail.notFound')}
            action={backButton}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !bom) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={
              error ?? t('manufacturing.boms.detail.loadFailed')
            }
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void reloadBom().catch(() => { })
                  }}
                >
                  {t('manufacturing.bomItems.list.refresh')}
                </Button>

                {backButton}
              </div>
            }
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('manufacturing.boms.detail.title')}
        description={t('manufacturing.boms.detail.revision', {
          revision: bom.revision,
        })}
        actions={
          <>
            <BomStatusBadges bom={bom} />
            {bom.status === 'released' ? <BomAvailabilityBadge availability={bom.availability} /> : null}

            {bom.status === 'draft' && canManageManufacturing ? (
              <BomReleaseAction
                bom={bom}
                disabled={isLoading || permissionsFailed}
                onReleased={reloadBom}
                onBlocked={setReleaseViolations}
              />
            ) : null}

            {canManageManufacturing ? <BomDeleteAction bom={bom} disabled={isLoading || permissionsFailed} onRefresh={reloadBom} onBlocked={setDeletionBlocked} /> : null}

            {backButton}
          </>
        }
      />

      <PageBody>
        {deletionBlocked ? <BomDeletionBlockedNotice failure={deletionBlocked} revision={bom.revision} /> : null}
        {bom.status === 'released' ? (
          <BomAvailabilityToggle
            bom={bom}
            canManage={canManageManufacturing}
            disabled={isLoading || permissionsFailed}
            onChanged={reloadBom}
          />
        ) : null}
        <BomReleaseBlockedNotice
          violations={releaseViolations}
        />
        {permissionsFailed ? (
          <ErrorMessage
            label={t(
              'manufacturing.boms.detail.permissionsFailed',
            )}
          />
        ) : !canManageManufacturing ? (
          <p className="text-sm text-muted-foreground">
            {t('manufacturing.forms.readOnly')}
          </p>
        ) : null}

        {bom.status === 'released' && bom.isIncomplete ? (
          <Alert status="warning" style="light" size="default">
            {t('manufacturing.boms.incomplete.warning')}
          </Alert>
        ) : null}

        {bom.status !== 'released' ? (<BomForm
          mode="edit"
          initialValues={bom}
          readOnly={!canManageManufacturing}
          onCancel={handleCancel}
          onSaved={reloadBom}
        />) : null}

        <BomItemsSection
          key={`${bom.id}:${itemsReloadToken}`}
          bom={bom}
          canManage={canManageManufacturing}
        />
      </PageBody>
    </Page>
  )
}
