import type { PlannedExecution, ProductionFactDraft, ProductionFactKind } from './executionDocument'
import type { MovementKind, PlannedMovement } from './movement'
import { toPositiveQuantity } from './quantity'

export type ReversibleDocument = {
  id: string
  orderId: string
  reversedByDocumentId: string | null
  facts: ProductionFactDraft[]
}

type FactReversalRule = {
  factKind: ProductionFactKind
  movementKind: MovementKind | null
}

const FACT_REVERSAL_RULES: Record<ProductionFactKind, FactReversalRule> = {
  material_consumed: { factKind: 'material_returned', movementKind: 'restock' },
  material_returned: { factKind: 'material_consumed', movementKind: 'consume' },
  output_received: { factKind: 'output_reversed', movementKind: 'consume' },
  output_reversed: { factKind: 'output_received', movementKind: 'receiveOutput' },
  scrap_recorded: { factKind: 'scrap_reversed', movementKind: null },
  scrap_reversed: { factKind: 'scrap_recorded', movementKind: null },
}

export type ReversalPlan =
  | { status: 'planned'; execution: PlannedExecution }
  | { status: 'already_reversed' }
  | { status: 'unsupported' }

function reverseMovement(fact: ProductionFactDraft): PlannedMovement | null {
  const movementKind = FACT_REVERSAL_RULES[fact.factKind].movementKind
  const quantity = toPositiveQuantity(fact.quantity)

  if (!movementKind || !fact.warehouseId || !fact.locationId || quantity === null) return null

  return { kind: movementKind, variantId: fact.variantId, warehouseId: fact.warehouseId, locationId: fact.locationId, quantity }
}

export function planReversal(document: ReversibleDocument): ReversalPlan {
  if (document.reversedByDocumentId) return { status: 'already_reversed' }

  const movingFacts = document.facts.filter((fact) => fact.movementId !== null)

  if (movingFacts.length > 1) return { status: 'unsupported' }

  const movement = movingFacts.length === 1 ? reverseMovement(movingFacts[0]) : null

  if (movingFacts.length === 1 && !movement) return { status: 'unsupported' }

  return {
    status: 'planned',
    execution: {
      documentType: 'reversal',
      movement,
      facts: document.facts.map((fact) => ({
        factKind: FACT_REVERSAL_RULES[fact.factKind].factKind,
        variantId: fact.variantId,
        warehouseId: fact.warehouseId,
        locationId: fact.locationId,
        quantity: fact.quantity,
        moves: fact.movementId !== null,
      })),
    },
  }
}
