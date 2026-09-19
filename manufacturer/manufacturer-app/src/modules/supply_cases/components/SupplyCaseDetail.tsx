"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { AccessDeniedMessage, ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { RadioGroup, Radio } from '@open-mercato/ui/primitives/radio'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { SupplyCaseDetailResponse } from '../data/read-model'
import SupplyActivityTimeline from './SupplyActivityTimeline'

export default function SupplyCaseDetail({ id }: { id: string }) {
  const t = useT()
  const headingRef = React.useRef<HTMLDivElement>(null)
  const query = useQuery<SupplyCaseDetailResponse | null>({
    queryKey: ['supply_cases:detail', id],
    queryFn: () => readApiResultOrThrow<SupplyCaseDetailResponse>(
      `/api/supply_cases/${encodeURIComponent(id)}`,
      undefined,
      { allowNullResult: true, errorMessage: t('supply_cases.detail.error') },
    ),
  })

  React.useEffect(() => {
    if (query.data) headingRef.current?.focus()
  }, [query.data])

  if (query.isLoading) return <LoadingMessage label={t('supply_cases.detail.loading')} />
  if (query.error) {
    if (query.error instanceof ForbiddenError) {
      return <AccessDeniedMessage label={t('supply_cases.detail.permissionDenied')} description={t('supply_cases.detail.permissionDeniedDescription')} />
    }
    return <ErrorMessage label={t('supply_cases.detail.error')} action={<Button variant="outline" onClick={() => void query.refetch()}>{t('supply_cases.detail.retry')}</Button>} />
  }
  if (!query.data) {
    return <RecordNotFoundState label={t('supply_cases.detail.notFound')} description={t('supply_cases.detail.notFoundDescription')} backHref="/backend/supply-cases" backLabel={t('supply_cases.detail.back')} />
  }

  const detail = query.data
  const risk = detail.liveCoverage?.riskStatus ?? 'NO_PLAN'
  const customerImpact = detail.customerImpact
  const liveCoverage = detail.liveCoverage
  const baselineCoverage = detail.baselineCoverage

  return (
    <div className="space-y-6">
      <PageHeader
        leading={<Link className="text-sm underline-offset-4 hover:underline" href="/backend/supply-cases">{t('supply_cases.detail.back')}</Link>}
        title={detail.case.correlationId}
        description={`${detail.need.sku} · ${detail.need.requiredQuantity} · ${formatDate(detail.need.requiredDate)}`}
        actions={<StatusBadge variant={getStatusVariant(detail.case.status)} dot>{translateEnum(t, 'supply_cases.status', detail.case.status)}</StatusBadge>}
      />

      <div ref={headingRef} tabIndex={-1} className="sr-only" aria-live="polite">{detail.case.correlationId}</div>

      {detail.missingProductionOrderIds.length > 0 ? (
        <Alert status="warning">
          {t('supply_cases.detail.missingOrders', { count: detail.missingProductionOrderIds.length })}
        </Alert>
      ) : null}
      {!detail.productionPlan ? (
        <Alert status="warning">{t('supply_cases.detail.missingPlan')}</Alert>
      ) : null}
      {detail.dataQuality !== 'complete' ? (
        <Alert status={detail.dataQuality === 'degraded' ? 'error' : 'warning'}>
          <div className="space-y-1">
            <p className="font-medium">{t(`supply_cases.detail.dataQuality.${detail.dataQuality}`)}</p>
            {detail.dataQualityReasons.map((reason) => <p key={reason}>{t(`supply_cases.detail.dataQualityReason.${toCamelCase(reason)}`)}</p>)}
          </div>
        </Alert>
      ) : null}

      <section aria-labelledby="supply-case-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <h2 id="supply-case-summary" className="sr-only">{t('supply_cases.detail.summary')}</h2>
        <SummaryKpi label={t('supply_cases.detail.liveCoverage')} value={liveCoverage ? `${liveCoverage.coveredQuantity}/${liveCoverage.requiredQuantity}` : t('supply_cases.table.noPlan')} />
        <SummaryKpi label={t('supply_cases.detail.missing')} value={String(detail.shortage)} />
        <SummaryKpi label={t('supply_cases.detail.risk')} value={risk === 'NO_PLAN' ? t('supply_cases.risk.noPlan') : translateEnum(t, 'supply_cases.risk', risk)} badgeVariant={getRiskVariant(risk)} />
        <SummaryKpi label={t('supply_cases.detail.customerImpact')} value={translateEnum(t, 'supply_cases.customerImpact', customerImpact.status)} badgeVariant={getCustomerImpactVariant(customerImpact.status)} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <DetailSection title={t('supply_cases.detail.needAndImpact')}>
          <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            <DetailField label={t('supply_cases.detail.material')} value={detail.need.sku} />
            <DetailField label={t('supply_cases.detail.requiredQuantity')} value={String(detail.need.requiredQuantity)} />
            <DetailField label={t('supply_cases.detail.requiredDate')} value={formatDate(detail.need.requiredDate)} />
            <DetailField label={t('supply_cases.detail.customer')} value={customerImpact.customerName ?? t('supply_cases.detail.notAvailable')} />
            <DetailField label={t('supply_cases.detail.commitmentDate')} value={customerImpact.commitmentDate ? formatDate(customerImpact.commitmentDate) : t('supply_cases.detail.notAvailable')} />
            <DetailField label={t('supply_cases.detail.earliestBreach')} value={customerImpact.earliestBreachDate ? formatDate(customerImpact.earliestBreachDate) : t('supply_cases.detail.notAvailable')} />
          </dl>
          <h3 className="pt-2 text-sm font-semibold">{t('supply_cases.detail.orders')}</h3>
          {detail.productionOrders.length > 0 ? detail.productionOrders.map((order) => (
            <dl key={order.id} className="grid gap-x-4 gap-y-2 border-b border-border py-3 text-sm sm:grid-cols-2">
              <DetailField label={t('supply_cases.detail.orderNumber')} value={order.orderNumber} />
              <DetailField label={t('supply_cases.detail.productSku')} value={order.productSku} />
              <DetailField label={t('supply_cases.detail.material')} value={`${order.materialSku} · ${order.materialQuantity}`} />
              <DetailField label={t('supply_cases.detail.dueDate')} value={formatDate(order.dueDate)} />
              <DetailField label={t('supply_cases.detail.customer')} value={order.customerName} />
              <DetailField label={t('supply_cases.detail.orderStatus')} value={translateEnum(t, 'supply_cases.orderStatus', order.status)} />
              <DetailField label={t('supply_cases.detail.customerImpact')} value={translateEnum(t, 'supply_cases.customerImpact', detail.customerImpact.status)} />
            </dl>
          )) : <EmptySection message={t('supply_cases.detail.noOrders')} />}
        </DetailSection>

        <DetailSection title={t('supply_cases.detail.baselineVsLive')}>
          {detail.baseline ? (
            <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <DetailField label={t('supply_cases.detail.planNumber')} value={detail.baseline.planNumber} />
              <DetailField label={t('supply_cases.detail.internalStock')} value={String(detail.baseline.internalStockQuantity)} />
              <DetailField label={t('supply_cases.detail.baselineCoverage')} value={`${baselineCoverage?.coveredQuantity ?? 0}/${baselineCoverage?.requiredQuantity ?? detail.need.requiredQuantity}`} />
              <DetailField label={t('supply_cases.detail.persistedRisk')} value={translateEnum(t, 'supply_cases.risk', detail.baseline.persistedRiskStatus)} />
            </dl>
          ) : <EmptySection message={t('supply_cases.detail.noPlan')} />}
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">{t('supply_cases.detail.liveReality')}</h3>
            <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <DetailField label={t('supply_cases.detail.liveCoverage')} value={liveCoverage ? `${liveCoverage.coveredQuantity}/${liveCoverage.requiredQuantity}` : t('supply_cases.table.noPlan')} />
              <DetailField label={t('supply_cases.detail.shortage')} value={String(detail.liveReality.missingQuantity)} />
              <DetailField label={t('supply_cases.detail.lateQuantity')} value={String(detail.liveReality.lateQuantity)} />
              <DetailField label={t('supply_cases.detail.evidenceStatus')} value={t(`supply_cases.detail.evidence.${detail.liveReality.evidenceStatus}`)} />
            </dl>
          </div>
        </DetailSection>
      </div>

      <DetailSection title={t('supply_cases.detail.realCommitments')} count={detail.suppliers.length}>
        <div className="grid gap-4 lg:grid-cols-2">
          {detail.suppliers.map((supplier) => (
            <div key={supplier.role} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{t(`supply_cases.detail.${supplier.role === 'SUPPLIER_1' ? 'supplier1' : 'supplier2'}`)}</p>
                  <p className="text-sm text-muted-foreground">{supplier.supplierEmail ?? t('supply_cases.detail.notAvailable')}</p>
                </div>
                <StatusBadge variant={supplier.evidenceStatus === 'available' ? 'success' : supplier.evidenceStatus === 'pending' ? 'warning' : 'neutral'}>{t(`supply_cases.detail.evidence.${supplier.evidenceStatus}`)}</StatusBadge>
              </div>
              {supplier.offerLines.length > 0 ? supplier.offerLines.map((line, index) => (
                <div key={`${supplier.role}:${line.deliveryDate}:${index}`} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                  <span>{line.quantity} · {formatDate(line.deliveryDate)}</span>
                  <span className="text-muted-foreground">{line.price !== null ? `${line.price} ${line.currency ?? ''}` : t('supply_cases.detail.priceUnavailable')}</span>
                </div>
              )) : <p className="mt-3 text-sm text-muted-foreground">{t('supply_cases.detail.noSupplierEvidence')}</p>}
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={t('supply_cases.detail.analysis')}>
        <AnalysisRow label={t('supply_cases.detail.initialAnalysis')} analysis={detail.analyses.initial} unavailableLabel={t('supply_cases.detail.analysisUnavailable')} />
        <AnalysisRow label={t('supply_cases.detail.finalAnalysis')} analysis={detail.analyses.final} unavailableLabel={t('supply_cases.detail.analysisUnavailable')} />
        <p className="mt-3 text-sm text-muted-foreground">
          {t('supply_cases.detail.proposals', { initial: detail.proposals.initialOptionCount, plans: detail.proposals.resolutionPlanCount })}
        </p>
        <InitialDecisionPanel detail={detail} onApplied={() => void query.refetch()} />
      </DetailSection>

      <DetailSection title={t('supply_cases.detail.resolutionPlans')} count={detail.proposals.resolutionPlans.length}>
        <ResolutionPlansPanel detail={detail} />
      </DetailSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <DetailSection title={t('supply_cases.detail.confirmations')} count={detail.confirmationChecklist.length}>
          {detail.confirmationChecklist.length > 0 ? detail.confirmationChecklist.map((item) => (
            <div key={item.requirementId} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 text-sm">
              <div>
                <p className="font-medium">{item.supplierEmail ?? t('supply_cases.detail.notAvailable')}</p>
                <p className="text-muted-foreground">{item.quantity} · {formatDate(item.deliveryDate)}</p>
                {item.evidenceRef ? <p className="text-xs text-muted-foreground">{t('supply_cases.detail.evidenceReference')}: {item.evidenceRef}</p> : null}
              </div>
              <StatusBadge variant={getConfirmationVariant(item.status)}>{t(`supply_cases.confirmation.${item.status}`)}</StatusBadge>
            </div>
          )) : <EmptySection message={detail.proposals.selectedResolutionPlanId ? t('supply_cases.detail.confirmationsUnavailable') : t('supply_cases.detail.confirmationsNotApplicable')} />}
        </DetailSection>

        <DetailSection title={t('supply_cases.detail.finalGate')}>
          {detail.resolutionGate.isGreen ? <Alert status="success">{t('supply_cases.detail.greenResolved', { covered: detail.resolutionGate.coveredOnTime, required: detail.resolutionGate.requiredQuantity })}</Alert> : <Alert status="warning">{t('supply_cases.detail.finalGateBlocked')}</Alert>}
          <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            <DetailField label={t('supply_cases.detail.gateCoverage')} value={`${detail.resolutionGate.coveredOnTime}/${detail.resolutionGate.requiredQuantity}`} />
            <DetailField label={t('supply_cases.detail.gateMissing')} value={String(detail.resolutionGate.missingQuantity)} />
            <DetailField label={t('supply_cases.detail.gateRisk')} value={translateEnum(t, 'supply_cases.risk', detail.resolutionGate.riskStatus)} />
            <DetailField label={t('supply_cases.detail.gateConfirmations')} value={detail.resolutionGate.confirmationsComplete ? t('supply_cases.confirmation.complete') : t('supply_cases.confirmation.pending')} />
            <DetailField label={t('supply_cases.detail.gatePlan')} value={detail.resolutionGate.planApplicable ? t('supply_cases.detail.gatePlanValid') : t('supply_cases.detail.gatePlanMissing')} />
            <DetailField label={t('supply_cases.detail.gateStatus')} value={translateEnum(t, 'supply_cases.status', detail.resolutionGate.caseStatus)} />
          </dl>
          {detail.resolutionGate.blockers.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{detail.resolutionGate.blockers.map((blocker) => <li key={blocker}>{t(`supply_cases.detail.blocker.${toCamelCase(blocker)}`)}</li>)}</ul> : null}
        </DetailSection>
      </div>

      <DetailSection title={t('supply_cases.detail.timeline')} count={detail.timeline.filter((event) => event.type === 'message').length}>
        {detail.timeline.filter((event) => event.type === 'message').map((message) => (
          <article key={message.id} id={`message-${encodeURIComponent(message.id)}`} className="space-y-2 border-b border-border py-3 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{t('supply_cases.timeline.inboundMessage')}</p>
              <time className="text-xs text-muted-foreground" dateTime={message.timestamp}>{formatDate(message.timestamp)}</time>
            </div>
            {message.senderEmail ? <p className="text-sm text-muted-foreground">{message.senderEmail}</p> : null}
            {message.messageIntent ? <p className="text-sm text-muted-foreground">{t(`supply_cases.messageType.${toCamelCase(message.messageIntent)}`)}</p> : null}
            {message.body ? <p className="whitespace-pre-wrap text-sm">{message.body}</p> : <p className="text-sm text-muted-foreground">{t('supply_cases.detail.messageContentUnavailable')}</p>}
          </article>
        ))}
        {detail.timeline.every((event) => event.type !== 'message') ? <EmptySection message={t('supply_cases.detail.noMessages')} /> : null}
      </DetailSection>

      <SupplyActivityTimeline caseId={detail.case.id} />

      <p className="text-xs text-muted-foreground">{t('supply_cases.detail.updatedAt', { value: formatDate(detail.updatedAt) })}</p>
    </div>
  )
}

function InitialDecisionPanel({ detail, onApplied }: { detail: SupplyCaseDetailResponse; onApplied: () => void }) {
  const t = useT()
  const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({
    contextId: `supply_cases.initial-decision.${detail.case.id}`,
  })
  const actionable = detail.availableActions.includes('apply_initial_sourcing_decision')

  const submit = React.useCallback(async () => {
    if (!selectedOptionId || !detail.proposals.initialProposalId || !detail.proposals.factsHash) return
    setSaving(true)
    setError(null)
    const payload = {
      proposalId: detail.proposals.initialProposalId,
      factsHash: detail.proposals.factsHash,
      kind: 'SELECT' as const,
      selectedOptionId,
      reason: null,
      idempotencyKey: `${detail.case.id}:${detail.proposals.initialProposalId}:${selectedOptionId}`,
    }
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(detail.updatedAt),
          () => readApiResultOrThrow(`/api/supply_cases/${encodeURIComponent(detail.case.id)}/decision`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        ),
        context: { resourceType: 'supply_cases.case', resourceId: detail.case.id },
        mutationPayload: payload,
      })
      onApplied()
    } catch (caught) {
      setError(t('supply_cases.decision.error'))
      if (caught && typeof caught === 'object' && (caught as { status?: unknown }).status === 409) onApplied()
    } finally {
      setSaving(false)
    }
  }, [detail, onApplied, runMutation, selectedOptionId, t])

  if (detail.proposals.initialOptions.length !== 3) return null
  return (
    <div className="mt-4 space-y-3" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && actionable && selectedOptionId && !saving) {
        event.preventDefault()
        void submit()
      }
    }}>
      <RadioGroup value={selectedOptionId ?? undefined} onValueChange={setSelectedOptionId} aria-label={t('supply_cases.decision.title')} className="grid gap-3" disabled={!actionable || saving}>
        {detail.proposals.initialOptions.map((option) => (
          <label key={option.id} className="rounded-md border border-border p-3">
            <span className="flex items-start gap-3">
              <Radio value={option.id} aria-label={t(`supply_cases.decision.option.${toCamelCase(option.id)}`)} />
              <span className="space-y-1">
                <span className="block font-medium">{t(`supply_cases.decision.option.${toCamelCase(option.id)}`)}</span>
                <span className="block text-sm text-muted-foreground">
                  {t('supply_cases.decision.coverage', { covered: option.onTimeCoverage, required: detail.case.requiredQuantity, shortage: option.shortageOnRequiredDate })}
                </span>
                <span className="block text-sm text-muted-foreground">{t(`supply_cases.decision.feasibility.${toCamelCase(option.feasibility)}`)}</span>
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {detail.analyses.initial.recommendedOptionId ? (
        <p className="text-sm text-muted-foreground">{t('supply_cases.decision.recommended', { option: t(`supply_cases.decision.option.${toCamelCase(detail.analyses.initial.recommendedOptionId)}`) })}</p>
      ) : null}
      {error ? <Alert status="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!actionable || !selectedOptionId || saving} onClick={() => void submit()}>
          {saving ? t('supply_cases.decision.saving') : t('supply_cases.decision.apply')}
        </Button>
        {error ? <Button variant="outline" onClick={onApplied}>{t('supply_cases.detail.retry')}</Button> : null}
      </div>
    </div>
  )
}

function ResolutionPlansPanel({ detail }: { detail: SupplyCaseDetailResponse }) {
  const t = useT()
  const [selectedPlanId, setSelectedPlanId] = React.useState<string | null>(detail.proposals.selectedResolutionPlanId)
  const actionable = detail.availableActions.includes('apply_resolution_decision')

  React.useEffect(() => {
    setSelectedPlanId(detail.proposals.selectedResolutionPlanId)
  }, [detail.case.id, detail.proposals.selectedResolutionPlanId])

  if (detail.proposals.resolutionPlans.length === 0) {
    return <Alert status="warning">{t('supply_cases.detail.resolutionDependency')}</Alert>
  }
  if (detail.proposals.resolutionPlans.length !== 3) {
    return <Alert status="error">{t('supply_cases.detail.invalidResolutionPlans')}</Alert>
  }

  return (
    <div className="space-y-3" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && actionable && selectedPlanId) event.preventDefault()
    }}>
      <RadioGroup value={selectedPlanId ?? undefined} onValueChange={setSelectedPlanId} aria-label={t('supply_cases.detail.resolutionPlans')} className="grid gap-3 lg:grid-cols-3" disabled={!actionable}>
        {detail.proposals.resolutionPlans.map((plan) => (
          <label key={plan.id} className="rounded-md border border-border p-3">
            <span className="flex items-start gap-3">
              <Radio value={plan.id} aria-label={translatePlan(t, plan.id)} />
              <span className="space-y-2">
                <span className="block font-medium">{translatePlan(t, plan.id)}</span>
                <span className="block text-sm text-muted-foreground">{t('supply_cases.detail.planCoverage', { covered: plan.coverage.onTimeQuantity, required: detail.need.requiredQuantity, shortage: plan.coverage.shortage })}</span>
                <span className="block text-sm text-muted-foreground">{t('supply_cases.detail.planFeasibility', { value: t(`supply_cases.decision.feasibility.${toCamelCase(plan.feasibility)}`) })}</span>
                <span className="block text-sm text-muted-foreground">{t('supply_cases.detail.planAllocation', { supplier1: formatPlanCommitments(t, plan.supplier1Commitments), supplier2: formatPlanCommitments(t, plan.supplier2Commitments), stock: plan.stock.allocated })}</span>
                <span className="block text-sm text-muted-foreground">{t('supply_cases.detail.planImpact', { production: translateEnum(t, 'supply_cases.impact', plan.coverage.productionImpact), customer: translateEnum(t, 'supply_cases.impact', plan.coverage.customerImpact) })}</span>
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="text-sm text-muted-foreground">{t('supply_cases.detail.noPreselection')}</p>
      {!actionable ? <Alert status="information">{t('supply_cases.detail.resolutionActionDependency')}</Alert> : null}
    </div>
  )
}

function SummaryKpi({ label, value, badgeVariant }: { label: string; value: string; badgeVariant?: StatusBadgeVariant }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {badgeVariant ? <StatusBadge variant={badgeVariant} dot>{value}</StatusBadge> : <p className="mt-1 text-lg font-semibold">{value}</p>}
    </div>
  )
}

function DetailSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4" aria-labelledby={title}>
      <SectionHeader title={title} count={count} />
      {children}
    </section>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>
}

