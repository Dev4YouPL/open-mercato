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
  inReplyToBusinessId: string | null
}
type NegotiationOption = { id: string; commitments: Commitment[]; feasible: boolean; policyDecision: string; executionFingerprint: string; distance: number; stockStatus?: 'ok' | 'diverged' | 'unavailable' }
type StockSnapshot = { takenAt: string; variantId: string; reservedForOrder: number; onHand: number; available: number; allocated: number; warehouses: number; source: 'wms'; fingerprint: string }
type Interpretation = {
  sourceMessageId: string
  outcome: string
  eligibility: { eligible: boolean; reason: string }
  sanitizer: { inputChars: number; outputChars: number; prescanHit: boolean; prescanRules: string[] }
  intent: Record<string, unknown> | null
  checks: { schema: string; consistency: string; grounding: string; confidenceOk: boolean }
  resolution: { today: string; tranches: Array<{ quantity: number; date: string; source: string; expression: string; placement: string }> } | null
  attempts: Array<{ attemptNo: number; startedAt: string; finishedAt: string | null; latencyMs: number | null; configuredProvider: string; configuredModel: string; effectiveProvider: string | null; effectiveModel: string | null; promptVersion: string; outcome: string | null; errorCode: string | null; usage: { inputTokens: number; outputTokens: number; reasoningTokens: number | null; known: boolean; partial: boolean } }>
  derivedCounterMessageId: string | null
}
type Negotiation = {
  origin?: 'envelope' | 'interpretation'
  counterRule: { ok: boolean; failed: string | null } | null
  evaluation: { id: string; evaluatedAt: string; turnAtEvaluation: number; maxTurns: number; reasonCodes: string[]; options: NegotiationOption[]; stock?: StockSnapshot; stockGate?: { w1: 'ok' | 'diverged' | 'unavailable'; snapshotReserved: number }; autoGates?: Record<string, 'pass' | 'fail' | 'n/a'> } | null
  agent: { state: string; activeRunId: string | null; skipReason: string | null; attempts: Array<{ attemptNo: number; runId: string; startedAt: string; leaseExpiresAt: string; finishedAt: string | null; auditState: string; outcome: string | null; usage: { inputTokens: number; outputTokens: number; known: boolean; partial: boolean } }> }
  recommendation: { id: string; source: string; optionId: string; commitments: Commitment[]; decision: string; reasonCodes: string[]; gates: Record<string, string>; autoEligible: boolean; createdAt: string } | null
  dispatch: { state: string; source: string | null; heldReason: string | null }
  verdict: { kind: string; by: string; at: string; reason: string } | null
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
  availableActions: Array<'retry' | 'reopen' | 'approve_counter' | 'reject_counter'>
  negotiation: Negotiation | null
  messages: SupplyCaseMessage[]
  interpretations: Interpretation[]
  timeline: Array<{ key: string; state: TimelineState; at: string | null; params: Record<string, string | number> }>
}

const TERMINAL_STATUSES = new Set(['resolved', 'needs_human', 'escalated', 'blocked_recipient', 'send_failed'])
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
  counter_received: 'warning',
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

function evidenceForIntent(intent: Record<string, unknown> | null): string[] {
  if (!intent || !Array.isArray(intent.tranches)) return []
  return intent.tranches.flatMap((tranche) => {
    if (!tranche || typeof tranche !== 'object' || !Array.isArray((tranche as { evidence?: unknown }).evidence)) return []
    return (tranche as { evidence: unknown[] }).evidence.filter((entry): entry is string => typeof entry === 'string')
  })
}

