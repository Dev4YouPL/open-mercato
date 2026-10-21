/** @jest-environment node */

import {
  decideOnExistingOperation,
  hashOperationPayload,
  type OperationPayload,
  type OperationRecord,
} from '../domain/operation'

const payload: OperationPayload = {
  action: 'issueMaterial',
  orderId: 'order-1',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4,
}

function recordWith(state: OperationRecord['state']): OperationRecord {
  return {
    operationId: 'operation-1',
    action: 'issueMaterial',
    executionId: 'execution-1',
    payloadHash: hashOperationPayload(payload),
    requestedBy: 'user-1',
    sourceDocumentId: null,
    plan: null,
    state,
  }
}

describe('operation payload hash', () => {
  it('is stable for the same data regardless of key order', () => {
    const reordered: OperationPayload = {
      quantity: 4,
      locationId: 'location-1',
      warehouseId: 'warehouse-1',
      variantId: 'variant-1',
      orderId: 'order-1',
      action: 'issueMaterial',
    }

    expect(hashOperationPayload(reordered)).toBe(hashOperationPayload(payload))
  })

  it.each([
    ['action', { action: 'returnMaterial' as const }],
    ['order', { orderId: 'order-2' }],
    ['variant', { variantId: 'variant-2' }],
    ['warehouse', { warehouseId: 'warehouse-2' }],
    ['location', { locationId: 'location-2' }],
    ['quantity', { quantity: 5 }],
  ])('changes when the %s changes', (_label, change) => {
    expect(hashOperationPayload({ ...payload, ...change })).not.toBe(hashOperationPayload(payload))
  })
})

describe('decision on an existing operation', () => {
  const hash = hashOperationPayload(payload)

  it('rejects a different payload whatever the stored state', () => {
    const record = recordWith({ status: 'completed', movementId: 'movement-1' })

    expect(decideOnExistingOperation(record, 'other-hash')).toEqual({ kind: 'payloadMismatch' })
  })

  it('replays a completed operation', () => {
    const record = recordWith({ status: 'completed', movementId: 'movement-1' })

    expect(decideOnExistingOperation(record, hash)).toEqual({
      kind: 'replay',
      outcome: { status: 'completed', movementId: 'movement-1' },
    })
  })

  it('replays a rejected operation', () => {
    const record = recordWith({ status: 'rejected', code: 'insufficient_stock', message: 'Not enough stock.' })

    expect(decideOnExistingOperation(record, hash)).toMatchObject({ kind: 'replay', outcome: { status: 'rejected' } })
  })

  it.each([{ status: 'in_progress' as const }, { status: 'unknown' as const }])(
    'resumes an operation that is $status',
    (state) => {
      expect(decideOnExistingOperation(recordWith(state), hash)).toEqual({ kind: 'resume' })
    },
  )
})
