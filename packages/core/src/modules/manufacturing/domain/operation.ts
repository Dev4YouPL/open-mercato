import { createHash } from 'node:crypto'
import type { PlannedMovement } from './movement'

export const OPERATION_ACTIONS = [
  'issueMaterial',
  'returnMaterial',
  'receiveOutput',
  'reverseDocument',
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
  sourceDocumentId: string | null
  movement: PlannedMovement | null
  state: OperationState
}

export type OperationPayload = { action: OperationAction } & Record<string, string | number | null>

export type ExistingOperationDecision =
  | { kind: 'payloadMismatch' }
  | { kind: 'replay'; outcome: FinalOperationOutcome }
  | { kind: 'resume' }

export function hashOperationPayload(payload: OperationPayload): string {
  const canonical = JSON.stringify(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))
  return createHash('sha256').update(canonical).digest('hex')
}

export function decideOnExistingOperation(record: OperationRecord, payloadHash: string): ExistingOperationDecision {
  if (record.payloadHash !== payloadHash) return { kind: 'payloadMismatch' }
  if (record.state.status === 'completed' || record.state.status === 'rejected') {
    return { kind: 'replay', outcome: record.state }
  }
  return { kind: 'resume' }
}
