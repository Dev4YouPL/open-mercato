import type { AwilixContainer } from 'awilix'
import type { ExecutionDocumentType, ProductionFactKind } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export const EXECUTION_HISTORY_READER_DI_KEY = 'manufacturingExecutionHistoryReader'

export type ProductionFactDto = {
  id: string
  factKind: ProductionFactKind
  variantId: string
  warehouseId: string | null
  locationId: string | null
  quantity: number
  movementId: string | null
}

export type ExecutionDocumentDto = {
  id: string
  documentType: ExecutionDocumentType
  orderId: string
  operationId: string
  postedBy: string
  postedAt: Date
  reversesDocumentId: string | null
  reversedByDocumentId: string | null
  facts: ProductionFactDto[]
}

export interface ExecutionHistoryReader {
  listForOrder(orderId: string, scope: ManufacturingScope): Promise<ExecutionDocumentDto[]>
  getDocument(documentId: string, scope: ManufacturingScope): Promise<ExecutionDocumentDto | null>
}

export function resolveExecutionHistoryReader(container: AwilixContainer): ExecutionHistoryReader {
  return container.resolve<ExecutionHistoryReader>(EXECUTION_HISTORY_READER_DI_KEY)
}
