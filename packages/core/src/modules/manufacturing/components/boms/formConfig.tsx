'use client'

import { z } from 'zod'

import type {
  CrudCustomFieldRenderProps,
  CrudField,
  CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Input } from '@open-mercato/ui/primitives/input'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  parseLocaleNumber,
  resolveLocaleNumberSeparators,
} from '@open-mercato/shared/lib/number'
import { crudFormExtensionSpotId } from '@open-mercato/shared/modules/widgets/extension-points'

import type {
  bomItemResponseSchema,
  bomResponseSchema,
} from '../../api/openapi'
import {
  bomCreateSchema,
  bomItemCreateSchema,
  bomItemUpdateSchema,
  bomUpdateSchema,
} from '../../data/validators'
import { CatalogVariantSelect } from './CatalogVariantSelect'

export type BomRecord = z.infer<typeof bomResponseSchema>
export type BomItemRecord = z.infer<typeof bomItemResponseSchema>
export type BomFormValues = Record<string, unknown>

export const BOM_FORM_SPOT_ID = crudFormExtensionSpotId(
  'manufacturing.manufacturing_bom',
)

export const BOM_ITEM_FORM_SPOT_ID = crudFormExtensionSpotId(
  'manufacturing.manufacturing_bom_item',
)

function QuantityInput({
  id,
  value,
  setValue,
  disabled,
  autoFocus,
  error,
}: CrudCustomFieldRenderProps) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => setValue(event.target.value)}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={Boolean(error)}
      data-crud-focus-target=""
    />
  )
}

function VariantInput({
  value,
  setValue,
  disabled,
}: CrudCustomFieldRenderProps) {
  return (
    <CatalogVariantSelect
      value={typeof value === 'string' ? value : null}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

function quantityError(
  field: string,
  messageKey: string,
  t: TranslateFn,
): never {
  throw createCrudFormError(
    t('manufacturing.forms.validationFailed'),
    { [field]: t(messageKey) },
  )
}

function normalizeQuantity(
  value: unknown,
  field: string,
  t: TranslateFn,
  locale?: string,
): string {
  if (typeof value !== 'string') {
    quantityError(field, 'manufacturing.errors.quantityFormat', t)
  }

  const raw = value.trim()
  const parsed = parseLocaleNumber(raw, locale)

  if (parsed === null) {
    quantityError(field, 'manufacturing.errors.quantityFormat', t)
  }

  if (parsed <= 0) {
    quantityError(field, 'manufacturing.errors.quantityPositive', t)
  }

  const { group } = resolveLocaleNumberSeparators(locale)

  let compact = raw
    .replace(/^\+/, '')
    .replace(/[\s'’ʼ]/g, '')

  if (group !== ',' && group !== '.') {
    compact = compact.split(group).join('')
  }

  const separators = compact.match(/[.,]/g) ?? []
  const hasBothSeparators = compact.includes(',') && compact.includes('.')
  const decimalIndex = hasBothSeparators || separators.length === 1
    ? Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'))
    : -1

  const integerText = decimalIndex >= 0
    ? compact.slice(0, decimalIndex)
    : compact

  const integerPart = integerText
    .replace(/[.,]/g, '')
    .replace(/^0+(?=\d)/, '') || '0'

  const fractionPart = decimalIndex >= 0
    ? compact.slice(decimalIndex + 1)
    : ''

  return fractionPart
    ? `${integerPart}.${fractionPart}`
    : integerPart
}

function parseFormPayload<T>(
  schema: z.ZodType<T>,
  input: unknown,
  t: TranslateFn,
): T {
  const result = schema.safeParse(input)

  if (result.success) {
    return result.data
  }

  const fieldErrors: Record<string, string> = {}

  for (const issue of result.error.issues) {
    const field = issue.path[0]

    if (typeof field !== 'string' || fieldErrors[field]) {
      continue
    }

    if (field === 'outputVariantId' || field === 'componentVariantId') {
      fieldErrors[field] = t('manufacturing.forms.variantRequired')
    } else if (field === 'position') {
      fieldErrors[field] = t('manufacturing.forms.positionInvalid')
    } else if (
      issue.message === 'manufacturing.errors.quantityFormat'
      || issue.message === 'manufacturing.errors.quantityPositive'
    ) {
      fieldErrors[field] = t(issue.message)
    } else {
      fieldErrors[field] = t('manufacturing.forms.validationFailed')
    }
  }

  throw createCrudFormError(
    t('manufacturing.forms.validationFailed'),
    fieldErrors,
  )
}

export function buildBomFields(
  t: TranslateFn,
  disabled = false,
): CrudField[] {
  return [
    {
      id: 'outputVariantId',
      label: t('manufacturing.boms.form.outputVariant'),
      type: 'custom',
      required: true,
      disabled,
      component: VariantInput,
    },
    {
      id: 'baseQuantity',
      label: t('manufacturing.boms.form.baseQuantity'),
      type: 'custom',
      required: true,
      disabled,
      component: QuantityInput,
    },
  ]
}

export function buildBomGroups(): CrudFormGroup[] {
  return [
    {
      id: 'bom',
      fields: ['outputVariantId', 'baseQuantity'],
    },
  ]
}

export function buildBomItemFields(
  t: TranslateFn,
  disabled = false,
): CrudField[] {
  return [
    {
      id: 'componentVariantId',
      label: t('manufacturing.bomItems.form.componentVariant'),
      type: 'custom',
      required: true,
      disabled,
      component: VariantInput,
    },
    {
      id: 'quantity',
      label: t('manufacturing.bomItems.form.quantity'),
      type: 'custom',
      required: true,
      disabled,
      component: QuantityInput,
    },
    {
      id: 'position',
      label: t('manufacturing.bomItems.form.position'),
      type: 'number',
      required: true,
      disabled,
    },
  ]
}

export function buildBomItemGroups(): CrudFormGroup[] {
  return [
    {
      id: 'bom-item',
      fields: ['componentVariantId', 'quantity', 'position'],
    },
  ]
}

export function buildBomCreatePayload(
  values: BomFormValues,
  t: TranslateFn,
  locale?: string,
) {
  return parseFormPayload(
    bomCreateSchema,
    {
      outputVariantId: values.outputVariantId,
      baseQuantity: normalizeQuantity(
        values.baseQuantity,
        'baseQuantity',
        t,
        locale,
      ),
    },
    t,
  )
}

export function buildBomUpdatePayload(
  id: string,
  values: BomFormValues,
  t: TranslateFn,
  locale?: string,
) {
  return parseFormPayload(
    bomUpdateSchema,
    {
      id,
      outputVariantId: values.outputVariantId,
      baseQuantity: normalizeQuantity(
        values.baseQuantity,
        'baseQuantity',
        t,
        locale,
      ),
    },
    t,
  )
}

export function buildBomItemCreatePayload(
  bomId: string,
  values: BomFormValues,
  t: TranslateFn,
  locale?: string,
) {
  return parseFormPayload(
    bomItemCreateSchema,
    {
      bomId,
      componentVariantId: values.componentVariantId,
      quantity: normalizeQuantity(values.quantity, 'quantity', t, locale),
      position: values.position,
    },
    t,
  )
}

export function buildBomItemUpdatePayload(
  bomId: string,
  id: string,
  values: BomFormValues,
  t: TranslateFn,
  locale?: string,
) {
  return parseFormPayload(
    bomItemUpdateSchema,
    {
      id,
      bomId,
      componentVariantId: values.componentVariantId,
      quantity: normalizeQuantity(values.quantity, 'quantity', t, locale),
      position: values.position,
    },
    t,
  )
}