/** @jest-environment node */

import { buildExecutionDocument, type PlannedDocument } from '../domain/executionDocument'
import type { PositiveQuantity } from '../domain/quantity'

const confirmation: PlannedDocument = {
  documentType: 'confirmation',
  orderId: 'order-1',
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
      executionId: 'execution-1',
      operationId: 'operation-1',
      postedBy: 'user-1',
      reversesDocumentId: null,
      plan: confirmation,
      movementId: 'movement-1',
    })

    expect(document).toEqual({
      documentType: 'confirmation',
      executionId: 'execution-1',
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

  it('keeps a standalone execution document without an order', () => {
    const document = buildExecutionDocument({
      executionId: 'execution-1',
      operationId: 'operation-1',
      postedBy: 'user-1',
      reversesDocumentId: null,
      plan: { ...confirmation, orderId: null },
      movementId: 'movement-1',
    })

    expect(document).toMatchObject({ executionId: 'execution-1', orderId: null })
  })

  it('keeps the reversed document reference', () => {
    const document = buildExecutionDocument({
      executionId: 'execution-1',
      operationId: 'operation-2',
      postedBy: 'user-1',
      reversesDocumentId: 'document-1',
      plan: { ...confirmation, documentType: 'reversal' },
      movementId: 'movement-2',
    })

    expect(document).toMatchObject({ documentType: 'reversal', reversesDocumentId: 'document-1' })
  })
})
