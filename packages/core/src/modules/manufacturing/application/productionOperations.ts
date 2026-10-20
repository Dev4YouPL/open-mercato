import { buildExecutionDocument } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import {
  decideOnExistingOperation,
  hashOperationPayload,
  type FinalOperationOutcome,
  type OperationAction,
  type OperationOutcome,
  type OperationPayload,
  type OperationRecord,
} from '../domain/operation'
import type { ExecutionHistoryReader } from '../ports/executionHistoryReader'
import type { InventoryMovementResultDto } from '../ports/inventoryGateway'
import type { OperationStore } from '../ports/operationStore'
import type {
  ExecutionPlanResultDto,
  MaterialMovementInput,
  ProductionConfirmationInput,
  ProductionInventoryService,
} from './productionInventoryService'

export type WithOperationId<TInput> = TInput & { operationId: string }

export type DocumentReversalInput = {
  operationId: string
  documentId: string
}

export type ProductionOperationResultDto =
  | { status: 'accepted'; movementId: string | null }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'unknown'; cause: unknown }
  | { status: 'blocked'; blockingOperationId: string }

type PostingResult = Exclude<ProductionOperationResultDto, { status: 'blocked' }>

export interface ProductionOperations {
  issueMaterial(input: WithOperationId<MaterialMovementInput>): Promise<ProductionOperationResultDto>
  returnMaterial(input: WithOperationId<MaterialMovementInput>): Promise<ProductionOperationResultDto>
  confirmProduction(input: WithOperationId<ProductionConfirmationInput>): Promise<ProductionOperationResultDto>
  reverseDocument(input: DocumentReversalInput): Promise<ProductionOperationResultDto>
}

type ProductionOperationsDeps = {
  operationStore: OperationStore
  inventoryService: ProductionInventoryService
  executionHistoryReader: ExecutionHistoryReader
  scope: ManufacturingScope
  userId: string
}

type OperationRequest = {
  action: OperationAction
  operationId: string
  orderId: string
  payloadHash: string
  sourceDocumentId: string | null
  plan: () => Promise<ExecutionPlanResultDto>
}

function buildOrderRequest(
  input: { operationId: string; orderId: string },
  payload: OperationPayload,
  plan: () => Promise<ExecutionPlanResultDto>,
): OperationRequest {
  return {
    action: payload.action,
    operationId: input.operationId,
    orderId: input.orderId,
    payloadHash: hashOperationPayload(payload),
    sourceDocumentId: null,
    plan,
  }
}

function toOutcome(result: PostingResult): OperationOutcome {
  switch (result.status) {
    case 'accepted':
      return { status: 'completed', movementId: result.movementId }
    case 'rejected':
      return { status: 'rejected', code: result.code, message: result.message }
    case 'unknown':
      return { status: 'unknown' }
  }
}

function toReplayResult(outcome: FinalOperationOutcome): PostingResult {
  if (outcome.status === 'completed') return { status: 'accepted', movementId: outcome.movementId }
  return { status: 'rejected', code: outcome.code, message: outcome.message }
}

function toOperationRecord(deps: ProductionOperationsDeps, request: OperationRequest, plan: ExecutionPlanResultDto): OperationRecord {
  const base = {
    operationId: request.operationId,
    action: request.action,
    orderId: request.orderId,
    payloadHash: request.payloadHash,
    requestedBy: deps.userId,
    sourceDocumentId: request.sourceDocumentId,
  }

  if (plan.status === 'rejected') {
    return { ...base, execution: null, state: { status: 'rejected', code: plan.code, message: plan.message } }
  }

  return { ...base, execution: plan.execution, state: { status: 'in_progress' } }
}

async function post(deps: ProductionOperationsDeps, operation: OperationRecord): Promise<PostingResult> {
  const execution = operation.execution

  if (!execution) throw new Error(`[internal] manufacturing operation ${operation.operationId} has no planned execution`)
  if (!execution.movement) return { status: 'accepted', movementId: null }

  return deps.inventoryService.postMovement(operation.operationId, execution.movement)
}

