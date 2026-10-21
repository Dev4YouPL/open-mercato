import { z } from 'zod'
import { EXECUTION_DOCUMENT_TYPES, PRODUCTION_FACT_KINDS } from '../domain/executionDocument'
import { OPERATION_ACTIONS } from '../domain/operation'
import { PRODUCTION_ORDER_STATUSES } from '../domain/orderExecutionPermissions'

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
