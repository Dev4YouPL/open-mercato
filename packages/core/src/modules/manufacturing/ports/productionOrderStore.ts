import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { NewProductionOrder } from '../domain/productionOrder'

export const PRODUCTION_ORDER_STORE_DI_KEY = 'manufacturingProductionOrderStore'

export type CreateProductionOrderStoreResult =
  | { status: 'created'; id: string; orderNumber: string }
  | { status: 'revision_unavailable' }

export type CreatedProductionOrderDto = Extract<CreateProductionOrderStoreResult, { status: 'created' }>

export interface ProductionOrderStore {
  create(order: NewProductionOrder, scope: ManufacturingScope): Promise<CreateProductionOrderStoreResult>
}

export function resolveProductionOrderStore(container: AwilixContainer): ProductionOrderStore {
  return container.resolve<ProductionOrderStore>(PRODUCTION_ORDER_STORE_DI_KEY)
}
