/** @jest-environment node */

import type { ExecutionDocumentDraft, PlannedDocument } from '../../domain/executionDocument'
import type { PlannedMovement } from '../../domain/movement'
import type { OperationRecord } from '../../domain/operation'
import type { PositiveQuantity } from '../../domain/quantity'
import { planReversal, type ReversibleDocument } from '../../domain/reversal'
import type { ExecutionDocumentDto, ExecutionHistoryReader } from '../../ports/executionHistoryReader'
import type { InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type { OperationStore } from '../../ports/operationStore'
import type {
  ExecutionPlanResultDto,
  MaterialMovementInput,
  ProductionConfirmationInput,
  ProductionInventoryService,
} from '../productionInventoryService'
import { createProductionOperations, type WithOperationId } from '../productionOperations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }
const rejected: InventoryMovementResultDto = { status: 'rejected', code: 'insufficient_stock', message: 'Not enough stock.' }
const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }

const input: WithOperationId<MaterialMovementInput> = {
  operationId: 'operation-1',
  executionId: 'execution-1',
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

function issuePlan(plannedMovement: PlannedMovement): PlannedDocument {
  const { kind: _kind, ...snapshot } = plannedMovement
  return {
    documentType: 'issue',
    orderId: 'order-1',
    movement: plannedMovement,
    facts: [{ factKind: 'material_consumed', ...snapshot, moves: true }],
  }
}

const plan = issuePlan(movement)

const returnPlan: PlannedDocument = {
  documentType: 'return',
  orderId: 'order-1',
  movement: { ...movement, kind: 'restock' },
  facts: plan.facts.map((fact) => ({ ...fact, factKind: 'material_returned' })),
}

const planned: ExecutionPlanResultDto = { status: 'planned', plan }

function confirmationPlan(input: ProductionConfirmationInput): PlannedDocument {
  const receipt = { variantId: 'product-1', warehouseId: 'warehouse-2', locationId: 'location-2' }
  const scrap = { factKind: 'scrap_recorded' as const, variantId: 'product-1', warehouseId: null, locationId: null }
  return {
    documentType: 'confirmation',
    orderId: 'order-1',
    movement: input.goodQuantity > 0 ? { kind: 'receiveOutput', ...receipt, quantity: input.goodQuantity as PositiveQuantity } : null,
    facts: [
      ...(input.goodQuantity > 0 ? [{ factKind: 'output_received' as const, ...receipt, quantity: input.goodQuantity, moves: true }] : []),
      ...(input.scrapQuantity > 0 ? [{ ...scrap, quantity: input.scrapQuantity, moves: false }] : []),
    ],
  }
}

function isUnresolved(record: OperationRecord): boolean {
  return record.state.status === 'in_progress' || record.state.status === 'unknown'
}

function createMemoryOperationStore() {
  const records = new Map<string, OperationRecord>()
  const documents: ExecutionDocumentDraft[] = []

  const toDto = (document: ExecutionDocumentDraft, index: number): ExecutionDocumentDto => {
    const id = `document-${index + 1}`
    const reversal = documents.findIndex((candidate) => candidate.reversesDocumentId === id)
    return {
      ...document,
      id,
      postedAt: new Date(0),
      reversedByDocumentId: reversal >= 0 ? `document-${reversal + 1}` : null,
      facts: document.facts.map((fact, factIndex) => ({ ...fact, id: `${id}-fact-${factIndex + 1}` })),
    }
  }

  const history: ExecutionHistoryReader = {
    async listForExecution(executionId) {
      return documents.map(toDto).filter((document) => document.executionId === executionId)
    },
    async listForOrder(orderId) {
      return documents.map(toDto).filter((document) => document.orderId === orderId)
    },
    async getDocument(documentId) {
      return documents.map(toDto).find((document) => document.id === documentId) ?? null
    },
  }

  const store: OperationStore = {
    async find(operationId) {
      return records.get(operationId) ?? null
    },
    async findUnresolved(executionId, action) {
      return (
        [...records.values()].find(
          (record) => record.executionId === executionId && record.action === action && isUnresolved(record),
        ) ?? null
      )
    },
    async insert(operation) {
      if (records.has(operation.operationId)) return 'duplicate_operation'
      if (isUnresolved(operation) && (await store.findUnresolved(operation.executionId, operation.action, scope))) {
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

  return { store, records, documents, history }
}

function buildOperations(...results: InventoryMovementResultDto[]) {
  const { store, records, documents, history } = createMemoryOperationStore()
  const planIssueMaterial = jest.fn(async (): Promise<ExecutionPlanResultDto> => planned)
  const planReturnMaterial = jest.fn(async (): Promise<ExecutionPlanResultDto> => ({
    status: 'planned',
    plan: returnPlan,
  }))
  const planConfirmProduction = jest.fn(async (confirmation: ProductionConfirmationInput): Promise<ExecutionPlanResultDto> => ({
    status: 'planned',
    plan: confirmationPlan(confirmation),
  }))
  const planReverseDocument = jest.fn(async (document: ReversibleDocument): Promise<ExecutionPlanResultDto> => {
    const plan = planReversal(document)
    if (plan.status === 'planned') return { status: 'planned', plan: plan.plan }
    return { status: 'rejected', code: plan.status, message: plan.status }
  })
  let nextMovement = 1
  const postMovement = jest.fn(
    async (_operationId: string, _movement: PlannedMovement): Promise<InventoryMovementResultDto> =>
      results.shift() ?? { status: 'accepted', movementId: `movement-${nextMovement++}` },
  )
  const inventoryService = {
    planIssueMaterial,
    planReturnMaterial,
    planConfirmProduction,
    planReverseDocument,
    postMovement,
  } as unknown as ProductionInventoryService
  const operations = createProductionOperations({
    operationStore: store,
    inventoryService,
    executionHistoryReader: history,
    scope,
    userId: 'user-1',
  })
  return {
    operations,
    store,
    records,
    documents,
    history,
    planIssueMaterial,
    planReturnMaterial,
    planConfirmProduction,
    planReverseDocument,
    postMovement,
  }
}

describe('production operations', () => {
  it('records an accepted movement as completed with its planned snapshot and requester', async () => {
    const { operations, records, postMovement } = buildOperations(accepted)

    expect(await operations.issueMaterial(input)).toEqual(accepted)
    expect(postMovement).toHaveBeenCalledWith('operation-1', movement)
    expect(records.get('operation-1')).toMatchObject({
      requestedBy: 'user-1',
      plan,
      state: { status: 'completed', movementId: 'movement-1' },
    })
  })

  it('posts an execution document with the planned snapshot when the movement is accepted', async () => {
    const { operations, documents } = buildOperations(accepted)
    await operations.issueMaterial(input)

    expect(documents).toEqual([
      {
        documentType: 'issue',
        executionId: 'execution-1',
        orderId: 'order-1',
        operationId: 'operation-1',
        postedBy: 'user-1',
        reversesDocumentId: null,
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
    expect(records.get('operation-1')).toMatchObject({ plan: null, state: { status: 'rejected' } })
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

    planIssueMaterial.mockResolvedValue({
      status: 'planned',
      plan: issuePlan({ ...movement, locationId: 'moved-location' }),
    })

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
      executionHistoryReader: first.history,
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

  it('does not block other actions or other executions', async () => {
    const { operations, postMovement } = buildOperations(unknown, accepted, accepted)
    await operations.issueMaterial(input)

    expect(await operations.returnMaterial({ ...input, operationId: 'operation-2' })).toEqual(accepted)
    expect(await operations.issueMaterial({ ...input, operationId: 'operation-3', executionId: 'execution-2' })).toEqual(accepted)
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
      executionId: 'execution-1',
      payloadHash: 'ignored',
      requestedBy: 'user-1',
      sourceDocumentId: null,
      plan,
      state: { status: 'completed', movementId: 'movement-1' },
    })

    const result = await operations.issueMaterial(input)

    expect(find).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'rejected', code: 'operation_payload_mismatch' })
    expect(postMovement).not.toHaveBeenCalled()
  })

  describe('document reversal', () => {
    async function postIssue() {
      const built = buildOperations()
      await built.operations.issueMaterial(input)
      return built
    }

    it('posts an opposite document that points at the source and keeps both in history', async () => {
      const { operations, history, postMovement } = await postIssue()

      const result = await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      expect(result).toEqual({ status: 'accepted', movementId: 'movement-2' })
      expect(postMovement).toHaveBeenLastCalledWith('operation-2', { ...movement, kind: 'restock' })

      const documents = await history.listForExecution('execution-1', scope)

      expect(documents.map((document) => [document.id, document.documentType, document.reversesDocumentId, document.reversedByDocumentId])).toEqual([
        ['document-1', 'issue', null, 'document-2'],
        ['document-2', 'reversal', 'document-1', null],
      ])
      expect(documents[1].facts[0]).toMatchObject({ factKind: 'material_returned', quantity: 4, movementId: 'movement-2' })
    })

    it('refuses a second reversal of the same document without posting', async () => {
      const { operations, postMovement } = await postIssue()
      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      const result = await operations.reverseDocument({ operationId: 'operation-3', documentId: 'document-1' })

      expect(result).toMatchObject({ status: 'rejected', code: 'already_reversed' })
      expect(postMovement).toHaveBeenCalledTimes(2)
    })

    it('allows the reversing document to be reversed once, forming a chain', async () => {
      const { operations, history } = await postIssue()
      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      expect(await operations.reverseDocument({ operationId: 'operation-3', documentId: 'document-2' })).toMatchObject({
        status: 'accepted',
      })
      expect(await operations.reverseDocument({ operationId: 'operation-4', documentId: 'document-2' })).toMatchObject({
        status: 'rejected',
      })

      const chain = await history.listForExecution('execution-1', scope)

      expect(chain.map((document) => [document.reversesDocumentId, document.facts[0].factKind])).toEqual([
        [null, 'material_consumed'],
        ['document-1', 'material_returned'],
        ['document-2', 'material_consumed'],
      ])
    })

    it('leaves the source active when WMS rejects the reversal', async () => {
      const { operations, history, postMovement } = await postIssue()
      postMovement.mockResolvedValueOnce(rejected)

      expect(await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })).toEqual(rejected)

      const [source] = await history.listForExecution('execution-1', scope)

      expect(source.reversedByDocumentId).toBeNull()
      expect(await operations.reverseDocument({ operationId: 'operation-3', documentId: 'document-1' })).toMatchObject({
        status: 'accepted',
      })
    })

    it('replays a completed reversal and rejects reusing its id for another document', async () => {
      const { operations, postMovement } = await postIssue()
      await operations.issueMaterial({ ...input, operationId: 'operation-other' })
      const reversal = { operationId: 'operation-2', documentId: 'document-1' }
      const first = await operations.reverseDocument(reversal)

      expect(await operations.reverseDocument(reversal)).toEqual(first)
      expect(await operations.reverseDocument({ ...reversal, documentId: 'document-2' })).toMatchObject({
        code: 'operation_payload_mismatch',
      })
      expect(postMovement).toHaveBeenCalledTimes(3)
    })

    it('completes an unknown reversal on retry with the source snapshot', async () => {
      const { operations, history, postMovement } = await postIssue()
      postMovement.mockResolvedValueOnce(unknown)
      const reversal = { operationId: 'operation-2', documentId: 'document-1' }

      expect(await operations.reverseDocument(reversal)).toBe(unknown)
      expect(await operations.reverseDocument(reversal)).toMatchObject({ status: 'accepted' })

      const documents = await history.listForExecution('execution-1', scope)

      expect(documents[1]).toMatchObject({ documentType: 'reversal', reversesDocumentId: 'document-1' })
    })

    it('rejects an unknown document without recording an operation', async () => {
      const { operations, records } = buildOperations()

      expect(await operations.reverseDocument({ operationId: 'operation-2', documentId: 'missing' })).toMatchObject({
        status: 'rejected',
        code: 'document_not_found',
      })
      expect(records.has('operation-2')).toBe(false)
    })
  })

  describe('production confirmation', () => {
    const confirmation = { operationId: 'operation-1', executionId: 'execution-1', goodQuantity: 8, scrapQuantity: 2 }

    it('receives the good quantity and records scrap in one confirmation document', async () => {
      const { operations, documents, postMovement } = buildOperations()

      expect(await operations.confirmProduction(confirmation)).toEqual({ status: 'accepted', movementId: 'movement-1' })
      expect(postMovement).toHaveBeenCalledTimes(1)
      expect(documents).toHaveLength(1)
      expect(documents[0].documentType).toBe('confirmation')
      expect(documents[0].facts.map((fact) => [fact.factKind, fact.quantity, fact.movementId])).toEqual([
        ['output_received', 8, 'movement-1'],
        ['scrap_recorded', 2, null],
      ])
    })

    it('posts nothing to WMS for a scrap-only confirmation but still records the document', async () => {
      const { operations, records, documents, postMovement } = buildOperations()

      const result = await operations.confirmProduction({ ...confirmation, goodQuantity: 0 })

      expect(result).toEqual({ status: 'accepted', movementId: null })
      expect(postMovement).not.toHaveBeenCalled()
      expect(records.get('operation-1')?.state).toEqual({ status: 'completed', movementId: null })
      expect(documents[0].facts).toEqual([
        { factKind: 'scrap_recorded', variantId: 'product-1', warehouseId: null, locationId: null, quantity: 2, movementId: null },
      ])
    })

    it('treats a confirmation with good quantity as posted only once WMS accepts the receipt', async () => {
      const { operations, documents } = buildOperations(rejected)

      expect(await operations.confirmProduction(confirmation)).toEqual(rejected)
      expect(documents).toEqual([])
    })

    it('allows many partial confirmations on the same order', async () => {
      const { operations, documents } = buildOperations()

      await operations.confirmProduction(confirmation)
      await operations.confirmProduction({ ...confirmation, operationId: 'operation-2', goodQuantity: 100 })

      expect(documents.map((document) => document.facts[0].quantity)).toEqual([8, 100])
    })

    it('replays a scrap-only confirmation and rejects the same id with other quantities', async () => {
      const { operations, documents } = buildOperations()
      const scrapOnly = { ...confirmation, goodQuantity: 0 }
      await operations.confirmProduction(scrapOnly)

      expect(await operations.confirmProduction(scrapOnly)).toEqual({ status: 'accepted', movementId: null })
      expect(await operations.confirmProduction({ ...scrapOnly, scrapQuantity: 3 })).toMatchObject({
        code: 'operation_payload_mismatch',
      })
      expect(documents).toHaveLength(1)
    })

    it('reverses a scrap-only confirmation without calling WMS', async () => {
      const { operations, documents, postMovement } = buildOperations()
      await operations.confirmProduction({ ...confirmation, goodQuantity: 0 })

      expect(await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })).toEqual({
        status: 'accepted',
        movementId: null,
      })
      expect(postMovement).not.toHaveBeenCalled()
      expect(documents[1]).toMatchObject({ documentType: 'reversal', reversesDocumentId: 'document-1' })
      expect(documents[1].facts[0]).toMatchObject({ factKind: 'scrap_reversed', movementId: null })
    })
  })

  describe('material return', () => {
    it('records a return of material that was never issued on the order', async () => {
      const { operations, documents } = buildOperations()

      expect(await operations.returnMaterial(input)).toMatchObject({ status: 'accepted' })
      expect(documents.map((document) => [document.documentType, document.facts[0].factKind])).toEqual([
        ['return', 'material_returned'],
      ])
    })

    it('records a return larger than the earlier issue when WMS accepts it', async () => {
      const { operations, documents } = buildOperations()
      await operations.issueMaterial(input)

      expect(await operations.returnMaterial({ ...input, operationId: 'operation-2', quantity: 10 })).toMatchObject({
        status: 'accepted',
      })
      expect(documents).toHaveLength(2)
    })
  })

  describe('correcting issues, returns and confirmations', () => {
    it('reverses a return with a consume movement from its snapshot', async () => {
      const { operations, documents, postMovement } = buildOperations()
      await operations.returnMaterial(input)

      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      expect(postMovement).toHaveBeenLastCalledWith('operation-2', movement)
      expect(documents[1]).toMatchObject({ documentType: 'reversal', reversesDocumentId: 'document-1' })
      expect(documents[1].facts[0].factKind).toBe('material_consumed')
    })

    it('allows a new, correct issue after reversing a wrong one', async () => {
      const { operations, documents } = buildOperations()
      await operations.issueMaterial(input)
      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      expect(await operations.issueMaterial({ ...input, operationId: 'operation-3', quantity: 3 })).toMatchObject({
        status: 'accepted',
      })
      expect(documents.map((document) => document.documentType)).toEqual(['issue', 'reversal', 'issue'])
    })

    it('restores the original effect when a mistaken reversal is reversed', async () => {
      const { operations, postMovement } = buildOperations()
      await operations.issueMaterial(input)
      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })
      await operations.reverseDocument({ operationId: 'operation-3', documentId: 'document-2' })

      expect(postMovement.mock.calls.map(([, posted]) => posted.kind)).toEqual(['consume', 'restock', 'consume'])
    })

    it('reverses a confirmation together with its receipt and scrap', async () => {
      const { operations, documents, postMovement } = buildOperations()
      await operations.confirmProduction({ operationId: 'operation-1', executionId: 'execution-1', goodQuantity: 8, scrapQuantity: 2 })

      expect(await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })).toMatchObject({
        status: 'accepted',
      })
      expect(postMovement).toHaveBeenLastCalledWith(
        'operation-2',
        expect.objectContaining({ kind: 'consume', variantId: 'product-1', quantity: 8 }),
      )
      expect(documents[1].facts.map((fact) => [fact.factKind, fact.quantity])).toEqual([
        ['output_reversed', 8],
        ['scrap_reversed', 2],
      ])
    })

    it('allows a new, correct confirmation after reversing a wrong one', async () => {
      const { operations, documents } = buildOperations()
      const confirmation = { operationId: 'operation-1', executionId: 'execution-1', goodQuantity: 8, scrapQuantity: 0 }
      await operations.confirmProduction(confirmation)
      await operations.reverseDocument({ operationId: 'operation-2', documentId: 'document-1' })

      expect(await operations.confirmProduction({ ...confirmation, operationId: 'operation-3', goodQuantity: 6 })).toMatchObject({
        status: 'accepted',
      })
      expect(documents.map((document) => document.documentType)).toEqual(['confirmation', 'reversal', 'confirmation'])
    })
  })

  describe('resuming an operation by id', () => {
    it('finishes an unknown operation from its stored plan without the original payload', async () => {
      const { operations, documents, postMovement } = buildOperations(unknown, accepted)
      await operations.issueMaterial(input)

      expect(await operations.resumeOperation('operation-1')).toEqual(accepted)
      expect(postMovement).toHaveBeenLastCalledWith('operation-1', movement)
      expect(documents).toHaveLength(1)
    })

    it('replays a finished operation without posting again', async () => {
      const { operations, postMovement } = buildOperations(rejected)
      await operations.issueMaterial(input)

      expect(await operations.resumeOperation('operation-1')).toEqual(rejected)
      expect(postMovement).toHaveBeenCalledTimes(1)
    })

    it('rejects an unknown operation id', async () => {
      const { operations } = buildOperations()

      expect(await operations.resumeOperation('missing')).toMatchObject({ status: 'rejected', code: 'operation_not_found' })
    })
  })
})

