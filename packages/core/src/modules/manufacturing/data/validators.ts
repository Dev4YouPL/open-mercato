import { z } from 'zod'
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
