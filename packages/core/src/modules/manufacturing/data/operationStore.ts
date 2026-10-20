import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  PRODUCTION_FACT_KINDS,
  type ExecutionDocumentDraft,
  type PlannedExecution,
  type PlannedFact,
} from '../domain/executionDocument'
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

const plannedFactsSchema = z.array(
  z.object({
    factKind: z.enum(PRODUCTION_FACT_KINDS),
    variantId: z.string(),
    warehouseId: z.string().nullable(),
    locationId: z.string().nullable(),
    quantity: z.number().positive(),
    moves: z.boolean(),
  }),
)

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

function toPlannedFacts(row: ManufacturingOperation): PlannedFact[] {
  const parsed = plannedFactsSchema.safeParse(row.plannedFacts)

  if (!parsed.success) {
    throw new Error(`[internal] manufacturing operation ${row.operationId} has malformed planned_facts`, { cause: parsed.error })
  }

  return parsed.data
}

function toExecution(row: ManufacturingOperation): PlannedExecution | null {
  if (!row.documentType) return null

  return { documentType: row.documentType, movement: toMovement(row), facts: toPlannedFacts(row) }
}

function toState(row: ManufacturingOperation): OperationState {
  switch (row.status) {
    case 'completed':
      return { status: 'completed', movementId: row.movementId ?? null }
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
    sourceDocumentId: row.sourceDocumentId ?? null,
    execution: toExecution(row),
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

function toExecutionColumns(execution: PlannedExecution | null) {
  return {
    documentType: execution?.documentType ?? null,
    plannedFacts: execution?.facts ?? null,
    ...toMovementColumns(execution?.movement ?? null),
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
        sourceDocumentId: operation.sourceDocumentId,
        ...toExecutionColumns(operation.execution),
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
