'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { StepIndicator, type StepIndicatorStatus } from '@open-mercato/ui/primitives/step-indicator'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useTheme } from '@open-mercato/ui/theme'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Commitment = { quantity: number; date: string }
type TimelineState = 'done' | 'current' | 'pending' | 'error' | 'skipped'
type SupplyCaseMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  messageType: string | null
  businessMessageId: string
  validationStatus: string | null
  validationReason: string | null
  deliveryStatus: string
  sender: string | null
  recipient: string | null
  subject: string
  bodyExcerpt: string | null
  envelope: Record<string, unknown> | null
  createdAt: string
  receivedAt: string | null
  queuedAt: string | null
  deliveredAt: string | null
  duplicateCount: number
}
type SupplyCaseDetail = {
  id: string
  correlationId: string
  orderNumber: string
  customerDisplayName: string | null
  sku: string
  status: string
  statusReason: string | null
  originalCommitment: Commitment[]
  currentCommitment: Commitment[]
  acceptedCommitment: Commitment[] | null
  cancelledCommitment: Commitment[] | null
  freedCapacity: Commitment[] | null
  updatedAt: string
  messages: SupplyCaseMessage[]
  timeline: Array<{ key: string; state: TimelineState; at: string | null; params: Record<string, string | number> }>
}

const TERMINAL_STATUSES = new Set(['resolved', 'needs_human', 'escalated', 'blocked_recipient', 'send_failed'])
const RETRYABLE_STATUSES = new Set(['send_failed', 'blocked_recipient', 'reply_received'])
const POLL_COOLDOWN_MS = 10_000
const LIVE_REFETCH_MS = 3_000

const caseStatusVariants: Record<string, StatusBadgeVariant> = {
  proposal_ready: 'info',
  proposal_queued: 'info',
  proposal_delivered: 'info',
  reply_received: 'info',
  commitment_updated: 'info',
  confirmation_queued: 'info',
  resolved: 'success',
  needs_human: 'warning',
  escalated: 'warning',
  blocked_recipient: 'warning',
  send_failed: 'error',
}

const validationVariants: Record<string, StatusBadgeVariant> = {
  valid: 'success',
  case_closed: 'neutral',
  case_not_awaiting_reply: 'neutral',
}

const deliveryVariants: Record<string, StatusBadgeVariant> = {
  delivered: 'success',
  queued_in_hub: 'info',
  sending: 'info',
  pending: 'neutral',
  enqueue_failed: 'error',
  delivery_failed: 'error',
}

const stepStatus: Record<TimelineState, StepIndicatorStatus> = {
  done: 'complete',
  current: 'current',
  pending: 'pending',
  skipped: 'pending',
  error: 'error',
}

function formatCommitments(value: Commitment[] | null | undefined, empty: string): string {
  return value?.length ? value.map((entry) => `${entry.quantity} · ${entry.date}`).join(', ') : empty
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : ''
}

