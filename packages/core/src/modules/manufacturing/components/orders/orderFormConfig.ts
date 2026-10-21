import { z } from 'zod'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { parseLocaleNumber } from '@open-mercato/shared/lib/number'
import type { CreateProductionOrderInput } from '../../data/validators'

export const RELEASED_BOM_REVISIONS_URL = '/api/manufacturing/boms?status=released&pageSize=100'

const bomRevisionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      outputVariantId: z.string(),
      revision: z.string(),
    }),
  ),
})

export type BomRevisionOption = CrudFieldOption & { productVariantId: string }

export type ProductionOrderFormValues = {
  bomRevisionId?: unknown
  plannedQuantity?: unknown
  sourceLocationId?: unknown
  targetLocationId?: unknown
  dueAt?: unknown
}

export type OrderFormFieldErrors = Partial<Record<keyof ProductionOrderFormValues, 'required' | 'invalidQuantity'>>

export type OrderPayloadResult =
  | { status: 'valid'; payload: CreateProductionOrderInput }
  | { status: 'invalid'; fieldErrors: OrderFormFieldErrors }

export function toBomRevisionOptions(response: unknown): BomRevisionOption[] {
  const parsed = bomRevisionListSchema.safeParse(response)

  if (!parsed.success) return []

  return parsed.data.items.map((item) => ({
    value: item.id,
    label: `${item.revision} · ${item.outputVariantId}`,
    productVariantId: item.outputVariantId,
  }))
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function buildCreateOrderPayload(
  values: ProductionOrderFormValues,
  revisions: BomRevisionOption[],
  locale?: string,
): OrderPayloadResult {
  const fieldErrors: OrderFormFieldErrors = {}
  const revision = revisions.find((option) => option.value === values.bomRevisionId)
  const quantityText = asText(values.plannedQuantity)
  const plannedQuantity = quantityText === null ? null : parseLocaleNumber(quantityText, locale)
  const sourceLocationId = asText(values.sourceLocationId)
  const targetLocationId = asText(values.targetLocationId)
  const dueAt = asText(values.dueAt)

  if (!revision) fieldErrors.bomRevisionId = 'required'
  if (quantityText === null) fieldErrors.plannedQuantity = 'required'
  else if (plannedQuantity === null) fieldErrors.plannedQuantity = 'invalidQuantity'
  if (!sourceLocationId) fieldErrors.sourceLocationId = 'required'
  if (!targetLocationId) fieldErrors.targetLocationId = 'required'

  if (!revision || plannedQuantity === null || Object.keys(fieldErrors).length > 0) {
    return { status: 'invalid', fieldErrors }
  }

  return {
    status: 'valid',
    payload: {
      productVariantId: revision.productVariantId,
      bomRevisionId: revision.value,
      plannedQuantity,
      sourceLocationId,
      targetLocationId,
      dueAt: dueAt ? new Date(dueAt) : null,
    },
  }
}
