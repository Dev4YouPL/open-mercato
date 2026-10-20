import { createHash } from 'node:crypto'
import type { PlannedMovement } from './movement'

export const OPERATION_ACTIONS = [
  'issueMaterial',
  'returnMaterial',
  'receiveOutput',
  'reverseMaterialIssue',
  'reverseMaterialReturn',
  'reverseOutputReceipt',
] as const

export type OperationAction = (typeof OPERATION_ACTIONS)[number]

export type OperationOutcome =
  | { status: 'completed'; movementId: string }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'unknown' }

export type FinalOperationOutcome = Extract<OperationOutcome, { status: 'completed' | 'rejected' }>

export type OperationState = { status: 'in_progress' } | OperationOutcome

export type OperationStatus = OperationState['status']

export const UNRESOLVED_OPERATION_STATUSES = ['in_progress', 'unknown'] as const satisfies readonly OperationStatus[]

export type OperationRecord = {
  operationId: string
  action: OperationAction
  orderId: string
  payloadHash: string
  requestedBy: string
  movement: PlannedMovement | null
  state: OperationState
}

export type OperationPayload = {
  action: OperationAction
  orderId: string
  variantId: string | null
  warehouseId: string | null
  locationId: string | null
  quantity: number
}

export type ExistingOperationDecision =
  | { kind: 'payloadMismatch' }
  | { kind: 'replay'; outcome: FinalOperationOutcome }
  | { kind: 'resume' }

export function hashOperationPayload(payload: OperationPayload): string {
  const canonical = JSON.stringify([
    payload.action,
    payload.orderId,
    payload.variantId,
    payload.warehouseId,
    payload.locationId,
    payload.quantity,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export function decideOnExistingOperation(record: OperationRecord, payloadHash: string): ExistingOperationDecision {
  if (record.payloadHash !== payloadHash) return { kind: 'payloadMismatch' }
  if (record.state.status === 'completed' || record.state.status === 'rejected') {
    return { kind: 'replay', outcome: record.state }
  }
  return { kind: 'resume' }
}
