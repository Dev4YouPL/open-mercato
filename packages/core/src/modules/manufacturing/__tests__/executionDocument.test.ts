/** @jest-environment node */

import { buildExecutionDocument, type PlannedExecution } from '../domain/executionDocument'
import type { PositiveQuantity } from '../domain/quantity'

const confirmation: PlannedExecution = {
  documentType: 'confirmation',
  movement: {
    kind: 'receiveOutput',
    variantId: 'product-1',
    warehouseId: 'warehouse-1',
    locationId: 'location-1',
    quantity: 8 as PositiveQuantity,
  },
  facts: [
    { factKind: 'output_received', variantId: 'product-1', warehouseId: 'warehouse-1', locationId: 'location-1', quantity: 8, moves: true },
    { factKind: 'scrap_recorded', variantId: 'product-1', warehouseId: null, locationId: null, quantity: 2, moves: false },
  ],
}

describe('execution document', () => {
  it('copies the planned facts and attaches the WMS movement only to moving facts', () => {
    const document = buildExecutionDocument({
      orderId: 'order-1',
      operationId: 'operation-1',
      postedBy: 'user-1',
      reversesDocumentId: null,
      execution: confirmation,
      movementId: 'movement-1',
    })

    expect(document).toEqual({
      documentType: 'confirmation',
      orderId: 'order-1',
      operationId: 'operation-1',
      postedBy: 'user-1',
      reversesDocumentId: null,
      facts: [
        { factKind: 'output_received', variantId: 'product-1', warehouseId: 'warehouse-1', locationId: 'location-1', quantity: 8, movementId: 'movement-1' },
        { factKind: 'scrap_recorded', variantId: 'product-1', warehouseId: null, locationId: null, quantity: 2, movementId: null },
      ],
    })
  })

  it('keeps the reversed document reference', () => {
    const document = buildExecutionDocument({
      orderId: 'order-1',
      operationId: 'operation-2',
      postedBy: 'user-1',
      reversesDocumentId: 'document-1',
      execution: { ...confirmation, documentType: 'reversal' },
      movementId: 'movement-2',
    })

    expect(document).toMatchObject({ documentType: 'reversal', reversesDocumentId: 'document-1' })
  })
})
