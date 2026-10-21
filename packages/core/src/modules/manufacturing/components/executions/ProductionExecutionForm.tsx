'use client'

import { useMemo, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadActiveLocationOptions, searchVariantOptions } from '../shared/useReferenceLabels'
import { buildCreateExecutionPayload, toOrderOptions, type ProductionExecutionFormValues } from './executionFormConfig'
import { ORDERS_API_PATH } from './executionUi'

type ProductionExecutionFormProps = {
  initialOrderId: string | null
  onCreated: (execution: { id: string; executionNumber: string }) => void
  onCancel: () => void
}

async function loadOrderOptions() {
  const call = await apiCall<unknown>(`${ORDERS_API_PATH}?pageSize=100&sortField=createdAt&sortDir=desc`)
  return call.ok ? toOrderOptions(call.result) : []
}

export function ProductionExecutionForm({ initialOrderId, onCreated, onCancel }: ProductionExecutionFormProps) {
  const t = useT()
  const [isSaving, setIsSaving] = useState(false)

  const fields = useMemo<CrudField[]>(
    () => [
      {
        id: 'orderId',
        label: t('manufacturing.executions.fields.order'),
        description: t('manufacturing.executions.form.orderHint'),
        type: 'select',
        disabled: isSaving,
        loadOptions: loadOrderOptions,
      },
      {
        id: 'productVariantId',
        label: t('manufacturing.executions.fields.productVariant'),
        description: t('manufacturing.executions.form.standaloneHint'),
        type: 'combobox',
        disabled: isSaving,
        loadOptions: searchVariantOptions,
      },
      {
        id: 'sourceLocationId',
        label: t('manufacturing.executions.fields.sourceLocation'),
        type: 'select',
        disabled: isSaving,
        loadOptions: loadActiveLocationOptions,
      },
      {
        id: 'targetLocationId',
        label: t('manufacturing.executions.fields.targetLocation'),
        type: 'select',
        disabled: isSaving,
        loadOptions: loadActiveLocationOptions,
      },
    ],
    [t, isSaving],
  )

  async function handleSubmit(values: ProductionExecutionFormValues) {
    setIsSaving(true)

    try {
      const response = await createCrud<{ id: string; executionNumber: string }>(
        'manufacturing/executions',
        buildCreateExecutionPayload(values),
        { errorMessage: t('manufacturing.executions.form.errors.saveFailed') },
      )

      if (!response.result?.id) throw createCrudFormError(t('manufacturing.executions.form.errors.saveFailed'))

      flash(t('manufacturing.executions.form.created', { number: response.result.executionNumber }), 'success')
      onCreated(response.result)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <CrudForm<ProductionExecutionFormValues>
      formId="manufacturing-production-execution-form"
      title={t('manufacturing.executions.form.createTitle')}
      fields={fields}
      initialValues={{ orderId: initialOrderId }}
      submitLabel={t('manufacturing.executions.form.submit')}
      onSubmit={handleSubmit}
      extraActions={
        <Button type="button" variant="outline" disabled={isSaving} onClick={onCancel}>
          {t('ui.forms.actions.cancel')}
        </Button>
      }
    />
  )
}
