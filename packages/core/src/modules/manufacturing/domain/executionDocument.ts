import type { PlannedMovement } from './movement'

export const EXECUTION_DOCUMENT_TYPES = ['issue', 'return', 'confirmation', 'reversal'] as const

export type ExecutionDocumentType = (typeof EXECUTION_DOCUMENT_TYPES)[number]

export const PRODUCTION_FACT_KINDS = [
  'material_consumed',
  'material_returned',
  'output_received',
  'output_reversed',
  'scrap_recorded',
  'scrap_reversed',
] as const

export type ProductionFactKind = (typeof PRODUCTION_FACT_KINDS)[number]

export type PlannedFact = {
  factKind: ProductionFactKind
  variantId: string
  warehouseId: string | null
  locationId: string | null
  quantity: number
  moves: boolean
}

export type PlannedDocument = {
  documentType: ExecutionDocumentType
  orderId: string | null
  movement: PlannedMovement | null
  facts: PlannedFact[]
}

export type ProductionFactDraft = Omit<PlannedFact, 'moves'> & {
  movementId: string | null
}

export type ExecutionDocumentDraft = {
  documentType: ExecutionDocumentType
  executionId: string
  orderId: string | null
  operationId: string
  postedBy: string
  reversesDocumentId: string | null
  facts: ProductionFactDraft[]
}

export type PostedDocument = {
  executionId: string
  operationId: string
  postedBy: string
  reversesDocumentId: string | null
  plan: PlannedDocument
  movementId: string | null
}

export function buildExecutionDocument(posted: PostedDocument): ExecutionDocumentDraft {
  return {
    documentType: posted.plan.documentType,
    executionId: posted.executionId,
    orderId: posted.plan.orderId,
    operationId: posted.operationId,
    postedBy: posted.postedBy,
    reversesDocumentId: posted.reversesDocumentId,
    facts: posted.plan.facts.map(({ moves, ...fact }) => ({ ...fact, movementId: moves ? posted.movementId : null })),
  }
}
