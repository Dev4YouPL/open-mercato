import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { ManufacturingScope } from '../../domain/manufacturingScope'
import type { ExampleCatalog, ExampleProductSpec } from '../../ports/exampleCatalog'

export const CATALOG_VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'
export const CATALOG_CREATE_PRODUCT_COMMAND_ID = 'catalog.products.create'
export const CATALOG_CREATE_VARIANT_COMMAND_ID = 'catalog.variants.create'

const variantRowSchema = z.object({ id: z.string(), sku: z.string() })
const productResultSchema = z.object({ productId: z.string() })
const variantResultSchema = z.object({ variantId: z.string() })

type CatalogExampleDeps = {
  commandBus: CommandBus
  queryEngine: QueryEngine
}

async function findExistingVariants(
  deps: CatalogExampleDeps,
  skus: string[],
  scope: ManufacturingScope,
): Promise<Map<string, string>> {
  const result = await deps.queryEngine.query<unknown>(CATALOG_VARIANT_ENTITY_ID, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { sku: { $in: skus } },
    fields: ['id', 'sku'],
    page: { page: 1, pageSize: 100 },
  })

  return new Map(
    result.items
      .map((row) => variantRowSchema.safeParse(row))
      .filter((parsed) => parsed.success)
      .map((parsed) => [parsed.data.sku, parsed.data.id]),
  )
}

async function createProductWithVariant(
  deps: CatalogExampleDeps,
  spec: ExampleProductSpec,
  ctx: CommandRuntimeContext,
  scope: ManufacturingScope,
): Promise<string> {
  const product = await deps.commandBus.execute(CATALOG_CREATE_PRODUCT_COMMAND_ID, {
    input: { ...scope, title: spec.title },
    ctx,
  })
  const { productId } = productResultSchema.parse(product.result)
  const variant = await deps.commandBus.execute(CATALOG_CREATE_VARIANT_COMMAND_ID, {
    input: { ...scope, productId, sku: spec.sku, name: spec.title, isDefault: true, isActive: true },
    ctx,
  })

  return variantResultSchema.parse(variant.result).variantId
}

export function createCatalogExampleProducts(deps: CatalogExampleDeps): ExampleCatalog {
  return {
    async ensureVariants(specs, ctx, scope) {
      const variants = await findExistingVariants(deps, specs.map((spec) => spec.sku), scope)

      for (const spec of specs) {
        if (!variants.has(spec.sku)) variants.set(spec.sku, await createProductWithVariant(deps, spec, ctx, scope))
      }

      return variants
    },
  }
}
