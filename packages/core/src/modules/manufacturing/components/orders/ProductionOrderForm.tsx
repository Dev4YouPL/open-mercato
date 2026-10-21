'use client'

import { useMemo, useRef, useState } from 'react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadActiveLocationOptions } from '../shared/useReferenceLabels'
import {
  buildCreateOrderPayload,
  RELEASED_BOM_REVISIONS_URL,
  toBomRevisionOptions,
  type BomRevisionOption,
  type ProductionOrderFormValues,
} from './orderFormConfig'

type ProductionOrderFormProps = {
  onCreated: (order: { id: string; orderNumber: string }) => void
  onCancel: () => void
}

const FIELD_ERROR_KEYS = {
  required: 'manufacturing.orders.form.errors.required',
  invalidQuantity: 'manufacturing.orders.form.errors.invalidQuantity',
} as const

export function ProductionOrderForm({ onCreated, onCancel }: ProductionOrderFormProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const [isSaving, setIsSaving] = useState(false)
  const revisions = useRef<BomRevisionOption[]>([])

  const fields = useMemo<CrudField[]>(
    () => [
      {
        id: 'bomRevisionId',
        label: t('manufacturing.orders.form.fields.bomRevision'),
        type: 'select',
        required: true,
        disabled: isSaving,
        loadOptions: async () => {
          const call = await apiCall<unknown>(RELEASED_BOM_REVISIONS_URL)
          revisions.current = call.ok ? toBomRevisionOptions(call.result) : []
          return revisions.current
        },
      },
      {
        id: 'plannedQuantity',
        label: t('manufacturing.orders.form.fields.plannedQuantity'),
        type: 'text',
        required: true,
        disabled: isSaving,
      },
      {
        id: 'sourceLocationId',
        label: t('manufacturing.orders.form.fields.sourceLocation'),
        type: 'select',
        required: true,
        disabled: isSaving,
        loadOptions: loadActiveLocationOptions,
      },
      {
        id: 'targetLocationId',
        label: t('manufacturing.orders.form.fields.targetLocation'),
        type: 'select',
        required: true,
        disabled: isSaving,
        loadOptions: loadActiveLocationOptions,
      },
      {
        id: 'dueAt',
        label: t('manufacturing.orders.form.fields.dueAt'),
        type: 'date',
        disabled: isSaving,
      },
    ],
    [t, isSaving],
  )

  async function handleSubmit(values: ProductionOrderFormValues) {
    const built = buildCreateOrderPayload(values, revisions.current, locale)

    if (built.status === 'invalid') {
      const fieldErrors = Object.fromEntries(
        Object.entries(built.fieldErrors).map(([field, reason]) => [field, t(FIELD_ERROR_KEYS[reason])]),
      )
      throw createCrudFormError(t('manufacturing.orders.form.errors.validationFailed'), fieldErrors)
    }

    setIsSaving(true)

    try {
      const response = await createCrud<{ id: string; orderNumber: string }>('manufacturing/orders', built.payload, {
        errorMessage: t('manufacturing.orders.form.errors.saveFailed'),
      })

      if (!response.result?.id) throw createCrudFormError(t('manufacturing.orders.form.errors.saveFailed'))

      flash(t('manufacturing.orders.form.created', { number: response.result.orderNumber }), 'success')
      onCreated(response.result)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <CrudForm<ProductionOrderFormValues>
      formId="manufacturing-production-order-form"
      title={t('manufacturing.orders.form.createTitle')}
      fields={fields}
      initialValues={{}}
      submitLabel={t('manufacturing.orders.form.submit')}
      onSubmit={handleSubmit}
      extraActions={
        <Button type="button" variant="outline" disabled={isSaving} onClick={onCancel}>
          {t('ui.forms.actions.cancel')}
        </Button>
      }
    />
  )
}