function highlightEvidence(text: string, evidence: string[], label: string): React.ReactNode {
  if (!text || evidence.length === 0) return text
  const matches = evidence
    .map((value) => ({ value, index: text.indexOf(value) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index || right.value.length - left.value.length)
  if (matches.length === 0) return text
  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((match, index) => {
    if (match.index < cursor) return
    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    parts.push(<mark key={`${match.value}-${index}`} aria-label={label} className="rounded-sm bg-status-warning-bg px-0.5 text-status-warning-text">{match.value}</mark>)
    cursor = match.index + match.value.length
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

export default function SupplyCaseConsole({ caseId }: { caseId: string }) {
  const t = useT()
  const { resolvedTheme } = useTheme()
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures ?? [], 'supplier_demo.supply_cases.manage')
  const canViewWms = hasFeature(payload?.grantedFeatures ?? [], 'wms.view')
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({ contextId: 'supplier-demo.supply-case.console' })
  const [pollCoolingDown, setPollCoolingDown] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [acknowledgeStockDivergence, setAcknowledgeStockDivergence] = React.useState(false)

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

  const runCounterAction = async (action: 'approve-counter' | 'reject-counter') => {
    const counter = [...detail.messages].reverse().find((message) => message.direction === 'inbound' && message.messageType === 'SUPPLY_COUNTER_PROPOSAL')
    if (!counter) return
    // Approving sends a revised proposal to the partner and rejecting closes the counter: both are confirmed first.
    const confirmed = await confirm({
      title: t(action === 'approve-counter' ? 'supplier_demo.supplyCases.console.approveCounterTitle' : 'supplier_demo.supplyCases.console.rejectCounterTitle'),
      description: t(action === 'approve-counter' ? 'supplier_demo.supplyCases.console.approveCounterDescription' : 'supplier_demo.supplyCases.console.rejectCounterDescription'),
      confirmText: t(action === 'approve-counter' ? 'supplier_demo.supplyCases.actions.approveCounter' : 'supplier_demo.supplyCases.actions.rejectCounter'),
    })
    if (!confirmed) return
    // The recommendation id pins the approval to what the operator actually saw.
    const payload = {
      supplyMessageId: counter.id,
      updatedAt: detail.updatedAt,
      recommendationId: detail.negotiation?.recommendation?.id,
      ...(action === 'approve-counter' && acknowledgeStockDivergence ? { acknowledgeStockDivergence: true } : {}),
    }
    setBusy(true)
    try {
      await runMutation({
        operation: () => readApiResultOrThrow(`/api/supplier_demo/supply-cases/${encodeURIComponent(detail.id)}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: { resourceType: 'supplier_demo:supply_case', resourceId: detail.id },
        mutationPayload: payload,
      })
      flash(t(action === 'approve-counter' ? 'supplier_demo.supplyCases.flash.counterApproved' : 'supplier_demo.supplyCases.flash.counterRejected'), 'success')
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) flash(t(action === 'approve-counter' ? 'supplier_demo.supplyCases.errors.counterApprove' : 'supplier_demo.supplyCases.errors.counterReject'), 'error')
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
            {canManage && detail.availableActions.includes('retry') ? (
              <Button variant="outline" disabled={busy} onClick={() => { void runCaseAction('retry') }}>{t('supplier_demo.supplyCases.console.retry')}</Button>
            ) : null}
            {canManage && detail.availableActions.includes('reopen') ? (
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

        {detail.interpretations.length > 0 ? (
          <Card>
            <CardHeader><CardTitle>{t('supplier_demo.supplyCases.detail.interpretation')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {detail.interpretations.map((interpretation) => {
                const sourceMessage = detail.messages.find((message) => message.id === interpretation.sourceMessageId)
                const evidence = evidenceForIntent(interpretation.intent)
                // The last attempt that did not return a usable object: the operator needs the reason, not just "failed".
                const failedAttempt = [...interpretation.attempts].reverse().find((attempt) => attempt.outcome && attempt.outcome !== 'ok')
                return (
                  <div key={interpretation.sourceMessageId} className="space-y-3 rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge variant={interpretation.outcome === 'counter_created' ? 'success' : interpretation.outcome === 'display_only' ? 'info' : 'warning'}>{t(`supplier_demo.supplyCases.interpretation.outcome.${interpretation.outcome}`, interpretation.outcome)}</StatusBadge>
                      {interpretation.intent && typeof interpretation.intent.confidence === 'number' ? <span className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.confidence')}: {Math.round(interpretation.intent.confidence * 100)}%</span> : null}
                      <span className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.interpretationAttempts')}: {interpretation.attempts.length}</span>
                    </div>
                    {failedAttempt ? (
                      <p className="text-status-error-text">
                        {t('supplier_demo.supplyCases.detail.interpretationFailure')}: {t(`supplier_demo.supplyCases.interpretation.attemptOutcome.${failedAttempt.outcome}`, failedAttempt.outcome ?? '')}
                        {failedAttempt.errorCode && failedAttempt.errorCode !== failedAttempt.outcome ? ` (${failedAttempt.errorCode})` : ''}
                        {failedAttempt.effectiveModel ? ` · ${failedAttempt.effectiveModel}` : ''}
                      </p>
                    ) : null}
                    {interpretation.intent && typeof interpretation.intent.summary === 'string' ? <p className="font-medium">{interpretation.intent.summary}</p> : null}
                    {sourceMessage?.bodyExcerpt ? (
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">{t('supplier_demo.supplyCases.detail.evidence')}</p>
                        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2">{highlightEvidence(sourceMessage.bodyExcerpt, evidence, t('supplier_demo.supplyCases.detail.evidence'))}</p>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{t('supplier_demo.supplyCases.detail.checkSchema')}: {interpretation.checks.schema}</span>
                      <span>{t('supplier_demo.supplyCases.detail.checkConsistency')}: {interpretation.checks.consistency}</span>
                      <span>{t('supplier_demo.supplyCases.detail.checkGrounding')}: {interpretation.checks.grounding}</span>
                    </div>
                    {interpretation.resolution ? <p className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.resolution')}: {formatCommitments(interpretation.resolution.tranches, none)}</p> : null}
                    {interpretation.intent ? <JsonDisplay data={interpretation.intent} theme={resolvedTheme === 'dark' ? 'dark' : 'light'} defaultExpanded={false} /> : null}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ) : null}

        {detail.negotiation ? (
          <Card>
            <CardHeader><CardTitle>{t('supplier_demo.supplyCases.detail.negotiation')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge variant={detail.negotiation.agent.state === 'succeeded' ? 'success' : detail.negotiation.agent.state === 'running' ? 'info' : 'warning'}>{t(`supplier_demo.supplyCases.agent.${detail.negotiation.agent.state}`, detail.negotiation.agent.state)}</StatusBadge>
                {detail.negotiation.recommendation ? <StatusBadge variant="info">{t('supplier_demo.supplyCases.detail.recommendationReady')}</StatusBadge> : null}
                {detail.negotiation.origin === 'interpretation' ? <StatusBadge variant="warning">{t('supplier_demo.supplyCases.detail.interpretedOrigin')}</StatusBadge> : null}
                <span className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.attempts')}: {detail.negotiation.agent.attempts.length}</span>
              </div>
              {detail.negotiation.origin === 'interpretation' && canViewWms && detail.negotiation.evaluation?.stock ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{t('supplier_demo.supplyCases.detail.stock')}</p>
                  <p className="text-muted-foreground">{t('supplier_demo.supplyCases.detail.stockAvailable')}: {detail.negotiation.evaluation.stock.available} · {t('supplier_demo.supplyCases.detail.stockReserved')}: {detail.negotiation.evaluation.stock.reservedForOrder}</p>
                  <p className="text-xs text-muted-foreground">{t('supplier_demo.supplyCases.detail.stockTakenAt')}: {formatTime(detail.negotiation.evaluation.stock.takenAt)}</p>
                  {detail.negotiation.evaluation.stockGate?.w1 === 'diverged' ? <p className="mt-2 text-status-warning-text">{t('supplier_demo.supplyCases.detail.stockDiverged')}</p> : null}
                </div>
              ) : null}
              {detail.negotiation.origin === 'interpretation' && detail.negotiation.evaluation?.autoGates ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="mb-2 font-medium">{t('supplier_demo.supplyCases.detail.automaticChecklist')}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {Object.entries(detail.negotiation.evaluation.autoGates).map(([gate, state]) => (
                      <div key={gate} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                        <span>{t(`supplier_demo.supplyCases.interpretation.auto.${gate}`, gate)}</span>
                        <StatusBadge variant={state === 'pass' ? 'success' : state === 'fail' ? 'error' : 'neutral'}>{t(`supplier_demo.supplyCases.interpretation.auto.${state}`, state)}</StatusBadge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {detail.negotiation.recommendation ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{t('supplier_demo.supplyCases.detail.recommendation')}: {detail.negotiation.recommendation.optionId}</p>
                  <p className="text-muted-foreground">{formatCommitments(detail.negotiation.recommendation.commitments, none)}</p>
                  <p className="text-muted-foreground">{detail.negotiation.recommendation.reasonCodes.join(', ')}</p>
                </div>
              ) : null}
              {detail.negotiation.evaluation?.options.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('supplier_demo.supplyCases.detail.options')}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {detail.negotiation.evaluation.options.map((option) => (
                      <div key={option.id} className="rounded-md border border-border p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{option.id}</span>
                          <StatusBadge variant={option.feasible ? option.policyDecision === 'auto_approved' ? 'success' : 'warning' : 'error'}>{option.feasible ? option.policyDecision : t('supplier_demo.supplyCases.detail.infeasible')}</StatusBadge>
                        </div>
                        <p className="mt-1 text-muted-foreground">{formatCommitments(option.commitments, none)}</p>
                        {option.stockStatus === 'diverged' ? <p className="mt-1 text-xs text-status-warning-text">{t('supplier_demo.supplyCases.detail.stockDiverged')}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {canManage && !detail.negotiation.verdict && detail.status === 'needs_human' ? (
                <div className="flex flex-wrap gap-2">
                  {detail.availableActions.includes('approve_counter') ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.negotiation.origin === 'interpretation' && detail.negotiation.evaluation?.stockGate?.w1 === 'diverged' ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={acknowledgeStockDivergence} onChange={(event) => setAcknowledgeStockDivergence(event.target.checked)} />
                          {t('supplier_demo.supplyCases.detail.acknowledgeStockDivergence')}
                        </label>
                      ) : null}
                      <Button disabled={busy || (detail.negotiation.evaluation?.stockGate?.w1 === 'diverged' && !acknowledgeStockDivergence)} onClick={() => { void runCounterAction('approve-counter') }}>{t('supplier_demo.supplyCases.actions.approveCounter')}</Button>
                    </div>
                  ) : null}
                  {detail.availableActions.includes('reject_counter') ? <Button variant="outline" disabled={busy} onClick={() => { void runCounterAction('reject-counter') }}>{t('supplier_demo.supplyCases.actions.rejectCounter')}</Button> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

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
