import { z } from 'zod'

export const createProductionOrderSchema = z.object({
  productVariantId: z.string().uuid(),
  bomRevisionId: z.string().uuid(),
  plannedQuantity: z.number().finite(),
  sourceLocationId: z.string().uuid().nullable(),
  targetLocationId: z.string().uuid().nullable(),
  dueAt: z.coerce.date().nullable().default(null),
})

export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>