export default function SupplyCaseConsole({ caseId }: { caseId: string }) {
  const t = useT()
  const { resolvedTheme } = useTheme()
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures ?? [], 'supplier_demo.supply_cases.manage')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({ contextId: 'supplier-demo.supply-case.console' })
  const [pollCoolingDown, setPollCoolingDown] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const detailQuery = useQuery({
    queryKey: ['supplier-demo-supply-case', caseId],
    queryFn: () => readApiResultOrThrow<SupplyCaseDetail>(`/api/supplier_demo/supply-cases/${encodeURIComponent(caseId)}`),
    refetchOnWindowFocus: true,
    // Replies and delivery events arrive asynchronously: keep the stage view live until the case settles.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_STATUSES.has(status) ? false : LIVE_REFETCH_MS
    },
  })

  React.useEffect(() => {
    if (!pollCoolingDown) return
    const timer = window.setTimeout(() => setPollCoolingDown(false), POLL_COOLDOWN_MS)
    return () => window.clearTimeout(timer)
  }, [pollCoolingDown])

  if (detailQuery.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('supplier_demo.supplyCases.states.loading')} /></PageBody></Page>
  }
  if (detailQuery.error || !detailQuery.data) {
    const notFound = (detailQuery.error as { status?: number } | null)?.status === 404
    return (
      <Page>
        <PageBody>
          {notFound
            ? <RecordNotFoundState label={t('supplier_demo.supplyCases.detail.notFound')} backHref="/backend/supplier-demo/supply-cases" backLabel={t('supplier_demo.supplyCases.detail.back')} />
            : <ErrorMessage label={t('supplier_demo.supplyCases.detail.loadError')} action={<Button variant="outline" onClick={() => { void detailQuery.refetch() }}>{t('supplier_demo.supplyCases.console.reload')}</Button>} />}
        </PageBody>
      </Page>
    )
  }

  const detail = detailQuery.data
  const none = t('supplier_demo.supplyCases.table.none')

  const pollMailbox = async () => {
    setBusy(true)
    try {
      const call = await apiCall<{ queued?: boolean; code?: string }>('/api/supplier_demo/mailbox/poll-now', { method: 'POST' })
      if (call.ok) {
        flash(t('supplier_demo.supplyCases.console.pollQueued'), 'success')
        setPollCoolingDown(true)
        window.setTimeout(() => { void detailQuery.refetch() }, LIVE_REFETCH_MS)
      } else {
        const code = call.result?.code ?? 'failed'
        flash(t(`supplier_demo.supplyCases.console.pollError.${code}`, t('supplier_demo.supplyCases.console.pollError.failed')), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const runCaseAction = async (action: 'retry' | 'reopen') => {
    if (action === 'reopen') {
      const confirmed = await confirm({
        title: t('supplier_demo.supplyCases.console.reopenTitle'),
        description: t('supplier_demo.supplyCases.console.reopenDescription'),
        confirmText: t('supplier_demo.supplyCases.actions.reopen'),
      })
      if (!confirmed) return
    }
    setBusy(true)
    try {
      await runMutation({
        operation: () => readApiResultOrThrow(`/api/supplier_demo/supply-cases/${encodeURIComponent(detail.id)}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ updatedAt: detail.updatedAt }),
        }),
        context: { resourceType: 'supplier_demo:supply_case', resourceId: detail.id },
        mutationPayload: { updatedAt: detail.updatedAt },
      })
      flash(t(action === 'reopen' ? 'supplier_demo.supplyCases.flash.reopened' : 'supplier_demo.supplyCases.flash.retryQueued'), 'success')
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t(action === 'reopen' ? 'supplier_demo.supplyCases.errors.reopen' : 'supplier_demo.supplyCases.errors.retry'), 'error')
      }
    } finally {
      setBusy(false)
      await detailQuery.refetch()
    }
  }

  const steps = detail.timeline.map((entry) => ({
    id: entry.key,
    status: stepStatus[entry.state],
    label: t(`supplier_demo.supplyCases.timeline.step.${entry.key}`),
    description: [
      entry.state === 'skipped'
        ? t('supplier_demo.supplyCases.timeline.skipped')
        // A step that has not happened yet has no values to show, so it gets no detail line.
        : entry.state === 'pending' ? '' : t(`supplier_demo.supplyCases.timeline.detail.${entry.key}`, '', {
          ...entry.params,
          ...(typeof entry.params.validation === 'string' ? { validation: t(`supplier_demo.supplyCases.validation.${entry.params.validation}`) } : {}),
          ...(typeof entry.params.reason === 'string' ? { reason: t(`supplier_demo.supplyCases.reason.${entry.params.reason}`) } : {}),
        }),
      formatTime(entry.at),
    ].filter(Boolean).join(' — '),
  }))

  return (
    <Page>
      <PageHeader
        title={`${detail.correlationId} · ${detail.orderNumber} · ${detail.sku}`}
        description={detail.customerDisplayName ?? undefined}
        titleAction={<StatusBadge variant={caseStatusVariants[detail.status] ?? 'neutral'} dot>{t(`supplier_demo.supplyCases.status.${detail.status}`)}</StatusBadge>}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Button variant="outline" disabled={busy || pollCoolingDown} onClick={() => { void pollMailbox() }}>
                <RefreshCw aria-hidden="true" className="size-4" />
                {t('supplier_demo.supplyCases.console.poll')}
              </Button>
            ) : null}
            {canManage && RETRYABLE_STATUSES.has(detail.status) ? (
              <Button variant="outline" disabled={busy} onClick={() => { void runCaseAction('retry') }}>{t('supplier_demo.supplyCases.console.retry')}</Button>
            ) : null}
            {canManage && detail.status === 'needs_human' ? (
              <Button disabled={busy} onClick={() => { void runCaseAction('reopen') }}>{t('supplier_demo.supplyCases.actions.reopen')}</Button>
            ) : null}
            <Button asChild variant="ghost"><Link href="/backend/supplier-demo/supply-cases">{t('supplier_demo.supplyCases.detail.back')}</Link></Button>
          </div>
        }
      />
      <PageBody className="space-y-4">
        <p className="sr-only" aria-live="polite">{t(`supplier_demo.supplyCases.status.${detail.status}`)}</p>
        {detail.statusReason ? (
          <Alert status={detail.status === 'send_failed' ? 'error' : 'warning'}>
            <AlertTitle>{t('supplier_demo.supplyCases.detail.attention')}</AlertTitle>
            <AlertDescription>{t(`supplier_demo.supplyCases.reason.${detail.statusReason}`, detail.statusReason)}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader><CardTitle>{t('supplier_demo.supplyCases.detail.commitments')}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted-foreground">{t('supplier_demo.supplyCases.table.original')}</dt><dd>{formatCommitments(detail.originalCommitment, none)}</dd></div>
              <div><dt className="text-muted-foreground">{t('supplier_demo.supplyCases.table.proposed')}</dt><dd>{formatCommitments(detail.currentCommitment, none)}</dd></div>
              <div><dt className="text-muted-foreground">{t('supplier_demo.supplyCases.table.accepted')}</dt><dd>{formatCommitments(detail.acceptedCommitment, none)}</dd></div>
              <div>
                <dt className="text-muted-foreground">{t('supplier_demo.supplyCases.table.cancelled')}</dt>
                <dd>{formatCommitments(detail.cancelledCommitment, none)}</dd>
                {detail.freedCapacity?.length ? <dd className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.freedCapacity')}: {formatCommitments(detail.freedCapacity, none)}</dd> : null}
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t('supplier_demo.supplyCases.console.salesOrderUnchanged')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('supplier_demo.supplyCases.detail.timeline')}</CardTitle></CardHeader>
          <CardContent><StepIndicator orientation="vertical" steps={steps} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('supplier_demo.supplyCases.detail.messages')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {detail.messages.length === 0 ? <p className="text-sm text-muted-foreground">{t('supplier_demo.supplyCases.console.noMessages')}</p> : null}
            {detail.messages.map((message) => (
              <article key={message.id} className="space-y-3 rounded-md border border-border p-3 text-sm" aria-label={message.subject}>
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-medium">{t(`supplier_demo.supplyCases.console.direction.${message.direction}`)} · {message.messageType ?? t('supplier_demo.supplyCases.console.unknownType')}</p>
                    <p className="text-muted-foreground">{message.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('supplier_demo.supplyCases.console.from')}: {message.sender ?? none} · {t('supplier_demo.supplyCases.console.to')}: {message.recipient ?? none} · {formatTime(message.receivedAt ?? message.deliveredAt ?? message.queuedAt ?? message.createdAt)}
                    </p>
                  </div>
                  {message.direction === 'inbound'
                    ? <StatusBadge variant={validationVariants[message.validationStatus ?? ''] ?? 'warning'}>{t(`supplier_demo.supplyCases.validation.${message.validationStatus ?? 'unknown'}`)}</StatusBadge>
                    : <StatusBadge variant={deliveryVariants[message.deliveryStatus] ?? 'neutral'}>{t(`supplier_demo.supplyCases.delivery.${message.deliveryStatus}`)}</StatusBadge>}
                </header>
                {message.duplicateCount > 0 ? <p className="text-xs text-muted-foreground">{t('supplier_demo.supplyCases.detail.duplicates', { count: message.duplicateCount })}</p> : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t('supplier_demo.supplyCases.console.humanText')}</p>
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-sans">{message.bodyExcerpt ?? none}</pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t('supplier_demo.supplyCases.console.envelope')}</p>
                    {message.envelope
                      ? <JsonDisplay data={message.envelope} theme={resolvedTheme === 'dark' ? 'dark' : 'light'} defaultExpanded />
                      : <p className="text-muted-foreground">{message.validationReason ? t(`supplier_demo.supplyCases.validation.${message.validationStatus ?? 'unknown'}`) : none}</p>}
                  </div>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
