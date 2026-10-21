import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createProductionInventoryService } from '../application/productionInventoryService'
import { createProductionOperations, type ProductionOperations } from '../application/productionOperations'
import { resolveExecutionContextReader } from '../ports/executionContextReader'
import { resolveExecutionHistoryReader } from '../ports/executionHistoryReader'
import { resolveInventoryGatewayFactory } from '../ports/inventoryGateway'
import { resolveInventoryPolicyReader } from '../ports/inventoryPolicyReader'
import { resolveOperationStore } from '../ports/operationStore'
import type { ManufacturingActor } from './manufacturingActor'

export function buildProductionOperations(ctx: CommandRuntimeContext, actor: ManufacturingActor): ProductionOperations {
  const { container } = ctx
  const inventoryService = createProductionInventoryService({
    inventoryGateway: resolveInventoryGatewayFactory(container)(ctx, actor.scope.organizationId),
    inventoryPolicyReader: resolveInventoryPolicyReader(container),
    executionContextReader: resolveExecutionContextReader(container),
    scope: actor.scope,
  })

  return createProductionOperations({
    operationStore: resolveOperationStore(container),
    inventoryService,
    executionHistoryReader: resolveExecutionHistoryReader(container),
    scope: actor.scope,
    userId: actor.userId,
  })
}
