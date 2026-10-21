import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export const EXAMPLE_CATALOG_DI_KEY = 'manufacturingExampleCatalog'

export type ExampleProductSpec = {
  sku: string
  title: string
}

export interface ExampleCatalog {
  ensureVariants(specs: ExampleProductSpec[], ctx: CommandRuntimeContext, scope: ManufacturingScope): Promise<Map<string, string>>
}

export function resolveExampleCatalog(container: AwilixContainer): ExampleCatalog {
  return container.resolve<ExampleCatalog>(EXAMPLE_CATALOG_DI_KEY)
}
