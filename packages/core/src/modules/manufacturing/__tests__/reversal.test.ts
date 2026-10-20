/** @jest-environment node */

import type { ProductionFactDraft } from '../domain/executionDocument'
import { planReversal, type ReversibleDocument } from '../domain/reversal'

const issuedFact: ProductionFactDraft = {
  factKind: 'material_consumed',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4,
  movementId: 'movement-1',
}

const scrapFact: ProductionFactDraft = {
  factKind: 'scrap_recorded',
  variantId: 'product-1',
  warehouseId: null,
  locationId: null,
  quantity: 2,
  movementId: null,
}

function documentWith(facts: ProductionFactDraft[], reversedByDocumentId: string | null = null): ReversibleDocument {
  return { id: 'document-1', orderId: 'order-1', reversedByDocumentId, facts }
}

describe('document reversal', () => {
  it.each([
    ['material_consumed', 'restock', 'material_returned'],
    ['material_returned', 'consume', 'material_consumed'],
    ['output_received', 'consume', 'output_reversed'],
    ['output_reversed', 'receiveOutput', 'output_received'],
  ] as const)('reverses a %s fact with a %s movement and a %s fact from its snapshot', (factKind, kind, reversedKind) => {
    expect(planReversal(documentWith([{ ...issuedFact, factKind }]))).toEqual({
      status: 'planned',
      execution: {
        documentType: 'reversal',
        movement: { kind, variantId: 'variant-1', warehouseId: 'warehouse-1', locationId: 'location-1', quantity: 4 },
        facts: [
          { factKind: reversedKind, variantId: 'variant-1', warehouseId: 'warehouse-1', locationId: 'location-1', quantity: 4, moves: true },
        ],
      },
    })
  })

  it('reverses a scrap-only document without any movement', () => {
    expect(planReversal(documentWith([scrapFact]))).toEqual({
      status: 'planned',
      execution: {
        documentType: 'reversal',
        movement: null,
        facts: [
          { factKind: 'scrap_reversed', variantId: 'product-1', warehouseId: null, locationId: null, quantity: 2, moves: false },
        ],
      },
    })
  })

  it('reverses a confirmation with output and scrap as one movement plus both opposite facts', () => {
    const plan = planReversal(documentWith([{ ...issuedFact, factKind: 'output_received' }, scrapFact]))

    expect(plan).toMatchObject({ status: 'planned', execution: { movement: { kind: 'consume' } } })
    expect(plan.status === 'planned' && plan.execution.facts.map((fact) => [fact.factKind, fact.moves])).toEqual([
      ['output_reversed', true],
      ['scrap_reversed', false],
    ])
  })

  it('reverses a scrap reversal back to recorded scrap', () => {
    const plan = planReversal(documentWith([{ ...scrapFact, factKind: 'scrap_reversed' }]))

    expect(plan.status === 'planned' && plan.execution.facts[0].factKind).toBe('scrap_recorded')
  })

  it('refuses a document that was already reversed', () => {
    expect(planReversal(documentWith([issuedFact], 'document-2'))).toEqual({ status: 'already_reversed' })
  })

  it('refuses a document with more than one moving fact under the one-movement profile', () => {
    expect(planReversal(documentWith([issuedFact, { ...issuedFact, movementId: 'movement-2' }]))).toEqual({
      status: 'unsupported',
    })
  })

  it('refuses a moving fact without a location snapshot', () => {
    expect(planReversal(documentWith([{ ...issuedFact, locationId: null }]))).toEqual({ status: 'unsupported' })
  })
})
