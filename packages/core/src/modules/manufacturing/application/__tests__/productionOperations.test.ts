/** @jest-environment node */

import type { OperationRecord } from '../../domain/operation'
import type { InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type { NewOperationDto, OperationStore } from '../../ports/operationStore'
import type { MaterialMovementInput, ProductionInventoryService } from '../productionInventoryService'
import { createProductionOperations } from '../productionOperations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }
const rejected: InventoryMovementResultDto = { status: 'rejected', code: 'insufficient_stock', message: 'Not enough stock.' }
const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }

const input: MaterialMovementInput = {
  operationId: 'operation-1',
  orderId: 'order-1',
  variantId: 'variant-1',
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  quantity: 4,
}

function isUnresolved(record: OperationRecord): boolean {
  return record.state.status === 'in_progress' || record.state.status === 'unknown'
}

function createMemoryOperationStore() {
  const records = new Map<string, OperationRecord>()

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
    async insertInProgress(operation: NewOperationDto) {
      if (records.has(operation.operationId)) return 'duplicate_operation'
      if (await store.findUnresolved(operation.orderId, operation.action, scope)) return 'unresolved_exists'
      records.set(operation.operationId, { ...operation, state: { status: 'in_progress' } })
      return 'inserted'
    },
    async resolveIfUnresolved(operationId, outcome) {
      const record = records.get(operationId)
      if (!record || !isUnresolved(record)) return false
      records.set(operationId, { ...record, state: outcome })
      return true
    },
  }

  return { store, records }
}

function buildOperations(...results: InventoryMovementResultDto[]) {
  const { store, records } = createMemoryOperationStore()
  const issueMaterial = jest.fn(async () => results.shift() ?? accepted)
  const returnMaterial = jest.fn(async () => accepted)
  const inventoryService = { issueMaterial, returnMaterial } as unknown as ProductionInventoryService
  const operations = createProductionOperations({ operationStore: store, inventoryService, scope })
  return { operations, store, records, issueMaterial, returnMaterial }
}

describe('production operations', () => {
  it('records an accepted movement as completed', async () => {
    const { operations, records } = buildOperations(accepted)

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(records.get('operation-1')?.state).toEqual({ status: 'completed', movementId: 'movement-1' })
  })

  it('replays a completed operation without posting again', async () => {
    const { operations, issueMaterial } = buildOperations(accepted)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(issueMaterial).toHaveBeenCalledTimes(1)
  })

  it('replays a rejected operation without posting again', async () => {
    const { operations, issueMaterial } = buildOperations(rejected)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial(input)).toEqual(rejected)
    expect(issueMaterial).toHaveBeenCalledTimes(1)
  })

  it('rejects the same operation id with different data', async () => {
    const { operations, issueMaterial } = buildOperations(accepted)
    await operations.issueMaterial(input)

    const result = await operations.issueMaterial({ ...input, quantity: 5 })

    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(issueMaterial).toHaveBeenCalledTimes(1)
  })

  it('rejects the same operation id reused for another action', async () => {
    const { operations, returnMaterial } = buildOperations(accepted)
    await operations.issueMaterial(input)

    const result = await operations.returnMaterial(input)

    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(returnMaterial).not.toHaveBeenCalled()
  })

  it('keeps an unknown outcome retryable and completes it on a safe retry', async () => {
    const { operations, records, issueMaterial } = buildOperations(unknown, accepted)

    expect(await operations.issueMaterial(input)).toBe(unknown)
    expect(records.get('operation-1')?.state).toEqual({ status: 'unknown' })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(issueMaterial).toHaveBeenCalledTimes(2)
    expect(records.get('operation-1')?.state).toEqual({ status: 'completed', movementId: 'movement-1' })
  })

  it('resumes an operation left in progress by a crash', async () => {
    const { operations, records, issueMaterial } = buildOperations(accepted)
    issueMaterial.mockRejectedValueOnce(new Error('process died'))

    await expect(operations.issueMaterial(input)).rejects.toThrow('process died')
    expect(records.get('operation-1')?.state).toEqual({ status: 'in_progress' })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
  })

  it('blocks a new operation of the same action on the same order while one is unresolved', async () => {
    const { operations, issueMaterial } = buildOperations(unknown)
    await operations.issueMaterial(input)

    const result = await operations.issueMaterial({ ...input, operationId: 'operation-2' })

    expect(result).toEqual({ status: 'blocked', blockingOperationId: 'operation-1' })
    expect(issueMaterial).toHaveBeenCalledTimes(1)
  })

  it('does not block other actions or other orders', async () => {
    const { operations, returnMaterial, issueMaterial } = buildOperations(unknown, accepted)
    await operations.issueMaterial(input)

    expect(await operations.returnMaterial({ ...input, operationId: 'operation-2' })).toEqual(accepted)
    expect(await operations.issueMaterial({ ...input, operationId: 'operation-3', orderId: 'order-2' })).toEqual(accepted)
    expect(returnMaterial).toHaveBeenCalledTimes(1)
    expect(issueMaterial).toHaveBeenCalledTimes(2)
  })

  it('allows a new operation once the unresolved one is retried to completion', async () => {
    const { operations } = buildOperations(unknown, accepted, accepted)
    await operations.issueMaterial(input)
    await operations.issueMaterial(input)

    expect(await operations.issueMaterial({ ...input, operationId: 'operation-2' })).toEqual(accepted)
  })

  it('returns the stored outcome when a concurrent retry finished first', async () => {
    const { operations, store, issueMaterial } = buildOperations(unknown)
    await operations.issueMaterial(input)

    issueMaterial.mockImplementationOnce(async () => {
      await store.resolveIfUnresolved('operation-1', { status: 'completed', movementId: 'movement-1' }, scope)
      return { status: 'accepted', movementId: 'movement-1' }
    })

    expect(await operations.issueMaterial(input)).toEqual(accepted)
  })

  it('continues the existing operation when an insert loses the race on the same id', async () => {
    const { operations, store, records, issueMaterial } = buildOperations(accepted)
    const find = jest.spyOn(store, 'find').mockResolvedValueOnce(null)
    records.set('operation-1', {
      operationId: 'operation-1',
      action: 'issueMaterial',
      orderId: 'order-1',
      payloadHash: 'ignored',
      state: { status: 'completed', movementId: 'movement-1' },
    })

    const result = await operations.issueMaterial(input)

    expect(find).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(issueMaterial).not.toHaveBeenCalled()
  })
})
