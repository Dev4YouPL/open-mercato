import { buildExecutionDocument } from '../domain/executionDocument'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import {
  decideOnExistingOperation,
  hashOperationPayload,
  type FinalOperationOutcome,
  type OperationAction,
  type OperationOutcome,
  type OperationRecord,
} from '../domain/operation'
import type { InventoryMovementResultDto } from '../ports/inventoryGateway'
import type { OperationStore } from '../ports/operationStore'
import type {
  MaterialMovementInput,
  MovementPlanResultDto,
  MovementReversalInput,
  OutputMovementInput,
  ProductionInventoryService,
} from './productionInventoryService'

export type WithOperationId<TInput> = TInput & { operationId: string }

export type ProductionOperationResultDto =
  | InventoryMovementResultDto
  | { status: 'blocked'; blockingOperationId: string }

export interface ProductionOperations {
  issueMaterial(input: WithOperationId<MaterialMovementInput>): Promise<ProductionOperationResultDto>
  returnMaterial(input: WithOperationId<MaterialMovementInput>): Promise<ProductionOperationResultDto>
  receiveOutput(input: WithOperationId<OutputMovementInput>): Promise<ProductionOperationResultDto>
  reverseMaterialIssue(input: WithOperationId<MovementReversalInput>): Promise<ProductionOperationResultDto>
  reverseMaterialReturn(input: WithOperationId<MovementReversalInput>): Promise<ProductionOperationResultDto>
  reverseOutputReceipt(input: WithOperationId<MovementReversalInput>): Promise<ProductionOperationResultDto>
}

type ProductionOperationsDeps = {
  operationStore: OperationStore
  inventoryService: ProductionInventoryService
  scope: ManufacturingScope
  userId: string
}

type OperationRequest = {
  action: OperationAction
  operationId: string
  orderId: string
  payloadHash: string
  plan: () => Promise<MovementPlanResultDto>
}

type AnyMovementInput = WithOperationId<OutputMovementInput & Partial<MovementReversalInput>>

function buildRequest(
  action: OperationAction,
  input: AnyMovementInput,
  plan: () => Promise<MovementPlanResultDto>,
): OperationRequest {
  const payloadHash = hashOperationPayload({
    action,
    orderId: input.orderId,
    variantId: input.variantId ?? null,
    warehouseId: input.warehouseId ?? null,
    locationId: input.locationId ?? null,
    quantity: input.quantity,
  })

  return { action, operationId: input.operationId, orderId: input.orderId, payloadHash, plan }
}

function toOutcome(result: InventoryMovementResultDto): OperationOutcome {
  switch (result.status) {
    case 'accepted':
      return { status: 'completed', movementId: result.movementId }
    case 'rejected':
      return { status: 'rejected', code: result.code, message: result.message }
    case 'unknown':
      return { status: 'unknown' }
  }
}

function toReplayResult(outcome: FinalOperationOutcome): InventoryMovementResultDto {
  if (outcome.status === 'completed') return { status: 'accepted', movementId: outcome.movementId }
  return { status: 'rejected', code: outcome.code, message: outcome.message }
}

function toOperationRecord(deps: ProductionOperationsDeps, request: OperationRequest, plan: MovementPlanResultDto): OperationRecord {
  const base = {
    operationId: request.operationId,
    action: request.action,
    orderId: request.orderId,
    payloadHash: request.payloadHash,
    requestedBy: deps.userId,
  }

  if (plan.status === 'rejected') {
    return { ...base, movement: null, state: { status: 'rejected', code: plan.code, message: plan.message } }
  }

  return { ...base, movement: plan.movement, state: { status: 'in_progress' } }
}

async function postAndRecord(deps: ProductionOperationsDeps, operation: OperationRecord): Promise<InventoryMovementResultDto> {
  const movement = operation.movement

  if (!movement) throw new Error(`[internal] manufacturing operation ${operation.operationId} has no planned movement`)

  const result = await deps.inventoryService.postMovement(operation.operationId, movement)
  const document =
    result.status === 'accepted'
      ? buildExecutionDocument({
          action: operation.action,
          orderId: operation.orderId,
          operationId: operation.operationId,
          postedBy: operation.requestedBy,
          movement,
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

export function createProductionOperations(deps: ProductionOperationsDeps): ProductionOperations {
  const service = deps.inventoryService

  return {
    issueMaterial: (input) =>
      runOperation(deps, buildRequest('issueMaterial', input, () => service.planIssueMaterial(input))),
    returnMaterial: (input) =>
      runOperation(deps, buildRequest('returnMaterial', input, () => service.planReturnMaterial(input))),
    receiveOutput: (input) =>
      runOperation(deps, buildRequest('receiveOutput', input, () => service.planReceiveOutput(input))),
    reverseMaterialIssue: (input) =>
      runOperation(deps, buildRequest('reverseMaterialIssue', input, () => service.planReverseMaterialIssue(input))),
    reverseMaterialReturn: (input) =>
      runOperation(deps, buildRequest('reverseMaterialReturn', input, () => service.planReverseMaterialReturn(input))),
    reverseOutputReceipt: (input) =>
      runOperation(deps, buildRequest('reverseOutputReceipt', input, () => service.planReverseOutputReceipt(input))),
  }
}
