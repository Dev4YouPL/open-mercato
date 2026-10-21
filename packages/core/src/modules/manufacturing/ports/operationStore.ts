import type { AwilixContainer } from 'awilix'
import type { ExecutionDocumentDraft } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { OperationAction, OperationOutcome, OperationRecord } from '../domain/operation'

export const OPERATION_STORE_DI_KEY = 'manufacturingOperationStore'

export type OperationInsertResultDto = 'inserted' | 'duplicate_operation' | 'unresolved_exists'

export interface OperationStore {
  find(operationId: string, scope: ManufacturingScope): Promise<OperationRecord | null>
  findUnresolved(executionId: string, action: OperationAction, scope: ManufacturingScope): Promise<OperationRecord | null>
  insert(operation: OperationRecord, scope: ManufacturingScope): Promise<OperationInsertResultDto>
  resolveIfUnresolved(
    operationId: string,
    outcome: OperationOutcome,
    document: ExecutionDocumentDraft | null,
    scope: ManufacturingScope,
  ): Promise<boolean>
}

export function resolveOperationStore(container: AwilixContainer): OperationStore {
  return container.resolve<OperationStore>(OPERATION_STORE_DI_KEY)
}
