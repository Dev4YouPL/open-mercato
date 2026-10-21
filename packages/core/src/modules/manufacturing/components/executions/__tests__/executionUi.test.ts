/** @jest-environment node */

import type { ExecutionDocumentListItem } from '../../../data/validators'
import { buildActionPayload, readOperationOutcome, summarizeExecution } from '../executionUi'

describe('execution operation outcome', () => {
  it.each([
    [201, null, { kind: 'accepted' }],
    [422, { error: 'Not enough stock.', code: 'insufficient_stock' }, { kind: 'rejected', message: 'Not enough stock.' }],
    [
      409,
      { error: 'Blocked.', code: 'operation_blocked', blockingOperationId: 'operation-0' },
      { kind: 'blocked', message: 'Blocked.', blockingOperationId: 'operation-0' },
    ],
    [503, { error: 'Unknown.', code: 'operation_outcome_unknown' }, { kind: 'unknown', message: 'Unknown.' }],
    [500, null, { kind: 'failed', message: 'Failed.' }],
    [409, { error: 'Conflict.', code: 'optimistic_lock_conflict' }, { kind: 'failed', message: 'Conflict.' }],
  ])('reads status %p as the matching outcome', (status, body, expected) => {
    expect(readOperationOutcome(status, body, 'Failed.')).toEqual(expected)
  })
})

describe('execution action payload', () => {
  it('builds a material issue with a locale-parsed quantity', () => {
    expect(buildActionPayload('issueMaterial', 'execution-1', 'operation-1', { variantId: 'leg', quantity: '2,5' }, 'pl')).toEqual({
      status: 'valid',
      payload: { action: 'issueMaterial', operationId: 'operation-1', executionId: 'execution-1', variantId: 'leg', quantity: 2.5 },
    })
  })

  it('reports a missing material and an unparsable quantity', () => {
    expect(buildActionPayload('returnMaterial', 'execution-1', 'operation-1', { quantity: 'abc' })).toEqual({
      status: 'invalid',
      fieldErrors: { variantId: 'required', quantity: 'invalidQuantity' },
    })
  })

  it('builds a confirmation and leaves the zero-quantity rule to the server', () => {
    expect(buildActionPayload('confirmProduction', 'execution-1', 'operation-1', { goodQuantity: '8', scrapQuantity: '0' })).toEqual({
      status: 'valid',
      payload: { action: 'confirmProduction', operationId: 'operation-1', executionId: 'execution-1', goodQuantity: 8, scrapQuantity: 0 },
    })
  })

  it('requires the good quantity of a confirmation', () => {
    expect(buildActionPayload('confirmProduction', 'execution-1', 'operation-1', { goodQuantity: '', scrapQuantity: '1' })).toEqual({
      status: 'invalid',
      fieldErrors: { goodQuantity: 'required' },
    })
  })
})

describe('execution summary', () => {
  function document(facts: ExecutionDocumentListItem['facts']): ExecutionDocumentListItem {
    return {
      id: 'document-1',
      documentType: 'issue',
      executionId: 'execution-1',
      orderId: null,
      operationId: 'operation-1',
      postedBy: 'user-1',
      postedAt: '2026-10-22T10:00:00.000Z',
      reversesDocumentId: null,
      reversedByDocumentId: null,
      facts,
    }
  }

  const fact = (factKind: ExecutionDocumentListItem['facts'][number]['factKind'], variantId: string, quantity: number) => ({
    id: `${factKind}-${variantId}-${quantity}`,
    factKind,
    variantId,
    warehouseId: null,
    locationId: null,
    quantity,
    movementId: null,
  })

  it('sums net issued materials and output across documents', () => {
    const summary = summarizeExecution(
      [
        document([fact('material_consumed', 'leg', 4)]),
        document([fact('material_returned', 'leg', 1)]),
        document([fact('output_received', 'table', 3), fact('scrap_recorded', 'table', 1)]),
      ],
      5,
    )

    expect(summary.materials).toEqual([{ variantId: 'leg', inPlan: false, plannedQuantity: 0, issuedQuantity: 3, difference: 3 }])
    expect(summary.output).toEqual({ plannedQuantity: 5, goodQuantity: 3, scrapQuantity: 1, difference: -2 })
  })
})
