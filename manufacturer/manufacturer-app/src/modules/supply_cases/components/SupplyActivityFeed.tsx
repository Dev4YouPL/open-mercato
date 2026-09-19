"use client"

import * as React from 'react'
import Link from 'next/link'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getActivityIcon, getActivityStatusVariant } from './activityPresentation'
import { useSupplyActivity } from './useSupplyActivity'
import type { ActivityItem } from '../lib/activity/readActivity'

export default function SupplyActivityFeed() {
  const t = useT()
  const stream = useSupplyActivity({ limit: 20, errorMessage: t('supply_cases.activity.error') })

  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4" aria-labelledby="supply-activity-feed-title" aria-busy={stream.isLoading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="supply-activity-feed-title" className="text-lg font-semibold">{t('supply_cases.activity.globalTitle')}</h2>
        <Button variant="outline" onClick={stream.refresh} disabled={stream.isRefreshing} aria-label={t('supply_cases.activity.refresh')}>
          {t('supply_cases.activity.refresh')}
        </Button>
      </div>
      <div key={stream.updateSequence} className="sr-only" aria-live="polite">{!stream.isLive ? t('supply_cases.activity.disconnected') : stream.hasNewActivity ? t('supply_cases.activity.liveUpdate') : ''}</div>
      {stream.isLoading ? <LoadingMessage label={t('supply_cases.activity.loading')} /> : null}
      {stream.error && !stream.isLoading ? <ErrorMessage label={t('supply_cases.activity.error')} action={<Button variant="outline" onClick={stream.refresh}>{t('supply_cases.activity.retry')}</Button>} /> : null}
      {!stream.isLoading && !stream.error && stream.items.length === 0 ? <EmptyState variant="subtle" size="sm" title={t('supply_cases.activity.empty')} /> : null}
      {!stream.isLoading && !stream.error && stream.items.length > 0 ? (
        <ActivityList items={stream.items} t={t} compact />
      ) : null}
      {stream.nextCursor ? <Button variant="outline" onClick={stream.loadOlder} disabled={stream.isLoadingOlder}>{t('supply_cases.activity.loadOlder')}</Button> : null}
    </section>
  )
}

export function ActivityList({ items, t, compact = false }: { items: ActivityItem[]; t: (key: string, params?: Record<string, string | number>) => string; compact?: boolean }) {
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-3'} aria-label={t('supply_cases.activity.timelineTitle')}>
      {items.map((item) => <ActivityListItem key={item.id} item={item} t={t} compact={compact} />)}
    </ol>
  )
}

function ActivityListItem({ item, t, compact }: { item: ActivityItem; t: (key: string, params?: Record<string, string | number>) => string; compact: boolean }) {
  const Icon = getActivityIcon(item)
  const title = t(item.titleKey, titleParams(item))
  const detail = item.detailKey ? t(item.detailKey, detailParams(item, t)) : null
  return (
    <li id={`activity-${item.id}`} className="flex gap-3 border-l-2 border-border pl-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-medium">{title}</span>
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
        </div>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        {!compact && item.isStale ? <p className="text-muted-foreground">{t('supply_cases.activity.stale')}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={getActivityStatusVariant(item.status)}>{t(`supply_cases.activity.status.${item.status}`)}</StatusBadge>
          {item.caseId && item.caseCorrelationId ? <Link className="text-sm underline-offset-4 hover:underline" href={`/backend/supply-cases/${encodeURIComponent(item.caseId)}`}>{t('supply_cases.activity.caseLink', { caseId: item.caseCorrelationId })}</Link> : null}
          {!compact && item.evidence ? <Link className="text-sm underline-offset-4 hover:underline" href={item.evidence.href}>{t('supply_cases.activity.evidence')}</Link> : null}
          {!compact && item.technicalDetail ? <Link className="text-sm underline-offset-4 hover:underline" href={item.technicalDetail.href}>{t('supply_cases.activity.technicalDetails')}</Link> : null}
        </div>
      </div>
    </li>
  )
}

function titleParams(item: ActivityItem): Record<string, string | number> {
  return 'correlationId' in item.params ? { correlationId: item.params.correlationId } : {}
}

function detailParams(item: ActivityItem, t: (key: string, params?: Record<string, string | number>) => string): Record<string, string | number> {
  const params = item.params
  if ('deliveries' in params) {
    if ('supplierRole' in params && 'verdict' in params) {
      return { supplierRole: translateRole(params.supplierRole, t), verdict: translateVerdict(params.verdict, t), deliveries: params.deliveries.map((delivery) => `${delivery.quantity} · ${formatDate(delivery.date)}`).join(', ') }
    }
    return { deliveries: params.deliveries.map((delivery) => `${delivery.quantity} · ${formatDate(delivery.date)}`).join(', ') }
  }
  if ('requiredQuantity' in params && !('riskStatus' in params)) return params
  if ('attempt' in params) return { attempt: params.attempt }
  if ('missingQuantity' in params && 'requiredDate' in params) return { missingQuantity: params.missingQuantity, requiredDate: formatDate(params.requiredDate) }
  if ('correlationId' in params) return { correlationId: params.correlationId }
  if ('stage' in params) return { stage: translateStage(params.stage, t) }
  if ('supplierRole' in params && 'verdict' in params) return { supplierRole: translateRole(params.supplierRole, t), verdict: translateVerdict(params.verdict, t) }
  if ('coveredQuantity' in params) return { ...params, riskStatus: translateRisk(params.riskStatus, t) }
  return {}
}

function translateRole(role: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  return t(role === 'SUPPLIER_1' ? 'supply_cases.detail.supplier1' : 'supply_cases.detail.supplier2')
}

function translateStage(stage: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const [first, ...rest] = stage.toLowerCase().split('_')
  return t(`supply_cases.status.${first}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`)
}

function translateVerdict(verdict: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  return t(verdict === 'MATCHES_PLAN' ? 'supply_cases.activity.verdictMatchesPlan' : 'supply_cases.activity.verdictDiffersFromPlan')
}

function translateRisk(riskStatus: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const key = riskStatus === 'PROTECTED' ? 'protected' : riskStatus === 'AT_RISK' ? 'atRisk' : riskStatus === 'BREACHED' ? 'breached' : 'noPlan'
  return t(`supply_cases.risk.${key}`)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
