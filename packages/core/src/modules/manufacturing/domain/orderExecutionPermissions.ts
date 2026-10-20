export const PRODUCTION_ORDER_STATUSES = ['draft', 'released', 'in_progress', 'completed', 'cancelled'] as const

export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number]

export type OrderExecutionPermissions = {
  allowsIssue: boolean
  allowsReturn: boolean
  allowsConfirmation: boolean
}

const EXECUTION_PERMISSIONS: Record<ProductionOrderStatus, OrderExecutionPermissions> = {
  draft: { allowsIssue: false, allowsReturn: true, allowsConfirmation: false },
  released: { allowsIssue: true, allowsReturn: true, allowsConfirmation: true },
  in_progress: { allowsIssue: true, allowsReturn: true, allowsConfirmation: true },
  completed: { allowsIssue: true, allowsReturn: true, allowsConfirmation: true },
  cancelled: { allowsIssue: false, allowsReturn: true, allowsConfirmation: false },
}

export function executionPermissionsFor(status: ProductionOrderStatus): OrderExecutionPermissions {
  return EXECUTION_PERMISSIONS[status]
}
