/** @jest-environment node */

import type { ExecutionDocumentDraft } from '../../domain/executionDocument'
import type { PlannedMovement } from '../../domain/movement'
import type { OperationRecord } from '../../domain/operation'
import type { PositiveQuantity } from '../../domain/quantity'
import type { InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type { OperationStore } from '../../ports/operationStore'
import type {
  MaterialMovementInput,
  MovementPlanResultDto,
  ProductionInventoryService,
} from '../productionInventoryService'
import { createProductionOperations, type WithOperationId } from '../productionOperations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }
const rejected: InventoryMovementResultDto = { status: 'rejected', code: 'insufficient_stock', message: 'Not enough stock.' }
const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }

const input: WithOperationId<MaterialMovementInput> = {
  operationId: 'operation-1',
  orderId: 'order-1',
  variantId: 'variant-1',
  quantity: 4,
}

const movement: PlannedMovement = {
  kind: 'consume',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4 as PositiveQuantity,
}

const planned: MovementPlanResultDto = { status: 'planned', movement }

function isUnresolved(record: OperationRecord): boolean {
  return record.state.status === 'in_progress' || record.state.status === 'unknown'
}

function createMemoryOperationStore() {
  const records = new Map<string, OperationRecord>()
  const documents: ExecutionDocumentDraft[] = []

  const store: OperationStore = {
    async find(operationId) {
      return records.get(operationId) ?? null
    },
    async findUnresolved(orderId, action) {
      return (
        [...records.values()].find(
          (record) => record.orderId === orderId && record.action === action && isUnresolved(record),
        ) ?? null
      )
    },
    async insert(operation) {
      if (records.has(operation.operationId)) return 'duplicate_operation'
      if (isUnresolved(operation) && (await store.findUnresolved(operation.orderId, operation.action, scope))) {
        return 'unresolved_exists'
      }
      records.set(operation.operationId, operation)
      return 'inserted'
    },
    async resolveIfUnresolved(operationId, outcome, document) {
      const record = records.get(operationId)
      if (!record || !isUnresolved(record)) return false
      records.set(operationId, { ...record, state: outcome })
      if (document) documents.push(document)
      return true
    },
  }

  return { store, records, documents }
}

function buildOperations(...results: InventoryMovementResultDto[]) {
  const { store, records, documents } = createMemoryOperationStore()
  const planIssueMaterial = jest.fn(async (): Promise<MovementPlanResultDto> => planned)
  const planReturnMaterial = jest.fn(async (): Promise<MovementPlanResultDto> => ({
    status: 'planned',
    movement: { ...movement, kind: 'restock' },
  }))
  const postMovement = jest.fn(async () => results.shift() ?? accepted)
  const inventoryService = { planIssueMaterial, planReturnMaterial, postMovement } as unknown as ProductionInventoryService
  const operations = createProductionOperations({ operationStore: store, inventoryService, scope, userId: 'user-1' })
  return { operations, store, records, documents, planIssueMaterial, planReturnMaterial, postMovement }
}

