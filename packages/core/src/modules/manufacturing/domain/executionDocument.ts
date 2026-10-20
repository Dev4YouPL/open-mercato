import type { PlannedMovement } from './movement'
import type { OperationAction } from './operation'

export type ExecutionDocumentType = 'issue' | 'return' | 'confirmation' | 'reversal'

export type ProductionFactKind = 'material_consumed' | 'material_returned' | 'output_received' | 'output_reversed'

export type ProductionFactDraft = {
  factKind: ProductionFactKind
  variantId: string
  warehouseId: string
  locationId: string
  quantity: number
  movementId: string | null
}

export type ExecutionDocumentDraft = {
  documentType: ExecutionDocumentType
  orderId: string
  operationId: string
  postedBy: string
  facts: ProductionFactDraft[]
}

type ActionDocumentRule = {
  documentType: ExecutionDocumentType
  factKind: ProductionFactKind
}

const ACTION_DOCUMENT_RULES: Record<OperationAction, ActionDocumentRule> = {
  issueMaterial: { documentType: 'issue', factKind: 'material_consumed' },
  returnMaterial: { documentType: 'return', factKind: 'material_returned' },
  receiveOutput: { documentType: 'confirmation', factKind: 'output_received' },
  reverseMaterialIssue: { documentType: 'reversal', factKind: 'material_returned' },
  reverseMaterialReturn: { documentType: 'reversal', factKind: 'material_consumed' },
  reverseOutputReceipt: { documentType: 'reversal', factKind: 'output_reversed' },
}

export type PostedMovement = {
  action: OperationAction
  orderId: string
  operationId: string
  postedBy: string
  movement: PlannedMovement
  movementId: string
}

export function buildExecutionDocument(posted: PostedMovement): ExecutionDocumentDraft {
  const rule = ACTION_DOCUMENT_RULES[posted.action]

  return {
    documentType: rule.documentType,
    orderId: posted.orderId,
    operationId: posted.operationId,
    postedBy: posted.postedBy,
    facts: [
      {
        factKind: rule.factKind,
        variantId: posted.movement.variantId,
        warehouseId: posted.movement.warehouseId,
        locationId: posted.movement.locationId,
        quantity: posted.movement.quantity,
        movementId: posted.movementId,
      },
    ],
  }
}
