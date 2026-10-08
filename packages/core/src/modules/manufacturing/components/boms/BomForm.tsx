'use client'

import { useMemo, useState } from 'react'

import {
  useOptionalLocale,
  useT,
} from '@open-mercato/shared/lib/i18n/context'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  createCrud,
  updateCrud,
} from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'

import type { BomCreateInput } from '../../data/validators'
import {
  BOM_FORM_SPOT_ID,
  buildBomCreatePayload,
  buildBomFields,
  buildBomGroups,
  buildBomUpdatePayload,
  type BomFormValues,
  type BomRecord,
} from './formConfig'

type BomFormCommonProps = {
  onSaved: (bomId: string) => Promise<void> | void
  onCancel: () => void
  readOnly?: boolean
}

export type BomFormProps = BomFormCommonProps & (
  | {
      mode: 'create'
      initialValues?: Partial<BomCreateInput>
    }
  | {
      mode: 'edit'
      initialValues: BomRecord
    }
)

export function BomForm(props: BomFormProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const [isSaving, setIsSaving] = useState(false)

  const record = props.mode === 'edit' ? props.initialValues : null
  const isReleased = record !== null && record.status !== 'draft'
  const readOnly = props.readOnly === true || isReleased

  const fields = useMemo(
    () => buildBomFields(t, isSaving || readOnly),
    [t, isSaving, readOnly],
  )

  const groups = useMemo(() => buildBomGroups(), [])

  const initialValues = useMemo<BomFormValues>(() => {
    if (props.mode === 'edit') {
      return {
        id: props.initialValues.id,
        outputVariantId: props.initialValues.outputVariantId,
        baseQuantity: props.initialValues.baseQuantity,
        updatedAt: props.initialValues.updatedAt,
      }
    }

    return {
      outputVariantId: props.initialValues?.outputVariantId ?? null,
      baseQuantity: props.initialValues?.baseQuantity ?? '1',
    }
  }, [props.mode, props.initialValues])

  async function handleSubmit(values: BomFormValues) {
    if (readOnly) {
      throw createCrudFormError(
        t(
          isReleased
            ? 'manufacturing.errors.bomNotDraft'
            : 'manufacturing.forms.readOnly',
        ),
      )
    }

    setIsSaving(true)

    try {
      let bomId: string

      if (props.mode === 'create') {
        const payload = buildBomCreatePayload(values, t, locale)

        const response = await createCrud<{ id: string }>(
          'manufacturing/boms',
          payload,
          {
            errorMessage: t('manufacturing.forms.saveFailed'),
          },
        )

        if (!response.result?.id) {
          throw createCrudFormError(
            t('manufacturing.forms.saveFailed'),
          )
        }

        bomId = response.result.id
      } else {
        bomId = props.initialValues.id

        const payload = buildBomUpdatePayload(
          bomId,
          values,
          t,
          locale,
        )

        await updateCrud(
          'manufacturing/boms',
          payload,
          {
            errorMessage: t('manufacturing.forms.saveFailed'),
          },
        )
      }

      flash(t('manufacturing.forms.saved'), 'success')

      try {
        await props.onSaved(bomId)
      } catch {
        flash(t('manufacturing.forms.refreshFailed'), 'warning')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {isReleased ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('manufacturing.errors.bomNotDraft')}
        </p>
      ) : null}

      <CrudForm<BomFormValues>
        key={record?.id ?? 'create'}
        formId="manufacturing-bom-form"
        injectionSpotId={BOM_FORM_SPOT_ID}
        title={t(
          props.mode === 'create'
            ? 'manufacturing.boms.form.createTitle'
            : 'manufacturing.boms.form.editTitle',
        )}
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        readOnly={readOnly}
        submitLabel={t('ui.forms.actions.save')}
        onSubmit={handleSubmit}
        extraActions={
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={props.onCancel}
          >
            {t('ui.forms.actions.cancel')}
          </Button>
        }
      />
    </div>
  )
}