/** @jest-environment node */

import { listExecutionDocumentsQuerySchema } from '../../../data/validators'
import { buildExecutionDocumentFilters, toExecutionDocumentListItem } from '../listQuery'

describe('execution document list query', () => {
  it('filters by execution or order', () => {
    const query = listExecutionDocumentsQuerySchema.parse({
      executionId: '11111111-1111-4111-8111-111111111111',
      orderId: '22222222-2222-4222-8222-222222222222',
    })

    expect(buildExecutionDocumentFilters(query)).toEqual({
      execution_id: { $eq: '11111111-1111-4111-8111-111111111111' },
      order_id: { $eq: '22222222-2222-4222-8222-222222222222' },
    })
  })

  it('maps a row with empty facts and reversal link until enrichment', () => {
    expect(
      toExecutionDocumentListItem({
        id: '11111111-1111-4111-8111-111111111111',
        document_type: 'reversal',
        execution_id: '22222222-2222-4222-8222-222222222222',
        order_id: null,
        operation_id: '33333333-3333-4333-8333-333333333333',
        posted_by: '44444444-4444-4444-8444-444444444444',
        posted_at: new Date('2026-10-22T10:00:00.000Z'),
        reverses_document_id: '55555555-5555-4555-8555-555555555555',
      }),
    ).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      documentType: 'reversal',
      executionId: '22222222-2222-4222-8222-222222222222',
      orderId: null,
      operationId: '33333333-3333-4333-8333-333333333333',
      postedBy: '44444444-4444-4444-8444-444444444444',
      postedAt: '2026-10-22T10:00:00.000Z',
      reversesDocumentId: '55555555-5555-4555-8555-555555555555',
      reversedByDocumentId: null,
      facts: [],
    })
  })
})
