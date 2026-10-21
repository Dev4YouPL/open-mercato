import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { NewProductionExecution } from '../domain/productionExecution'

export const PRODUCTION_EXECUTION_STORE_DI_KEY = 'manufacturingProductionExecutionStore'

export type CreatedProductionExecutionDto = {
  id: string
  executionNumber: string
}

export interface ProductionExecutionStore {
  create(execution: NewProductionExecution, scope: ManufacturingScope): Promise<CreatedProductionExecutionDto>
}

export function resolveProductionExecutionStore(container: AwilixContainer): ProductionExecutionStore {
  return container.resolve<ProductionExecutionStore>(PRODUCTION_EXECUTION_STORE_DI_KEY)
}
