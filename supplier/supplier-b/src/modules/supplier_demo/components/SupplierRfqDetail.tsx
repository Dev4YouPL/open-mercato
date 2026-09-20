'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RfqDetail = { id: string; correlationId: string; subject: string; senderEmail: string; recipientEmail: string | null; rfcMessageId: string | null; rawBody: string; sku: string; requestedQuantity: number | null; requestedDeliveryDate: string | null; interpretationStatus: string; interpretationRecord: Record<string, unknown> | null; availabilitySnapshot: Record<string, unknown> | null; priceSnapshot: Record<string, unknown> | null; computedOffer: Record<string, unknown> | null; status: string; operatorDecision: string; sendStatus: string; replySubject: string | null; replyBody: string | null; lastError: string | null; history: Array<Record<string, unknown>>; updatedAt: string | null }

export default function SupplierRfqDetail({ id }: { id: string }) {
  const t = useT()
  const query = useQuery({ queryKey: ['supplier-demo-rfq', id], queryFn: async () => { const result = await apiCall<RfqDetail>(`/api/supplier_demo/rfqs/${encodeURIComponent(id)}`); if (!result.ok) throw new Error('rfq detail failed'); return result.result }, refetchOnWindowFocus: true })
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({ contextId: 'supplier-demo.rfq-detail' })
  if (query.isLoading) return <LoadingMessage label={t('supplier_demo.rfqs.states.loading')} />
  if (query.error || !query.data) return <ErrorMessage label={t('supplier_demo.rfqs.states.error')} action={<Button variant="outline" onClick={() => { void query.refetch() }}>{t('supplier_demo.rfqs.actions.reload')}</Button>} />
  const rfq = query.data
  const mutate = async (path: 'approve' | 'reject' | 'send', successKey: string) => {
    try {
      await runMutation({ operation: () => readApiResultOrThrow(`/api/supplier_demo/rfqs/${encodeURIComponent(rfq.id)}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: path === 'send' ? undefined : JSON.stringify({ updatedAt: rfq.updatedAt }) }), context: { resourceType: 'supplier_demo:supplier_rfq', resourceId: rfq.id }, mutationPayload: { updatedAt: rfq.updatedAt } })
      flash(t(successKey), 'success')
      await query.refetch()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) { await query.refetch(); return }
      flash(t('supplier_demo.rfqs.states.actionFailed'), 'error')
    }
  }
  const offer = rfq.computedOffer
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-2"><div><Link className="underline" href="/backend/supplier-demo/rfqs">{t('supplier_demo.rfqs.actions.back')}</Link><h1 className="text-xl font-semibold">{rfq.subject}</h1></div><span className="rounded-md border px-2 py-1 text-sm">{t(`supplier_demo.rfqs.status.${rfq.status}`)}</span></div>
    {rfq.lastError ? <Alert status="warning"><AlertDescription>{t(`supplier_demo.rfqs.reason.${rfq.lastError}`)}</AlertDescription></Alert> : null}
    <section className="rounded-md border p-4"><h2 className="font-semibold">{t('supplier_demo.rfqs.detail.original')}</h2><p className="text-sm">{rfq.senderEmail}</p><pre className="mt-2 whitespace-pre-wrap text-sm">{rfq.rawBody}</pre></section>
    <section className="rounded-md border p-4"><h2 className="font-semibold">{t('supplier_demo.rfqs.detail.facts')}</h2><dl className="grid gap-2 text-sm md:grid-cols-2"><div><dt className="text-muted-foreground">{t('supplier_demo.rfqs.table.sku')}</dt><dd>{rfq.sku}</dd></div><div><dt className="text-muted-foreground">{t('supplier_demo.rfqs.table.quantity')}</dt><dd>{rfq.requestedQuantity ?? t('supplier_demo.rfqs.states.noData')}</dd></div><div><dt className="text-muted-foreground">{t('supplier_demo.rfqs.table.deliveryDate')}</dt><dd>{rfq.requestedDeliveryDate ?? t('supplier_demo.rfqs.states.noData')}</dd></div><div><dt className="text-muted-foreground">{t('supplier_demo.rfqs.detail.interpretation')}</dt><dd>{rfq.interpretationStatus}</dd></div></dl></section>
    <section className="rounded-md border p-4"><h2 className="font-semibold">{t('supplier_demo.rfqs.detail.offer')}</h2>{offer ? <pre className="mt-2 whitespace-pre-wrap text-sm">{JSON.stringify(offer, null, 2)}</pre> : <p className="text-sm text-muted-foreground">{t('supplier_demo.rfqs.states.noOffer')}</p>}{rfq.replyBody ? <pre className="mt-2 whitespace-pre-wrap text-sm">{rfq.replyBody}</pre> : null}</section>
    <section className="flex flex-wrap gap-2"><Button onClick={() => { void mutate('approve', 'supplier_demo.rfqs.flash.approved') }} disabled={rfq.status !== 'ready_for_approval'}>{t('supplier_demo.rfqs.actions.approve')}</Button><Button variant="secondary" onClick={() => { void mutate('reject', 'supplier_demo.rfqs.flash.rejected') }} disabled={rfq.operatorDecision === 'rejected'}>{t('supplier_demo.rfqs.actions.reject')}</Button><Button variant="secondary" onClick={() => { void mutate('send', 'supplier_demo.rfqs.flash.sent') }} disabled={rfq.status !== 'send_held'}>{t('supplier_demo.rfqs.actions.send')}</Button></section>
    <section className="rounded-md border p-4"><h2 className="font-semibold">{t('supplier_demo.rfqs.detail.history')}</h2><ul className="list-disc pl-5 text-sm">{rfq.history.map((entry, index) => <li key={String(entry.id ?? index)}>{String(entry.action ?? '')} · {String(entry.at ?? '')}</li>)}</ul></section>
  </div>
}
