import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { EXECUTION_DOCUMENT_TYPES, PRODUCTION_FACT_KINDS } from '../domain/executionDocument'
import { OPERATION_ACTIONS } from '../domain/operation'
import { PRODUCTION_ORDER_STATUSES } from '../domain/orderExecutionPermissions'
import { bomStatusSchema } from './bomStatus'

export const createProductionOrderSchema = z.object({
  productVariantId: z.string().uuid(),
  bomRevisionId: z.string().uuid(),
  plannedQuantity: z.number().finite(),
  sourceLocationId: z.string().uuid().nullable(),
  targetLocationId: z.string().uuid().nullable(),
  dueAt: z.coerce.date().nullable().default(null),
})

export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>

export const PRODUCTION_ORDER_LIST_SORT_FIELDS = ['orderNumber', 'status', 'dueAt', 'plannedQuantity', 'createdAt'] as const

export const listProductionOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    productVariantId: z.string().uuid().optional(),
    status: z.enum(PRODUCTION_ORDER_STATUSES).optional(),
    dueFrom: z.string().date().optional(),
    dueTo: z.string().date().optional(),
    sortField: z.enum(PRODUCTION_ORDER_LIST_SORT_FIELDS).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type ListProductionOrdersQuery = z.infer<typeof listProductionOrdersQuerySchema>

export const productionOrderListItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  productVariantId: z.string().uuid(),
  bomRevisionId: z.string().uuid(),
  plannedQuantity: z.number(),
  sourceLocationId: z.string().uuid(),
  targetLocationId: z.string().uuid(),
  dueAt: z.string().nullable(),
  status: z.enum(PRODUCTION_ORDER_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ProductionOrderListItem = z.infer<typeof productionOrderListItemSchema>

const nullableUuid = z.string().uuid().nullable().default(null)

export const createProductionExecutionSchema = z.object({
  orderId: nullableUuid,
  productVariantId: nullableUuid,
  sourceLocationId: nullableUuid,
  targetLocationId: nullableUuid,
})

export type CreateProductionExecutionInput = z.infer<typeof createProductionExecutionSchema>

export const PRODUCTION_EXECUTION_LIST_SORT_FIELDS = ['executionNumber', 'createdAt'] as const

export const listProductionExecutionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    search: z.string().trim().max(100).optional(),
    orderId: z.string().uuid().optional(),
    withoutOrder: z.enum(['true', 'false']).optional(),
    sortField: z.enum(PRODUCTION_EXECUTION_LIST_SORT_FIELDS).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type ListProductionExecutionsQuery = z.infer<typeof listProductionExecutionsQuerySchema>

export const productionExecutionListItemSchema = z.object({
  id: z.string().uuid(),
  executionNumber: z.string(),
  orderId: z.string().uuid().nullable(),
  orderNumber: z.string().nullable(),
  orderStatus: z.enum(PRODUCTION_ORDER_STATUSES).nullable(),
  plannedQuantity: z.number().nullable(),
  productVariantId: z.string().uuid().nullable(),
  sourceLocationId: z.string().uuid().nullable(),
  targetLocationId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ProductionExecutionListItem = z.infer<typeof productionExecutionListItemSchema>

const positiveNumber = z.number().finite()

export const recordExecutionOperationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['issueMaterial', 'returnMaterial']),
    operationId: z.string().uuid(),
    executionId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: positiveNumber,
  }),
  z.object({
    action: z.literal('confirmProduction'),
    operationId: z.string().uuid(),
    executionId: z.string().uuid(),
    goodQuantity: positiveNumber,
    scrapQuantity: positiveNumber,
  }),
])

export type RecordExecutionOperationInput = z.infer<typeof recordExecutionOperationSchema>

export const reverseExecutionDocumentSchema = z.object({
  operationId: z.string().uuid(),
  documentId: z.string().uuid(),
})

export type ReverseExecutionDocumentInput = z.infer<typeof reverseExecutionDocumentSchema>

export const executionOperationResultSchema = z.object({
  status: z.literal('accepted'),
  operationId: z.string().uuid(),
  movementId: z.string().nullable(),
})

export const listExecutionDocumentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
    executionId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
  })
  .passthrough()

export type ListExecutionDocumentsQuery = z.infer<typeof listExecutionDocumentsQuerySchema>

export const executionDocumentFactSchema = z.object({
  id: z.string().uuid(),
  factKind: z.enum(PRODUCTION_FACT_KINDS),
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  quantity: z.number(),
  movementId: z.string().nullable(),
})

export const executionDocumentListItemSchema = z.object({
  id: z.string().uuid(),
  documentType: z.enum(EXECUTION_DOCUMENT_TYPES),
  executionId: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  operationId: z.string().uuid(),
  postedBy: z.string().uuid(),
  postedAt: z.string(),
  reversesDocumentId: z.string().uuid().nullable(),
  reversedByDocumentId: z.string().uuid().nullable(),
  facts: z.array(executionDocumentFactSchema),
})

export type ExecutionDocumentListItem = z.infer<typeof executionDocumentListItemSchema>

export const resumeExecutionOperationSchema = z.object({
  operationId: z.string().uuid(),
})

export type ResumeExecutionOperationInput = z.infer<typeof resumeExecutionOperationSchema>

export const listExecutionOperationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    executionId: z.string().uuid().optional(),
    unresolved: z.enum(['true', 'false']).optional(),
  })
  .passthrough()

export type ListExecutionOperationsQuery = z.infer<typeof listExecutionOperationsQuerySchema>

export const executionOperationListItemSchema = z.object({
  operationId: z.string().uuid(),
  action: z.enum(OPERATION_ACTIONS),
  executionId: z.string().uuid(),
  status: z.enum(['in_progress', 'completed', 'rejected', 'unknown']),
  rejectionCode: z.string().nullable(),
  rejectionMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ExecutionOperationListItem = z.infer<typeof executionOperationListItemSchema>

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
    expectedVersion: z.string().regex(/^v1:[0-9a-f]{64}$/).optional(),
  })
  .strict()

export const bomDeleteAllSchema = z.object({
  outputVariantId: uuidSchema,
  expectedVersion: z.string().regex(/^v1:[0-9a-f]{64}$/),
}).strict()

export const bomDeletionPreviewQuerySchema = z.object({ id: uuidSchema }).strict()

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

export const bomAvailabilityUpdateSchema = z.object({
  id: uuidSchema,
  isAvailableForNewOrders: z.boolean(),
}).strict()

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
  search: z.string().trim().max(200).optional(),
  status: bomStatusSchema.optional(),
  isIncomplete: optionalBooleanQuerySchema,
  availableForNewOrders: optionalBooleanQuerySchema.describe(
    'Filter released BOM revisions by whether they can be selected for new production orders.',
  ),
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
export type BomDeleteAllInput = z.infer<typeof bomDeleteAllSchema>
export type BomReleaseInput = z.infer<typeof bomReleaseSchema>
export type BomAvailabilityUpdateInput = z.infer<typeof bomAvailabilityUpdateSchema>

export type BomItemCreateInput = z.infer<typeof bomItemCreateSchema>
export type BomItemUpdateInput = z.infer<typeof bomItemUpdateSchema>
export type BomItemDeleteInput = z.infer<typeof bomItemDeleteSchema>
