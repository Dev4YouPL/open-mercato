import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { INVENTORY_GATEWAY_FACTORY_DI_KEY, type InventoryGatewayFactory } from './ports/inventoryGateway'
import { INVENTORY_POLICY_READER_DI_KEY, type InventoryPolicyReader } from './ports/inventoryPolicyReader'
import { OPERATION_STORE_DI_KEY, type OperationStore } from './ports/operationStore'
import { createMikroOperationStore } from './data/operationStore'
import { createWmsInventoryGateway } from './adapters/wms/wmsInventoryGateway'
import { createWmsInventoryPolicyReader } from './adapters/wms/wmsInventoryPolicyReader'

export function register(container: AppContainer): void {
  container.register({
    [INVENTORY_GATEWAY_FACTORY_DI_KEY]: asFunction(
      ({ commandBus }: { commandBus: CommandBus }): InventoryGatewayFactory =>
        (ctx, organizationId) => createWmsInventoryGateway({ commandBus, ctx, organizationId }),
    ).scoped(),
    [INVENTORY_POLICY_READER_DI_KEY]: asFunction(
      ({ queryEngine }: { queryEngine: QueryEngine }): InventoryPolicyReader => createWmsInventoryPolicyReader({ queryEngine }),
    ).scoped(),
    [OPERATION_STORE_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): OperationStore => createMikroOperationStore({ em }),
    ).scoped(),
  })
}
