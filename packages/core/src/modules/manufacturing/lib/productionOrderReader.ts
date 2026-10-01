export const PRODUCTION_ORDER_READER_DI_KEY = 'manufacturingProductionOrderReader'

export type ProductionOrderReadScope = {
  tenantId: string
  organizationId: string
}

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
  getForExecution(orderId: string, scope: ProductionOrderReadScope): Promise<ProductionOrderDto | null>
}
