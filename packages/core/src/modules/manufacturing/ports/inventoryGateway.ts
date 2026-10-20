import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { MovementKind, PlannedMovement } from '../domain/movement'

export const INVENTORY_GATEWAY_FACTORY_DI_KEY = 'manufacturingInventoryGatewayFactory'

export type InventoryMovementKind = MovementKind

export type InventoryMovementRequestDto = PlannedMovement & {
  operationId: string
}

export type InventoryMovementResultDto =
  | { status: 'accepted'; movementId: string }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'unknown'; cause: unknown }

export interface InventoryGateway {
  postMovement(request: InventoryMovementRequestDto): Promise<InventoryMovementResultDto>
}

export type InventoryGatewayFactory = (ctx: CommandRuntimeContext, organizationId: string) => InventoryGateway

export function resolveInventoryGatewayFactory(container: AwilixContainer): InventoryGatewayFactory {
  return container.resolve<InventoryGatewayFactory>(INVENTORY_GATEWAY_FACTORY_DI_KEY)
}
