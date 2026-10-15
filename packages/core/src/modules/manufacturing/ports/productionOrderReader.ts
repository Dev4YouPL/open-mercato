import type { ManufacturingScope } from '../domain/manufacturingScope'

export const PRODUCTION_ORDER_READER_DI_KEY = 'manufacturingProductionOrderReader'

export type ProductionOrderDto = {
  id: string
  tenantId: string
  organizationId: string
  productVariantId: string
  sourceLocationId: string | null
  targetLocationId: string | null
  allowsIssue: boolean
  allowsReturn: boolean
  allowsConfirmation: boolean
}

export interface ProductionOrderReader {
  getForExecution(orderId: string, scope: ManufacturingScope): Promise<ProductionOrderDto | null>
}