async function postAndRecord(deps: ProductionOperationsDeps, operation: OperationRecord): Promise<PostingResult> {
  const result = await post(deps, operation)
  const document =
    result.status === 'accepted' && operation.execution
      ? buildExecutionDocument({
          orderId: operation.orderId,
          operationId: operation.operationId,
          postedBy: operation.requestedBy,
          reversesDocumentId: operation.sourceDocumentId,
          execution: operation.execution,
          movementId: result.movementId,
        })
      : null
  const resolved = await deps.operationStore.resolveIfUnresolved(operation.operationId, toOutcome(result), document, deps.scope)

  if (resolved) return result

  const current = await deps.operationStore.find(operation.operationId, deps.scope)
  const decision = current ? decideOnExistingOperation(current, operation.payloadHash) : null

  return decision?.kind === 'replay' ? toReplayResult(decision.outcome) : result
}

async function continueExisting(
  deps: ProductionOperationsDeps,
  request: OperationRequest,
  existing: OperationRecord,
): Promise<ProductionOperationResultDto> {
  const decision = decideOnExistingOperation(existing, request.payloadHash)

  switch (decision.kind) {
    case 'payloadMismatch':
      return {
        status: 'rejected',
        code: 'operation_payload_mismatch',
        message: 'This operation id was already used with different data.',
      }
    case 'replay':
      return toReplayResult(decision.outcome)
    case 'resume':
      return postAndRecord(deps, existing)
  }
}

async function runOperation(deps: ProductionOperationsDeps, request: OperationRequest): Promise<ProductionOperationResultDto> {
  const existing = await deps.operationStore.find(request.operationId, deps.scope)

  if (existing) return continueExisting(deps, request, existing)

  const plan = await request.plan()
  const operation = toOperationRecord(deps, request, plan)
  const insertion = await deps.operationStore.insert(operation, deps.scope)

  if (insertion === 'inserted') {
    return plan.status === 'rejected' ? plan : postAndRecord(deps, operation)
  }

  const raced = await deps.operationStore.find(request.operationId, deps.scope)

  if (raced) return continueExisting(deps, request, raced)

  const blocking = await deps.operationStore.findUnresolved(request.orderId, request.action, deps.scope)

  if (blocking) return { status: 'blocked', blockingOperationId: blocking.operationId }

  return runOperation(deps, request)
}

async function reverseDocument(
  deps: ProductionOperationsDeps,
  input: DocumentReversalInput,
): Promise<ProductionOperationResultDto> {
  const source = await deps.executionHistoryReader.getDocument(input.documentId, deps.scope)

  if (!source) return { status: 'rejected', code: 'document_not_found', message: 'Execution document was not found.' }

  return runOperation(deps, {
    action: 'reverseDocument',
    operationId: input.operationId,
    orderId: source.orderId,
    payloadHash: hashOperationPayload({ action: 'reverseDocument', documentId: source.id }),
    sourceDocumentId: source.id,
    plan: () => deps.inventoryService.planReverseDocument(source),
  })
}

export function createProductionOperations(deps: ProductionOperationsDeps): ProductionOperations {
  const service = deps.inventoryService

  return {
    issueMaterial: (input) =>
      runOperation(
        deps,
        buildOrderRequest(
          input,
          { action: 'issueMaterial', orderId: input.orderId, variantId: input.variantId, quantity: input.quantity },
          () => service.planIssueMaterial(input),
        ),
      ),
    returnMaterial: (input) =>
      runOperation(
        deps,
        buildOrderRequest(
          input,
          { action: 'returnMaterial', orderId: input.orderId, variantId: input.variantId, quantity: input.quantity },
          () => service.planReturnMaterial(input),
        ),
      ),
    confirmProduction: (input) =>
      runOperation(
        deps,
        buildOrderRequest(
          input,
          {
            action: 'confirmProduction',
            orderId: input.orderId,
            goodQuantity: input.goodQuantity,
            scrapQuantity: input.scrapQuantity,
          },
          () => service.planConfirmProduction(input),
        ),
      ),
    reverseDocument: (input) => reverseDocument(deps, input),
  }
}
