'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type {
  ExecutionDocumentListItem,
  ExecutionOperationListItem,
  ProductionExecutionListItem,
} from '../../data/validators'
import { ORDER_STATUS_BADGES } from '../orders/orderListConfig'
import { useLocationLabels, useVariantLabels } from '../shared/useReferenceLabels'
import { ExecutionActionDialog } from './ExecutionActionDialog'
import { ExecutionDocumentsSection } from './ExecutionDocumentsSection'
import { ExecutionSummarySection } from './ExecutionSummarySection'
import {
  EXECUTION_DOCUMENTS_API_PATH,
  EXECUTION_OPERATIONS_API_PATH,
  EXECUTIONS_API_PATH,
  EXECUTIONS_BACKEND_PATH,
  summarizeExecution,
  type ExecutionActionKind,
} from './executionUi'
import { UnresolvedOperationsAlert } from './UnresolvedOperationsAlert'

type ListResponse<TItem> = { items: TItem[] }

const ACTIONS: ExecutionActionKind[] = ['issueMaterial', 'returnMaterial', 'confirmProduction']

async function loadList<TItem>(path: string, params: Record<string, string>): Promise<TItem[]> {
  const call = await apiCall<ListResponse<TItem>>(`${path}?${new URLSearchParams(params).toString()}`)

  if (!call.ok) throw new Error(String(call.status))

  return call.result?.items ?? []
}

export function ProductionExecutionDetail({ executionId }: { executionId: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chrome } = useBackendChrome()
  const [openAction, setOpenAction] = useState<ExecutionActionKind | null>(null)
  const canExecute = hasFeature(chrome?.grantedFeatures, 'manufacturing.execution.manage')
  const canReverse = hasFeature(chrome?.grantedFeatures, 'manufacturing.corrections.manage')

  const execution = useQuery({
    queryKey: ['manufacturing-execution', executionId, scopeVersion],
    queryFn: async () => (await loadList<ProductionExecutionListItem>(EXECUTIONS_API_PATH, { id: executionId }))[0] ?? null,
  })

  const documents = useQuery({
    queryKey: ['manufacturing-execution-documents', executionId, scopeVersion],
    queryFn: () => loadList<ExecutionDocumentListItem>(EXECUTION_DOCUMENTS_API_PATH, { executionId, pageSize: '100' }),
  })

  const unresolved = useQuery({
    queryKey: ['manufacturing-execution-unresolved', executionId, scopeVersion],
    queryFn: () => loadList<ExecutionOperationListItem>(EXECUTION_OPERATIONS_API_PATH, { executionId, unresolved: 'true' }),
  })

  const record = execution.data
  const documentList = documents.data ?? []
  const variantLabels = useVariantLabels([
    record?.productVariantId,
    ...documentList.flatMap((document) => document.facts.map((fact) => fact.variantId)),
  ])
  const locationLabels = useLocationLabels([
    record?.sourceLocationId,
    record?.targetLocationId,
    ...documentList.flatMap((document) => document.facts.map((fact) => fact.locationId)),
  ])

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['manufacturing-execution-documents', executionId] })
    void queryClient.invalidateQueries({ queryKey: ['manufacturing-execution-unresolved', executionId] })
  }

  if (execution.isLoading) return <LoadingMessage label={t('manufacturing.executions.detail.loading')} />
  if (execution.error) return <ErrorMessage label={t('manufacturing.executions.detail.errors.load')} />

  if (!record) {
    return (
      <RecordNotFoundState
        label={t('manufacturing.executions.detail.notFound')}
        backHref={EXECUTIONS_BACKEND_PATH}
        backLabel={t('manufacturing.executions.detail.back')}
      />
    )
  }

  const summary = summarizeExecution(documentList, record.plannedQuantity)
  const label = (labels: Record<string, string>, id: string | null) => (id ? labels[id] ?? id : '—')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{record.executionNumber}</span>
            {record.orderNumber && record.orderStatus ? (
              <StatusBadge variant={ORDER_STATUS_BADGES[record.orderStatus]} dot>
                {record.orderNumber} · {t(`manufacturing.orders.status.${record.orderStatus}`)}
              </StatusBadge>
            ) : (
              <StatusBadge variant="neutral">{t('manufacturing.executions.withoutOrder')}</StatusBadge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t('manufacturing.executions.fields.productVariant')}</dt>
              <dd>{label(variantLabels, record.productVariantId)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('manufacturing.executions.fields.sourceLocation')}</dt>
              <dd>{label(locationLabels, record.sourceLocationId)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('manufacturing.executions.fields.targetLocation')}</dt>
              <dd>{label(locationLabels, record.targetLocationId)}</dd>
            </div>
          </dl>
          {record.orderId ? (
            <p className="text-sm text-muted-foreground">{t('manufacturing.executions.detail.orderContextHint')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canExecute
              ? ACTIONS.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    variant={action === 'confirmProduction' ? 'default' : 'outline'}
                    onClick={() => setOpenAction(action)}
                  >
                    {t(`manufacturing.executions.actions.${action}.title`)}
                  </Button>
                ))
              : null}
            <Button asChild variant="ghost">
              <Link href={EXECUTIONS_BACKEND_PATH}>{t('manufacturing.executions.detail.back')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <UnresolvedOperationsAlert operations={unresolved.data ?? []} canRetry={canExecute} onChanged={refresh} />

      <ExecutionSummarySection summary={summary} plannedQuantity={record.plannedQuantity} variantLabels={variantLabels} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('manufacturing.executions.history.title')}</h2>
        {documents.isLoading ? (
          <LoadingMessage label={t('manufacturing.executions.history.loading')} />
        ) : documents.error ? (
          <ErrorMessage label={t('manufacturing.executions.history.errors.load')} />
        ) : (
          <ExecutionDocumentsSection
            documents={documentList}
            variantLabels={variantLabels}
            locationLabels={locationLabels}
            canReverse={canReverse}
            onChanged={refresh}
          />
        )}
      </section>

      {openAction ? (
        <ExecutionActionDialog
          key={openAction}
          executionId={record.id}
          kind={openAction}
          open
          onClose={() => setOpenAction(null)}
          onPosted={refresh}
        />
      ) : null}
    </div>
  )
}
