import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ExecutionDocumentDraft } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { PlannedMovement } from '../domain/movement'
import { UNRESOLVED_OPERATION_STATUSES, type OperationRecord, type OperationState } from '../domain/operation'
import { toPositiveQuantity } from '../domain/quantity'
import type { OperationInsertResultDto, OperationStore } from '../ports/operationStore'
import {
  ExecutionDocument,
  MANUFACTURING_OPERATION_ID_UNIQUE,
  MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE,
  ManufacturingOperation,
  ProductionFact,
} from './entities'

export type MikroOperationStoreOptions = {
  em: EntityManager
}

function requireColumn<TValue>(row: ManufacturingOperation, column: string, value: TValue | null | undefined): TValue {
  if (value) return value
  throw new Error(`[internal] manufacturing operation ${row.operationId} is ${row.status} but has no ${column}`)
}

function toMovement(row: ManufacturingOperation): PlannedMovement | null {
  if (!row.movementKind) return null

  const quantity = toPositiveQuantity(Number(row.quantity))

  return {
    kind: row.movementKind,
    variantId: requireColumn(row, 'variant_id', row.variantId),
    warehouseId: requireColumn(row, 'warehouse_id', row.warehouseId),
    locationId: requireColumn(row, 'location_id', row.locationId),
    quantity: requireColumn(row, 'quantity', quantity),
  }
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
    requestedBy: row.requestedBy,
    movement: toMovement(row),
    state: toState(row),
  }
}

function toStateColumns(state: OperationState) {
  switch (state.status) {
    case 'completed':
      return { status: state.status, movementId: state.movementId, rejectionCode: null, rejectionMessage: null }
    case 'rejected':
      return { status: state.status, movementId: null, rejectionCode: state.code, rejectionMessage: state.message }
    case 'unknown':
    case 'in_progress':
      return { status: state.status, movementId: null, rejectionCode: null, rejectionMessage: null }
  }
}

function toMovementColumns(movement: PlannedMovement | null) {
  return {
    movementKind: movement?.kind ?? null,
    variantId: movement?.variantId ?? null,
    warehouseId: movement?.warehouseId ?? null,
    locationId: movement?.locationId ?? null,
    quantity: movement ? String(movement.quantity) : null,
  }
}

function persistDocument(em: EntityManager, document: ExecutionDocumentDraft, scope: ManufacturingScope): void {
  const { facts, ...header } = document
  const row = em.create(ExecutionDocument, { ...scope, ...header, postedAt: new Date() })

  em.persist(row)

  for (const fact of facts) {
    em.persist(em.create(ProductionFact, { ...scope, ...fact, document: row, quantity: String(fact.quantity) }))
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

    async insert(operation, scope: ManufacturingScope): Promise<OperationInsertResultDto> {
      const fork = em.fork()
      const row = fork.create(ManufacturingOperation, {
        ...scope,
        operationId: operation.operationId,
        action: operation.action,
        orderId: operation.orderId,
        payloadHash: operation.payloadHash,
        requestedBy: operation.requestedBy,
        ...toMovementColumns(operation.movement),
        ...toStateColumns(operation.state),
      })

      try {
        await fork.persist(row).flush()
        return 'inserted'
      } catch (error) {
        if (isUniqueViolation(error, MANUFACTURING_OPERATION_ID_UNIQUE)) return 'duplicate_operation'
        if (isUniqueViolation(error, MANUFACTURING_OPERATION_UNRESOLVED_UNIQUE)) return 'unresolved_exists'
        throw error
      }
    },

    async resolveIfUnresolved(operationId, outcome, document, scope) {
      return em.fork().transactional(async (tx) => {
        const updated = await tx.nativeUpdate(
          ManufacturingOperation,
          { ...scope, operationId, status: { $in: [...UNRESOLVED_OPERATION_STATUSES] } },
          { ...toStateColumns(outcome), updatedAt: new Date() },
        )

        if (updated === 0) return false
        if (document) persistDocument(tx, document, scope)

        return true
      })
    },
  }
}
