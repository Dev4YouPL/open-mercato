import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ProductionOrder } from '../../data/entities'
import { createProductionOrderSchema } from '../../data/validators'
import { CREATE_PRODUCTION_ORDER_COMMAND_ID, type CreateProductionOrderResult } from '../../commands/productionOrders'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['manufacturing.manage'] },
}

const createdOrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
})

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: ProductionOrder,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  actions: {
    create: {
      commandId: CREATE_PRODUCTION_ORDER_COMMAND_ID,
      schema: createProductionOrderSchema,
      response: ({ result }: { result: CreateProductionOrderResult }) => ({
        id: result.orderId,
        orderNumber: result.orderNumber,
      }),
      status: 201,
    },
  },
})

export const POST = crud.POST

const rejectionSchema = z.object({
  error: z.string(),
  code: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Manufacturing',
  summary: 'Production orders',
  methods: {
    POST: {
      summary: 'Create production order',
      description: 'Creates a draft production order on a released, available BOM revision and assigns its number.',
      requestBody: { schema: createProductionOrderSchema },
      responses: [{ status: 201, description: 'Production order created', schema: createdOrderSchema }],
      errors: [{ status: 422, description: 'The order breaks a creation rule', schema: rejectionSchema }],
    },
  },
}
