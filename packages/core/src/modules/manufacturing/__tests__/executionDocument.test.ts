/** @jest-environment node */

import { buildExecutionDocument, type ForwardOperationAction } from '../domain/executionDocument'
import type { PlannedMovement } from '../domain/movement'
import type { PositiveQuantity } from '../domain/quantity'

const movement: PlannedMovement = {
  kind: 'consume',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 2.5 as PositiveQuantity,
}

function documentFor(action: ForwardOperationAction) {
  return buildExecutionDocument({
    action,
    orderId: 'order-1',
    operationId: 'operation-1',
    postedBy: 'user-1',
    movement,
    movementId: 'movement-1',
  })
}

describe('execution document', () => {
  it.each([
    ['issueMaterial', 'issue', 'material_consumed'],
    ['returnMaterial', 'return', 'material_returned'],
    ['receiveOutput', 'confirmation', 'output_received'],
  ] as const)('maps %s to a %s document with a %s fact', (action, documentType, factKind) => {
    const document = documentFor(action)

    expect(document.documentType).toBe(documentType)
    expect(document.facts.map((fact) => fact.factKind)).toEqual([factKind])
  })

  it('copies the movement snapshot, the WMS correlation and the poster', () => {
    expect(documentFor('issueMaterial')).toEqual({
      documentType: 'issue',
      orderId: 'order-1',
      operationId: 'operation-1',
      postedBy: 'user-1',
      reversesDocumentId: null,
      facts: [
        {
          factKind: 'material_consumed',
          variantId: 'variant-1',
          warehouseId: 'warehouse-1',
          locationId: 'location-1',
          quantity: 2.5,
          movementId: 'movement-1',
        },
      ],
    })
  })
})
