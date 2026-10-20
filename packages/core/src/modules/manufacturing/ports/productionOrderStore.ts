import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { NewProductionOrder } from '../domain/productionOrder'

export const PRODUCTION_ORDER_STORE_DI_KEY = 'manufacturingProductionOrderStore'

export type CreatedProductionOrderDto = {
  id: string
  orderNumber: string
}

export interface ProductionOrderStore {
  create(order: NewProductionOrder, scope: ManufacturingScope): Promise<CreatedProductionOrderDto>
}

export function resolveProductionOrderStore(container: AwilixContainer): ProductionOrderStore {
  return container.resolve<ProductionOrderStore>(PRODUCTION_ORDER_STORE_DI_KEY)
}
