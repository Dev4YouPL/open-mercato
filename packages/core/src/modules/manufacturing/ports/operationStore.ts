import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { OperationAction, OperationOutcome, OperationRecord } from '../domain/operation'

export const OPERATION_STORE_DI_KEY = 'manufacturingOperationStore'

export type NewOperationDto = Omit<OperationRecord, 'state'>

export type OperationInsertResultDto = 'inserted' | 'duplicate_operation' | 'unresolved_exists'

export interface OperationStore {
  find(operationId: string, scope: ManufacturingScope): Promise<OperationRecord | null>
  findUnresolved(orderId: string, action: OperationAction, scope: ManufacturingScope): Promise<OperationRecord | null>
  insertInProgress(operation: NewOperationDto, scope: ManufacturingScope): Promise<OperationInsertResultDto>
  resolveIfUnresolved(operationId: string, outcome: OperationOutcome, scope: ManufacturingScope): Promise<boolean>
}

export function resolveOperationStore(container: AwilixContainer): OperationStore {
  return container.resolve<OperationStore>(OPERATION_STORE_DI_KEY)
}
