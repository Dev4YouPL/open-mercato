import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { INVENTORY_GATEWAY_FACTORY_DI_KEY, type InventoryGatewayFactory } from './ports/inventoryGateway'
import { INVENTORY_POLICY_READER_DI_KEY, type InventoryPolicyReader } from './ports/inventoryPolicyReader'
import { OPERATION_STORE_DI_KEY, type OperationStore } from './ports/operationStore'
import { EXECUTION_HISTORY_READER_DI_KEY, type ExecutionHistoryReader } from './ports/executionHistoryReader'
import { createMikroOperationStore } from './data/operationStore'
import { createMikroExecutionHistoryReader } from './data/executionHistoryReader'
import { PRODUCTION_ORDER_READER_DI_KEY, type ProductionOrderReader } from './ports/productionOrderReader'
import { PRODUCTION_ORDER_STORE_DI_KEY, type ProductionOrderStore } from './ports/productionOrderStore'
import { createMikroProductionOrderReader } from './data/productionOrderReader'
import { createMikroProductionOrderStore } from './data/productionOrderStore'
import { EXECUTION_CONTEXT_READER_DI_KEY, type ExecutionContextReader } from './ports/executionContextReader'
import { PRODUCTION_EXECUTION_STORE_DI_KEY, type ProductionExecutionStore } from './ports/productionExecutionStore'
import { createMikroExecutionContextReader } from './data/executionContextReader'
import { createMikroProductionExecutionStore } from './data/productionExecutionStore'
import { EXAMPLE_CATALOG_DI_KEY, type ExampleCatalog } from './ports/exampleCatalog'
import { BOM_REVISION_READER_DI_KEY, type BomRevisionReader } from './ports/bomRevisionReader'
import { createMikroBomRevisionReader } from './data/bomRevisionReader'
import { createCatalogExampleProducts } from './adapters/catalog/catalogExampleProducts'
import { createWmsInventoryGateway } from './adapters/wms/wmsInventoryGateway'
import { createWmsInventoryPolicyReader } from './adapters/wms/wmsInventoryPolicyReader'

export function register(container: AppContainer): void {
  container.register({
    [INVENTORY_GATEWAY_FACTORY_DI_KEY]: asFunction(
      ({ commandBus }: { commandBus: CommandBus }): InventoryGatewayFactory =>
        (ctx, organizationId) => createWmsInventoryGateway({ commandBus, ctx, organizationId }),
    ).scoped().proxy(),
    [EXAMPLE_CATALOG_DI_KEY]: asFunction(
      ({ commandBus, queryEngine }: { commandBus: CommandBus; queryEngine: QueryEngine }): ExampleCatalog =>
        createCatalogExampleProducts({ commandBus, queryEngine }),
    ).scoped().proxy(),
    [INVENTORY_POLICY_READER_DI_KEY]: asFunction(
      ({ queryEngine }: { queryEngine: QueryEngine }): InventoryPolicyReader => createWmsInventoryPolicyReader({ queryEngine }),
    ).scoped().proxy(),
    [OPERATION_STORE_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): OperationStore => createMikroOperationStore({ em }),
    ).scoped().proxy(),
    [EXECUTION_HISTORY_READER_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): ExecutionHistoryReader => createMikroExecutionHistoryReader({ em }),
    ).scoped().proxy(),
    [PRODUCTION_ORDER_READER_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): ProductionOrderReader => createMikroProductionOrderReader({ em }),
    ).scoped().proxy(),
    [PRODUCTION_ORDER_STORE_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): ProductionOrderStore => createMikroProductionOrderStore({ em }),
    ).scoped().proxy(),
    [PRODUCTION_EXECUTION_STORE_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): ProductionExecutionStore => createMikroProductionExecutionStore({ em }),
    ).scoped().proxy(),
    [BOM_REVISION_READER_DI_KEY]: asFunction(
      ({ em }: { em: EntityManager }): BomRevisionReader => createMikroBomRevisionReader({ em }),
    ).scoped().proxy(),
    [EXECUTION_CONTEXT_READER_DI_KEY]: asFunction(
      ({ em, manufacturingProductionOrderReader }: { em: EntityManager; manufacturingProductionOrderReader: ProductionOrderReader }): ExecutionContextReader =>
        createMikroExecutionContextReader({ em, productionOrderReader: manufacturingProductionOrderReader }),
    ).scoped().proxy(),
  })
}
