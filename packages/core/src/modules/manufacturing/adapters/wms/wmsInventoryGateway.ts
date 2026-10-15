import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { resolveManufacturingActor, type ManufacturingActor } from '../../lib/manufacturingActor'
import type {
  InventoryGateway,
  InventoryMovementRequestDto,
  InventoryMovementResultDto,
} from '../../ports/inventoryGateway'
import { mapWmsError } from './wmsErrorMapping'

export const WMS_ADJUST_COMMAND_ID = 'wms.inventory.adjust'
export const WMS_RECEIVE_COMMAND_ID = 'wms.inventory.receive'
export const WMS_MANUFACTURING_REFERENCE_TYPE = 'manual'
export const MANUFACTURING_MOVEMENT_SOURCE = 'manufacturing'

type WmsCommand = {
  commandId: string
  input: Record<string, unknown>
}

type WmsMovementResult = {
  movementId?: unknown
}

export function buildWmsCommand(request: InventoryMovementRequestDto, actor: ManufacturingActor): WmsCommand {
  const reason = `${MANUFACTURING_MOVEMENT_SOURCE}:${request.kind}`
  const common = {
    tenantId: actor.scope.tenantId,
    organizationId: actor.scope.organizationId,
    warehouseId: request.warehouseId,
    locationId: request.locationId,
    catalogVariantId: request.variantId,
    referenceType: WMS_MANUFACTURING_REFERENCE_TYPE,
    referenceId: request.operationId,
    performedBy: actor.userId,
    reason,
    metadata: {
      source: MANUFACTURING_MOVEMENT_SOURCE,
      operationId: request.operationId,
      movementKind: request.kind,
    },
  }

  if (request.kind === 'receiveOutput') {
    return { commandId: WMS_RECEIVE_COMMAND_ID, input: { ...common, quantity: request.quantity } }
  }
  
  const delta = request.kind === 'consume' ? -request.quantity : request.quantity
  
  return { commandId: WMS_ADJUST_COMMAND_ID, input: { ...common, delta, reasonCode: reason } }
}

async function isRegisteredCommand(commandId: string): Promise<boolean> {
  return Boolean(commandRegistry.get(commandId) ?? (await commandRegistry.load(commandId)))
}

type WmsGatewayDeps = {
  commandBus: CommandBus
  ctx: CommandRuntimeContext
  actor: ManufacturingActor
  isCommandAvailable: (commandId: string) => Promise<boolean>
}

async function postWmsMovement(
  deps: WmsGatewayDeps,
  request: InventoryMovementRequestDto,
): Promise<InventoryMovementResultDto> {
  const { commandId, input } = buildWmsCommand(request, deps.actor)
  
  if (!(await deps.isCommandAvailable(commandId))) {
    return { status: 'rejected', code: 'inventory_unavailable', message: `${commandId} is not registered; is the WMS module enabled?` }
  }
  
  try {
    const { result } = await deps.commandBus.execute<Record<string, unknown>, WmsMovementResult>(commandId, {
      input,
      ctx: deps.ctx,
    })
    
    if (typeof result?.movementId !== 'string') {
      return { status: 'unknown', cause: new Error(`[internal] ${commandId} returned no movementId`) }
    }
    
    return { status: 'accepted', movementId: result.movementId }
  } catch (error) {
    return mapWmsError(error)
  }
}

export function createWmsInventoryGateway(options: {
  commandBus: CommandBus
  ctx: CommandRuntimeContext
  organizationId: string
  isCommandAvailable?: (commandId: string) => Promise<boolean>
}): InventoryGateway {
  const deps: WmsGatewayDeps = {
    commandBus: options.commandBus,
    ctx: options.ctx,
    actor: resolveManufacturingActor(options.ctx, options.organizationId),
    isCommandAvailable: options.isCommandAvailable ?? isRegisteredCommand,
  }
  
  return {
    postMovement: (request) => postWmsMovement(deps, request),
  }
}