describe('production operations', () => {
  it('records an accepted movement as completed with its planned snapshot and requester', async () => {
    const { operations, records, postMovement } = buildOperations(accepted)

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(postMovement).toHaveBeenCalledWith('operation-1', movement)
    expect(records.get('operation-1')).toMatchObject({
      requestedBy: 'user-1',
      movement,
      state: { status: 'completed', movementId: 'movement-1' },
    })
  })

  it('posts an execution document with the planned snapshot when the movement is accepted', async () => {
    const { operations, documents } = buildOperations(accepted)
    await operations.issueMaterial(input)

    expect(documents).toEqual([
      {
        documentType: 'issue',
        orderId: 'order-1',
        operationId: 'operation-1',
        postedBy: 'user-1',
        facts: [
          {
            factKind: 'material_consumed',
            variantId: 'variant-1',
            warehouseId: 'warehouse-1',
            locationId: 'location-1',
            quantity: 4,
            movementId: 'movement-1',
          },
        ],
      },
    ])
  })

  it.each([
    ['rejected', rejected],
    ['unknown', unknown],
  ])('posts no document when the movement is %s', async (_label, result) => {
    const { operations, documents } = buildOperations(result)
    await operations.issueMaterial(input)

    expect(documents).toEqual([])
  })

  it('records a planning rejection durably without posting', async () => {
    const { operations, records, planIssueMaterial, postMovement } = buildOperations()
    planIssueMaterial.mockResolvedValue({ status: 'rejected', code: 'location_missing', message: 'No location.' })

    const first = await operations.issueMaterial(input)
    const retry = await operations.issueMaterial(input)

    expect(first).toEqual({ status: 'rejected', code: 'location_missing', message: 'No location.' })
    expect(retry).toEqual(first)
    expect(planIssueMaterial).toHaveBeenCalledTimes(1)
    expect(postMovement).not.toHaveBeenCalled()
    expect(records.get('operation-1')).toMatchObject({ movement: null, state: { status: 'rejected' } })
  })

  it('replays a completed operation without posting again or adding a document', async () => {
    const { operations, documents, postMovement } = buildOperations(accepted)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(postMovement).toHaveBeenCalledTimes(1)
    expect(documents).toHaveLength(1)
  })

  it('replays a rejected operation without posting again', async () => {
    const { operations, postMovement } = buildOperations(rejected)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial(input)).toEqual(rejected)
    expect(postMovement).toHaveBeenCalledTimes(1)
  })

  it('rejects the same operation id with different data', async () => {
    const { operations, postMovement } = buildOperations(accepted)
    await operations.issueMaterial(input)

    const result = await operations.issueMaterial({ ...input, quantity: 5 })

    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(postMovement).toHaveBeenCalledTimes(1)
  })

  it('rejects the same operation id reused for another action', async () => {
    const { operations, planReturnMaterial } = buildOperations(accepted)
    await operations.issueMaterial(input)

    const result = await operations.returnMaterial(input)

    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(planReturnMaterial).not.toHaveBeenCalled()
  })

  it('retries an unknown outcome with the stored snapshot instead of planning again', async () => {
    const { operations, records, documents, planIssueMaterial, postMovement } = buildOperations(unknown, accepted)

    expect(await operations.issueMaterial(input)).toBe(unknown)
    expect(records.get('operation-1')?.state).toEqual({ status: 'unknown' })

    planIssueMaterial.mockResolvedValue({ status: 'planned', movement: { ...movement, locationId: 'moved-location' } })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(planIssueMaterial).toHaveBeenCalledTimes(1)
    expect(postMovement).toHaveBeenLastCalledWith('operation-1', movement)
    expect(documents[0].facts[0].locationId).toBe('location-1')
  })

  it('keeps the original requester as the poster when another user retries', async () => {
    const first = buildOperations(unknown, accepted)
    await first.operations.issueMaterial(input)

    const retryingUser = createProductionOperations({
      operationStore: first.store,
      inventoryService: { postMovement: first.postMovement } as unknown as ProductionInventoryService,
      scope,
      userId: 'user-2',
    })
    await retryingUser.issueMaterial(input)

    expect(first.documents[0].postedBy).toBe('user-1')
  })

  it('resumes an operation left in progress by a crash', async () => {
    const { operations, records, postMovement } = buildOperations(accepted)
    postMovement.mockRejectedValueOnce(new Error('process died'))

    await expect(operations.issueMaterial(input)).rejects.toThrow('process died')
    expect(records.get('operation-1')?.state).toEqual({ status: 'in_progress' })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
  })

  it('blocks a new operation of the same action on the same order while one is unresolved', async () => {
    const { operations, postMovement } = buildOperations(unknown)
    await operations.issueMaterial(input)

    const result = await operations.issueMaterial({ ...input, operationId: 'operation-2' })

    expect(result).toEqual({ status: 'blocked', blockingOperationId: 'operation-1' })
    expect(postMovement).toHaveBeenCalledTimes(1)
  })

  it('does not block other actions or other orders', async () => {
    const { operations, postMovement } = buildOperations(unknown, accepted, accepted)
    await operations.issueMaterial(input)

    expect(await operations.returnMaterial({ ...input, operationId: 'operation-2' })).toEqual(accepted)
    expect(await operations.issueMaterial({ ...input, operationId: 'operation-3', orderId: 'order-2' })).toEqual(accepted)
    expect(postMovement).toHaveBeenCalledTimes(3)
  })

  it('allows a new operation once the unresolved one is retried to completion', async () => {
    const { operations } = buildOperations(unknown, accepted, accepted)
    await operations.issueMaterial(input)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial({ ...input, operationId: 'operation-2' })).toEqual(accepted)
  })

  it('returns the stored outcome when a concurrent retry finished first', async () => {
    const { operations, store, documents, postMovement } = buildOperations(unknown)
    await operations.issueMaterial(input)

    postMovement.mockImplementationOnce(async () => {
      await store.resolveIfUnresolved('operation-1', { status: 'completed', movementId: 'movement-1' }, null, scope)
      return { status: 'accepted', movementId: 'movement-1' }
    })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(documents).toEqual([])
  })

  it('continues the existing operation when an insert loses the race on the same id', async () => {
    const { operations, store, records, postMovement } = buildOperations(accepted)
    const find = jest.spyOn(store, 'find').mockResolvedValueOnce(null)
    records.set('operation-1', {
      operationId: 'operation-1',
      action: 'issueMaterial',
      orderId: 'order-1',
      payloadHash: 'ignored',
      requestedBy: 'user-1',
      movement,
      state: { status: 'completed', movementId: 'movement-1' },
    })

    const result = await operations.issueMaterial(input)

    expect(find).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(postMovement).not.toHaveBeenCalled()
  })
})
