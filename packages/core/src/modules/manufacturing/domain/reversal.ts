import type { ExecutionDocumentDraft, ProductionFactDraft, ProductionFactKind } from './executionDocument'
import type { MovementKind, PlannedMovement } from './movement'
import { toPositiveQuantity } from './quantity'

export type ReversibleDocument = {
  id: string
  orderId: string
  reversedByDocumentId: string | null
  facts: ProductionFactDraft[]
}

type FactReversalRule = {
  movementKind: MovementKind
  factKind: ProductionFactKind
}

const FACT_REVERSAL_RULES: Record<ProductionFactKind, FactReversalRule> = {
  material_consumed: { movementKind: 'restock', factKind: 'material_returned' },
  material_returned: { movementKind: 'consume', factKind: 'material_consumed' },
  output_received: { movementKind: 'consume', factKind: 'output_reversed' },
  output_reversed: { movementKind: 'receiveOutput', factKind: 'output_received' },
}

export type ReversalMovementPlan =
  | { status: 'planned'; movement: PlannedMovement }
  | { status: 'already_reversed' }
  | { status: 'unsupported' }

export function planReversalMovement(document: ReversibleDocument): ReversalMovementPlan {
  if (document.reversedByDocumentId) return { status: 'already_reversed' }

  const movingFacts = document.facts.filter((fact) => fact.movementId !== null)

  if (movingFacts.length !== 1) return { status: 'unsupported' }

  const [fact] = movingFacts
  const quantity = toPositiveQuantity(fact.quantity)

  if (quantity === null) return { status: 'unsupported' }

  return {
    status: 'planned',
    movement: {
      kind: FACT_REVERSAL_RULES[fact.factKind].movementKind,
      variantId: fact.variantId,
      warehouseId: fact.warehouseId,
      locationId: fact.locationId,
      quantity,
    },
  }
}

export type PostedReversal = {
  source: ReversibleDocument
  operationId: string
  postedBy: string
  movementId: string
}

export function buildReversalDocument(posted: PostedReversal): ExecutionDocumentDraft {
  return {
    documentType: 'reversal',
    orderId: posted.source.orderId,
    operationId: posted.operationId,
    postedBy: posted.postedBy,
    reversesDocumentId: posted.source.id,
    facts: posted.source.facts.map((fact) => ({
      factKind: FACT_REVERSAL_RULES[fact.factKind].factKind,
      variantId: fact.variantId,
      warehouseId: fact.warehouseId,
      locationId: fact.locationId,
      quantity: fact.quantity,
      movementId: fact.movementId === null ? null : posted.movementId,
    })),
  }
}
