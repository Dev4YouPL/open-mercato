import { z } from 'zod'

import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

import { bomStatusSchema } from './bomStatus'

const uuidSchema = z.string().uuid()

const positiveQuantitySchema = (integerDigits: number) => z
  .string()
  .trim()
  .regex(
    new RegExp(
      `^(?:0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.\\d{1,6})?$`,
    ),
    'manufacturing.errors.quantityFormat',
  )
  .refine(
    (value) => /[1-9]/.test(value),
    'manufacturing.errors.quantityPositive',
  )

const baseQuantitySchema = positiveQuantitySchema(10)
const componentQuantitySchema = positiveQuantitySchema(12)

const positionSchema = z.number().int().positive().max(2_147_483_647)

const optionalBooleanQuerySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value

    return parseBooleanToken(value) ?? value
  },
  z.boolean().optional(),
)

export const bomCreateSchema = z
  .object({
    outputVariantId: uuidSchema,
    baseQuantity: baseQuantitySchema,
  })
  .strict()

export const bomUpdateSchema = bomCreateSchema
  .partial()
  .extend({
    id: uuidSchema,
  })
  .strict()

export const bomDeleteSchema = z
  .object({
    id: uuidSchema,
  })
  .strict()

export const bomReleaseSchema = z
  .object({
    id: uuidSchema,
    expectedItems: z.array(
      z
        .object({
          id: uuidSchema,
          updatedAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((input, context) => {
    const seenItemIds = new Set<string>()

    input.expectedItems.forEach((item, index) => {
      const normalizedItemId = item.id.toLowerCase()

      if (seenItemIds.has(normalizedItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedItems', index, 'id'],
          message: 'manufacturing.errors.duplicateExpectedItem',
        })
      }

      seenItemIds.add(normalizedItemId)
    })
  })

const bomItemEditableSchema = z
  .object({
    componentVariantId: uuidSchema,
    quantity: componentQuantitySchema,
    position: positionSchema,
  })
  .strict()

export const bomItemCreateSchema = bomItemEditableSchema
  .extend({
    bomId: uuidSchema,
  })
  .strict()

export const bomItemUpdateSchema = bomItemEditableSchema
  .partial()
  .extend({
    id: uuidSchema,
    bomId: uuidSchema,
  })
  .strict()

export const bomItemDeleteSchema = z
  .object({
    id: uuidSchema,
    bomId: uuidSchema,
  })
  .strict()

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const bomListQuerySchema = paginationSchema.extend({
  id: uuidSchema.optional(),
  outputVariantId: uuidSchema.optional(),
  status: bomStatusSchema.optional(),
  isIncomplete: optionalBooleanQuerySchema,
  sortField: z.enum([
    'id',
    'outputVariantId',
    'revision',
    'status',
    'createdAt',
    'updatedAt',
  ]).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const bomItemListQuerySchema = paginationSchema.extend({
  bomId: uuidSchema,
  id: uuidSchema.optional(),
  sortField: z.enum([
    'id',
    'position',
    'componentVariantId',
    'createdAt',
    'updatedAt',
  ]).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export type BomCreateInput = z.infer<typeof bomCreateSchema>
export type BomUpdateInput = z.infer<typeof bomUpdateSchema>
export type BomDeleteInput = z.infer<typeof bomDeleteSchema>
export type BomReleaseInput = z.infer<typeof bomReleaseSchema>

export type BomItemCreateInput = z.infer<typeof bomItemCreateSchema>
export type BomItemUpdateInput = z.infer<typeof bomItemUpdateSchema>
export type BomItemDeleteInput = z.infer<typeof bomItemDeleteSchema>