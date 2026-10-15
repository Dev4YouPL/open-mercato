import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { INVENTORY_GATEWAY_FACTORY_DI_KEY, type InventoryGatewayFactory } from './ports/inventoryGateway'
import { createWmsInventoryGateway } from './adapters/wms/wmsInventoryGateway'

export function register(container: AppContainer): void {
  container.register({
    [INVENTORY_GATEWAY_FACTORY_DI_KEY]: asFunction(
      ({ commandBus }: { commandBus: CommandBus }): InventoryGatewayFactory =>
        (ctx, organizationId) => createWmsInventoryGateway({ commandBus, ctx, organizationId }),
    ).scoped(),
  })
}
