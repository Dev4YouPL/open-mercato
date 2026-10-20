/** @jest-environment node */

import type { ProductionFactDraft } from '../domain/executionDocument'
import { buildReversalDocument, planReversalMovement, type ReversibleDocument } from '../domain/reversal'

const issuedFact: ProductionFactDraft = {
  factKind: 'material_consumed',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4,
  movementId: 'movement-1',
}

function documentWith(facts: ProductionFactDraft[], reversedByDocumentId: string | null = null): ReversibleDocument {
  return { id: 'document-1', orderId: 'order-1', reversedByDocumentId, facts }
}

describe('document reversal', () => {
  it.each([
    ['material_consumed', 'restock'],
    ['material_returned', 'consume'],
    ['output_received', 'consume'],
    ['output_reversed', 'receiveOutput'],
  ] as const)('reverses a %s fact with a %s movement from its snapshot', (factKind, kind) => {
    expect(planReversalMovement(documentWith([{ ...issuedFact, factKind }]))).toEqual({
      status: 'planned',
      movement: { kind, variantId: 'variant-1', warehouseId: 'warehouse-1', locationId: 'location-1', quantity: 4 },
    })
  })

  it('refuses a document that was already reversed', () => {
    expect(planReversalMovement(documentWith([issuedFact], 'document-2'))).toEqual({ status: 'already_reversed' })
  })

  it.each([
    ['no moving fact', [{ ...issuedFact, movementId: null }]],
    ['more than one moving fact', [issuedFact, { ...issuedFact, movementId: 'movement-2' }]],
  ])('refuses a document with %s under the one-movement profile', (_label, facts) => {
    expect(planReversalMovement(documentWith(facts))).toEqual({ status: 'unsupported' })
  })

  it('builds an opposite document that points at the source and copies its snapshot', () => {
    const document = buildReversalDocument({
      source: documentWith([issuedFact]),
      operationId: 'operation-2',
      postedBy: 'user-2',
      movementId: 'movement-9',
    })

    expect(document).toEqual({
      documentType: 'reversal',
      orderId: 'order-1',
      operationId: 'operation-2',
      postedBy: 'user-2',
      reversesDocumentId: 'document-1',
      facts: [
        {
          factKind: 'material_returned',
          variantId: 'variant-1',
          warehouseId: 'warehouse-1',
          locationId: 'location-1',
          quantity: 4,
          movementId: 'movement-9',
        },
      ],
    })
  })

  it('reverses facts without a movement without attaching the new movement to them', () => {
    const document = buildReversalDocument({
      source: documentWith([issuedFact, { ...issuedFact, factKind: 'output_received', movementId: null }]),
      operationId: 'operation-2',
      postedBy: 'user-2',
      movementId: 'movement-9',
    })

    expect(document.facts.map((fact) => [fact.factKind, fact.movementId])).toEqual([
      ['material_returned', 'movement-9'],
      ['output_reversed', null],
    ])
  })
})
