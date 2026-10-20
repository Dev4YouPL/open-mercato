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
  OutputMovementInput,
  ProductionInventoryService,
} from './productionInventoryService'

export type ProductionOperationResultDto =
  | InventoryMovementResultDto
  | { status: 'blocked'; blockingOperationId: string }

export interface ProductionOperations {
  issueMaterial(input: MaterialMovementInput): Promise<ProductionOperationResultDto>
  returnMaterial(input: MaterialMovementInput): Promise<ProductionOperationResultDto>
  receiveOutput(input: OutputMovementInput): Promise<ProductionOperationResultDto>
  reverseMaterialIssue(input: MaterialMovementInput): Promise<ProductionOperationResultDto>
  reverseMaterialReturn(input: MaterialMovementInput): Promise<ProductionOperationResultDto>
  reverseOutputReceipt(input: OutputMovementInput): Promise<ProductionOperationResultDto>
}

type ProductionOperationsDeps = {
  operationStore: OperationStore
  inventoryService: ProductionInventoryService
  scope: ManufacturingScope
}

type OperationRequest = {
  action: OperationAction
  input: OutputMovementInput
  payloadHash: string
  perform: () => Promise<InventoryMovementResultDto>
}

function buildRequest(
  action: OperationAction,
  input: OutputMovementInput,
  variantId: string | null,
  perform: () => Promise<InventoryMovementResultDto>,
): OperationRequest {
  const payloadHash = hashOperationPayload({
    action,
    orderId: input.orderId,
    variantId,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    quantity: input.quantity,
  })

  return { action, input, payloadHash, perform }
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

async function performAndRecord(deps: ProductionOperationsDeps, request: OperationRequest): Promise<InventoryMovementResultDto> {
  const result = await request.perform()
  const resolved = await deps.operationStore.resolveIfUnresolved(request.input.operationId, toOutcome(result), deps.scope)

  if (resolved) return result

  const current = await deps.operationStore.find(request.input.operationId, deps.scope)
  const decision = current ? decideOnExistingOperation(current, request.payloadHash) : null

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
      return performAndRecord(deps, request)
  }
}

async function runOperation(deps: ProductionOperationsDeps, request: OperationRequest): Promise<ProductionOperationResultDto> {
  const { operationId, orderId } = request.input
  const existing = await deps.operationStore.find(operationId, deps.scope)

  if (existing) return continueExisting(deps, request, existing)

  const insertion = await deps.operationStore.insertInProgress(
    { operationId, action: request.action, orderId, payloadHash: request.payloadHash },
    deps.scope,
  )

  if (insertion === 'inserted') return performAndRecord(deps, request)

  const raced = await deps.operationStore.find(operationId, deps.scope)

  if (raced) return continueExisting(deps, request, raced)

  const blocking = await deps.operationStore.findUnresolved(orderId, request.action, deps.scope)

  if (blocking) return { status: 'blocked', blockingOperationId: blocking.operationId }

  return runOperation(deps, request)
}

export function createProductionOperations(deps: ProductionOperationsDeps): ProductionOperations {
  const service = deps.inventoryService

  return {
    issueMaterial: (input) =>
      runOperation(deps, buildRequest('issueMaterial', input, input.variantId, () => service.issueMaterial(input))),
    returnMaterial: (input) =>
      runOperation(deps, buildRequest('returnMaterial', input, input.variantId, () => service.returnMaterial(input))),
    receiveOutput: (input) =>
      runOperation(deps, buildRequest('receiveOutput', input, null, () => service.receiveOutput(input))),
    reverseMaterialIssue: (input) =>
      runOperation(deps, buildRequest('reverseMaterialIssue', input, input.variantId, () => service.reverseMaterialIssue(input))),
    reverseMaterialReturn: (input) =>
      runOperation(deps, buildRequest('reverseMaterialReturn', input, input.variantId, () => service.reverseMaterialReturn(input))),
    reverseOutputReceipt: (input) =>
      runOperation(deps, buildRequest('reverseOutputReceipt', input, null, () => service.reverseOutputReceipt(input))),
  }
}
