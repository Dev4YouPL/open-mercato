"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ActivityList } from './SupplyActivityFeed'
import { useSupplyActivity } from './useSupplyActivity'

export default function SupplyActivityTimeline({ caseId }: { caseId: string }) {
  const t = useT()
  const stream = useSupplyActivity({ caseId, limit: 50, errorMessage: t('supply_cases.activity.error') })
  const items = React.useMemo(() => [...stream.items].reverse(), [stream.items])

  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4" aria-labelledby="supply-activity-timeline-title" aria-busy={stream.isLoading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="supply-activity-timeline-title" className="text-lg font-semibold">{t('supply_cases.activity.timelineTitle')}</h2>
        <Button variant="outline" onClick={stream.refresh} disabled={stream.isRefreshing} aria-label={t('supply_cases.activity.refresh')}>
          {t('supply_cases.activity.refresh')}
        </Button>
      </div>
      <div key={stream.updateSequence} className="sr-only" aria-live="polite">{!stream.isLive ? t('supply_cases.activity.disconnected') : stream.hasNewActivity ? t('supply_cases.activity.liveUpdate') : ''}</div>
      {stream.isLoading ? <LoadingMessage label={t('supply_cases.activity.loading')} /> : null}
      {stream.error && !stream.isLoading ? <ErrorMessage label={t('supply_cases.activity.error')} action={<Button variant="outline" onClick={stream.refresh}>{t('supply_cases.activity.retry')}</Button>} /> : null}
      {!stream.isLoading && !stream.error && items.length === 0 ? <EmptyState variant="subtle" size="sm" title={t('supply_cases.activity.empty')} /> : null}
      {!stream.isLoading && !stream.error && items.length > 0 ? <ActivityList items={items} t={t} /> : null}
      {stream.nextCursor ? <Button variant="outline" onClick={stream.loadOlder} disabled={stream.isLoadingOlder}>{t('supply_cases.activity.loadOlder')}</Button> : null}
    </section>
  )
}
