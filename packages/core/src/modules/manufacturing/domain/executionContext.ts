import type { OrderExecutionPermissions } from './orderExecutionPermissions'

export type ExecutionContext = OrderExecutionPermissions & {
  executionId: string
  orderId: string | null
  productVariantId: string | null
  sourceLocationId: string | null
  targetLocationId: string | null
  plannedQuantity: number | null
}

export type StandaloneExecution = {
  id: string
  productVariantId: string | null
  sourceLocationId: string | null
  targetLocationId: string | null
}

export type ExecutionOrder = OrderExecutionPermissions & {
  id: string
  productVariantId: string
  sourceLocationId: string | null
  targetLocationId: string | null
  plannedQuantity: number
}

const STANDALONE_PERMISSIONS: OrderExecutionPermissions = { allowsIssue: true, allowsReturn: true, allowsConfirmation: true }

export function standaloneExecutionContext(execution: StandaloneExecution): ExecutionContext {
  return {
    executionId: execution.id,
    orderId: null,
    productVariantId: execution.productVariantId,
    sourceLocationId: execution.sourceLocationId,
    targetLocationId: execution.targetLocationId,
    plannedQuantity: null,
    ...STANDALONE_PERMISSIONS,
  }
}

export function orderExecutionContext(executionId: string, order: ExecutionOrder): ExecutionContext {
  return {
    executionId,
    orderId: order.id,
    productVariantId: order.productVariantId,
    sourceLocationId: order.sourceLocationId,
    targetLocationId: order.targetLocationId,
    plannedQuantity: order.plannedQuantity,
    allowsIssue: order.allowsIssue,
    allowsReturn: order.allowsReturn,
    allowsConfirmation: order.allowsConfirmation,
  }
}