function EmptySection({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>
}

function AnalysisRow({ label, analysis, unavailableLabel }: { label: string; analysis: SupplyCaseDetailResponse['analyses']['initial']; unavailableLabel: string }) {
  return <div className="border-b border-border py-3 text-sm"><p className="font-medium">{label}</p><p className="text-muted-foreground">{analysis.summary ?? unavailableLabel}</p></div>
}

function translateEnum(t: (key: string, params?: Record<string, string | number>) => string, prefix: string, value: string): string {
  return t(`${prefix}.${toCamelCase(value)}`)
}

function toCamelCase(value: string): string {
  const [first, ...rest] = value.toLowerCase().split('_')
  return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function getStatusVariant(status: string): StatusBadgeVariant {
  if (status === 'RESOLVED') return 'success'
  if (status === 'NEEDS_ATTENTION' || status === 'REJECTED') return 'error'
  if (status === 'AWAITING_SOURCING_DECISION' || status === 'AWAITING_RESOLUTION_APPROVAL') return 'warning'
  return 'info'
}

function getRiskVariant(risk: string): StatusBadgeVariant {
  if (risk === 'PROTECTED') return 'success'
  if (risk === 'AT_RISK') return 'warning'
  if (risk === 'BREACHED') return 'error'
  return 'neutral'
}

function getCommitmentVariant(status: string): StatusBadgeVariant {
  if (status === 'CONFIRMED' || status === 'COMMITTED') return 'success'
  if (status === 'CANCELLED') return 'error'
  return 'warning'
}

function getCustomerImpactVariant(status: string): StatusBadgeVariant {
  if (status === 'on_time') return 'success'
  if (status === 'breached') return 'error'
  if (status === 'at_risk') return 'warning'
  return 'neutral'
}

function getConfirmationVariant(status: string): StatusBadgeVariant {
  if (status === 'confirmed') return 'success'
  if (status === 'mismatch' || status === 'delivery_failed') return 'error'
  if (status === 'expired') return 'warning'
  return 'neutral'
}

function translatePlan(t: (key: string, params?: Record<string, string | number>) => string, id: string): string {
  return t(`supply_cases.resolution.plan.${toCamelCase(id)}`)
}

function formatPlanCommitments(t: (key: string, params?: Record<string, string | number>) => string, commitments: Array<{ quantity: number; date: string; status: string }>): string {
  if (commitments.length === 0) return t('supply_cases.table.none')
  return commitments.map((commitment) => `${commitment.quantity} @ ${commitment.date} (${translateEnum(t, 'supply_cases.commitmentIntent', commitment.status)})`).join(', ')
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
