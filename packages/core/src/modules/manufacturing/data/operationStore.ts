import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import {
  UNRESOLVED_OPERATION_STATUSES,
  type OperationOutcome,
  type OperationRecord,
  type OperationState,
} from '../domain/operation'
import type { OperationInsertResultDto, OperationStore } from '../ports/operationStore'
import {
  MANUFACTURING_OPERATION_ID_UNIQUE,
  MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE,
  ManufacturingOperation,
} from './entities'

export type MikroOperationStoreOptions = {
  em: EntityManager
}

function requireColumn(row: ManufacturingOperation, column: string, value: string | null | undefined): string {
  if (value) return value
  throw new Error(`[internal] manufacturing operation ${row.operationId} is ${row.status} but has no ${column}`)
}

function toState(row: ManufacturingOperation): OperationState {
  switch (row.status) {
    case 'completed':
      return { status: 'completed', movementId: requireColumn(row, 'movement_id', row.movementId) }
    case 'rejected':
      return {
        status: 'rejected',
        code: requireColumn(row, 'rejection_code', row.rejectionCode),
        message: requireColumn(row, 'rejection_message', row.rejectionMessage),
      }
    case 'unknown':
      return { status: 'unknown' }
    case 'in_progress':
      return { status: 'in_progress' }
  }
}

function toRecord(row: ManufacturingOperation): OperationRecord {
  return {
    operationId: row.operationId,
    action: row.action,
    orderId: row.orderId,
    payloadHash: row.payloadHash,
    state: toState(row),
  }
}

function toColumns(outcome: OperationOutcome) {
  switch (outcome.status) {
    case 'completed':
      return { status: outcome.status, movementId: outcome.movementId, rejectionCode: null, rejectionMessage: null }
    case 'rejected':
      return { status: outcome.status, movementId: null, rejectionCode: outcome.code, rejectionMessage: outcome.message }
    case 'unknown':
      return { status: outcome.status, movementId: null, rejectionCode: null, rejectionMessage: null }
  }
}

export function createMikroOperationStore({ em }: MikroOperationStoreOptions): OperationStore {
  return {
    async find(operationId, scope) {
      const row = await findOneWithDecryption(em.fork(), ManufacturingOperation, { ...scope, operationId }, undefined, scope)
      return row ? toRecord(row) : null
    },

    async findUnresolved(orderId, action, scope) {
      const row = await findOneWithDecryption(
        em.fork(),
        ManufacturingOperation,
        { ...scope, orderId, action, status: { $in: [...UNRESOLVED_OPERATION_STATUSES] } },
        undefined,
        scope,
      )
      return row ? toRecord(row) : null
    },

    async insertInProgress(operation, scope: ManufacturingScope): Promise<OperationInsertResultDto> {
      const fork = em.fork()
      const row = fork.create(ManufacturingOperation, { ...scope, ...operation, status: 'in_progress' })

      try {
        await fork.persist(row).flush()
        return 'inserted'
      } catch (error) {
        if (isUniqueViolation(error, MANUFACTURING_OPERATION_ID_UNIQUE)) return 'duplicate_operation'
        if (isUniqueViolation(error, MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE)) return 'unresolved_exists'
        throw error
      }
    },

    async resolveIfUnresolved(operationId, outcome, scope) {
      const updated = await em.fork().nativeUpdate(
        ManufacturingOperation,
        { ...scope, operationId, status: { $in: [...UNRESOLVED_OPERATION_STATUSES] } },
        { ...toColumns(outcome), updatedAt: new Date() },
      )
      return updated > 0
    },
  }
}
