import { z } from 'zod'
import type { CreateProductionExecutionInput } from '../../data/validators'

const orderListSchema = z.object({
  items: z.array(z.object({ id: z.string(), orderNumber: z.string() })),
})

export type ProductionExecutionFormValues = {
  orderId?: unknown
  productVariantId?: unknown
  sourceLocationId?: unknown
  targetLocationId?: unknown
}

export function toOrderOptions(response: unknown): { value: string; label: string }[] {
  const parsed = orderListSchema.safeParse(response)

  if (!parsed.success) return []

  return parsed.data.items.map((order) => ({ value: order.id, label: order.orderNumber }))
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function buildCreateExecutionPayload(values: ProductionExecutionFormValues): CreateProductionExecutionInput {
  const orderId = asId(values.orderId)

  if (orderId) return { orderId, productVariantId: null, sourceLocationId: null, targetLocationId: null }

  return {
    orderId: null,
    productVariantId: asId(values.productVariantId),
    sourceLocationId: asId(values.sourceLocationId),
    targetLocationId: asId(values.targetLocationId),
  }
}
