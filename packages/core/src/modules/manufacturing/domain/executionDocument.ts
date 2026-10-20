import type { PlannedMovement } from './movement'

export type ExecutionDocumentType = 'issue' | 'return' | 'confirmation' | 'reversal'

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

export type PlannedExecution = {
  documentType: ExecutionDocumentType
  movement: PlannedMovement | null
  facts: PlannedFact[]
}

export type ProductionFactDraft = Omit<PlannedFact, 'moves'> & {
  movementId: string | null
}

export type ExecutionDocumentDraft = {
  documentType: ExecutionDocumentType
  orderId: string
  operationId: string
  postedBy: string
  reversesDocumentId: string | null
  facts: ProductionFactDraft[]
}

export type PostedExecution = {
  orderId: string
  operationId: string
  postedBy: string
  reversesDocumentId: string | null
  execution: PlannedExecution
  movementId: string | null
}

export function buildExecutionDocument(posted: PostedExecution): ExecutionDocumentDraft {
  return {
    documentType: posted.execution.documentType,
    orderId: posted.orderId,
    operationId: posted.operationId,
    postedBy: posted.postedBy,
    reversesDocumentId: posted.reversesDocumentId,
    facts: posted.execution.facts.map(({ moves, ...fact }) => ({ ...fact, movementId: moves ? posted.movementId : null })),
  }
}
