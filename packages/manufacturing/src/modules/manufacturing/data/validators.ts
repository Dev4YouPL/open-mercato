import { z } from 'zod'

const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d+)?$/

export const decimalStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(DECIMAL_STRING_PATTERN, '[internal] Value must be a canonical base-10 decimal string')

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => !value.startsWith('-') && value !== '0',
  '[internal] Value must be a positive decimal string',
)

export const unitCodeSchema = z.string().trim().min(1).max(50)

export const quantityInputSchema = z.object({
  value: positiveDecimalStringSchema,
  unitCode: unitCodeSchema.nullable().optional(),
})

export const bomTargetInputSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
})

export const consumptionBasisSchema = z.enum(['variable', 'fixed'])
export const supplyModeSchema = z.enum(['stock', 'produce'])

export const bomLineInputSchema = z.object({
  component: bomTargetInputSchema,
  quantity: quantityInputSchema,
  consumptionBasis: consumptionBasisSchema.optional(),
  yieldFactor: positiveDecimalStringSchema.optional(),
  supplyMode: supplyModeSchema.optional(),
})

export const bomLinePatchSchema = z.object({
  component: bomTargetInputSchema.optional(),
  quantity: quantityInputSchema.optional(),
  consumptionBasis: consumptionBasisSchema.optional(),
  yieldFactor: positiveDecimalStringSchema.optional(),
  supplyMode: supplyModeSchema.optional(),
})

/**
 * Form-editable custom fields travel as a flat map of definition key to value;
 * the platform data engine owns their storage, validation, and typing.
 */
export const customFieldsInputSchema = z.record(z.string(), z.unknown())

export const revisionLabelSchema = z.string().trim().max(120).nullable().optional()

export const createBomSchema = z.object({
  target: bomTargetInputSchema,
  revisionLabel: revisionLabelSchema,
  baseOutput: quantityInputSchema,
  customFields: customFieldsInputSchema.optional(),
})

export const updateBomSchema = z
  .object({
    target: bomTargetInputSchema.optional(),
    draft: z
      .object({
        revisionLabel: revisionLabelSchema,
        baseOutput: quantityInputSchema.optional(),
      })
      .optional(),
    customFields: customFieldsInputSchema.optional(),
  })
  .refine((value) => value.target !== undefined || value.draft !== undefined || value.customFields !== undefined, {
    message: '[internal] At least one of target, draft, or customFields must be supplied',
  })

export const reorderLineSchema = z.object({
  direction: z.enum(['up', 'down']),
})

export const listBomsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
})

export const listBomLinesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
})

export type CreateBomInput = z.infer<typeof createBomSchema>
export type UpdateBomInput = z.infer<typeof updateBomSchema>
export type BomLineInput = z.infer<typeof bomLineInputSchema>
export type BomLinePatchInput = z.infer<typeof bomLinePatchSchema>
export type ReorderLineInput = z.infer<typeof reorderLineSchema>
