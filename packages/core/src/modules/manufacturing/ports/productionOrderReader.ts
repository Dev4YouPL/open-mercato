import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { OrderExecutionPermissions } from '../domain/orderExecutionPermissions'

export const PRODUCTION_ORDER_READER_DI_KEY = 'manufacturingProductionOrderReader'

export type ProductionOrderDto = OrderExecutionPermissions & {
  id: string
  tenantId: string
  organizationId: string
  productVariantId: string
  sourceLocationId: string | null
  targetLocationId: string | null
}

export interface ProductionOrderReader {
  getForExecution(orderId: string, scope: ManufacturingScope): Promise<ProductionOrderDto | null>
}
