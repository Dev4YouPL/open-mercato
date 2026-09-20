"use client"

import * as React from 'react'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = { availableQuantity?: number }
type OrderRow = { id: string; orderNumber?: string | null; number?: string | null }
type Failure = { status: number; code: string | null }

const ORDERS_HREF = '/backend/sales/orders'
const SUPPLY_CASES_HREF = '/backend/supplier-demo/supply-cases'

const formSchema = z.object({
  availableQuantity: z.number().int().min(0),
})

export default function ReportSupplyDisruptionForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const salesOrderId = searchParams?.get('orderId') ?? ''
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string }>({
    contextId: 'supplier-demo.report-supply-disruption',
  })

  const orderQuery = useQuery({
    queryKey: ['supplier-demo-report-disruption-order', salesOrderId],
    enabled: salesOrderId.length > 0,
    queryFn: () => fetchCrudList<OrderRow>('sales/orders', { id: salesOrderId, page: 1, pageSize: 1 }),
  })
  const order = orderQuery.data?.items?.[0]
  const orderNumber = order?.orderNumber ?? order?.number ?? null

  const fields = React.useMemo<CrudField[]>(() => [{
    id: 'availableQuantity',
    type: 'number',
    label: t('supplier_demo.supplyCases.dialog.availableQuantity'),
    description: t('supplier_demo.supplyCases.dialog.quantityHelp'),
    required: true,
  }], [t])

  const handleSubmit = React.useCallback(async (values: FormValues) => {
    if (!salesOrderId) throw createCrudFormError(t('supplier_demo.supplyCases.errors.orderMissing'))
    if (!Number.isInteger(values.availableQuantity) || Number(values.availableQuantity) < 0) {
      throw createCrudFormError(t('supplier_demo.supplyCases.errors.quantity'))
    }
    let failure: Failure | null = null
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ caseId?: string; status?: string; code?: string }>('/api/supplier_demo/supply-cases/report-disruption', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ salesOrderId, availableQuantity: values.availableQuantity }),
          })
          if (!call.ok) {
            failure = { status: call.status, code: typeof call.result?.code === 'string' ? call.result.code : null }
            throw new Error(`report-disruption failed (${call.status})`)
          }
          return call.result
        },
        context: { resourceType: 'supplier_demo:supply_case', resourceId: salesOrderId },
        mutationPayload: { salesOrderId, availableQuantity: values.availableQuantity },
      })
    } catch (error) {
      const known = failure as Failure | null
      const status = known?.status ?? normalizeCrudServerError(error).status
      const code = known?.code ?? null
      if (status === 409) {
        flash(t('supplier_demo.supplyCases.errors.caseExists'), 'error')
        router.push(SUPPLY_CASES_HREF)
        return
      }
      if (status === 403) throw createCrudFormError(t('supplier_demo.supplyCases.states.permissionDenied'))
      if (status === 404) throw createCrudFormError(t('supplier_demo.supplyCases.errors.orderMissing'))
      if (status === 422 && code === 'order_not_confirmed') throw createCrudFormError(t('supplier_demo.supplyCases.errors.orderNotConfirmed'))
      if (status === 422 && code === 'multi_sku') throw createCrudFormError(t('supplier_demo.supplyCases.errors.multiSku'))
      if (status === 422) throw createCrudFormError(t('supplier_demo.supplyCases.errors.quantity'))
      throw createCrudFormError(t('supplier_demo.supplyCases.errors.submit'))
    }
    flash(t('supplier_demo.supplyCases.flash.reported'), 'success')
    router.push(SUPPLY_CASES_HREF)
  }, [router, runMutation, salesOrderId, t])

  const title = orderNumber
    ? t('supplier_demo.supplyCases.report.titleWithOrder', { orderNumber })
    : t('supplier_demo.supplyCases.dialog.title')

  return (
    <div className="flex flex-col gap-4">
      <p role="note" aria-live="polite" className="text-sm text-muted-foreground">
        {t('supplier_demo.supplyCases.dialog.description')} {t('supplier_demo.supplyCases.dialog.advisory')}
      </p>
      {!salesOrderId || (orderQuery.isFetched && !order) ? (
        <p role="alert" className="text-sm text-destructive">{t('supplier_demo.supplyCases.errors.orderMissing')}</p>
      ) : null}
      <CrudForm<FormValues>
        title={title}
        backHref={ORDERS_HREF}
        cancelHref={ORDERS_HREF}
        fields={fields}
        schema={formSchema}
        initialValues={{ availableQuantity: undefined }}
        onSubmit={handleSubmit}
        submitLabel={t('supplier_demo.supplyCases.dialog.submit')}
        isLoading={orderQuery.isLoading}
      />
    </div>
  )
}
