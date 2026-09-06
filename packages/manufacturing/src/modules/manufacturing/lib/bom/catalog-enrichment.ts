import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

/**
 * Catalog is referenced by scalar ID only — Manufacturing declares no ORM
 * relation to it (see AGENTS.md "NO direct ORM relationships between modules").
 * Labels are read through the QueryEngine using the published entity ids.
 */
const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

export type BomCatalogState = 'resolved' | 'partial' | 'missing'

export type BomTargetLabel = {
  productName: string | null
  variantName: string | null
  catalogState: BomCatalogState
}

export type CatalogTargetRef = { productId: string; variantId?: string | null }

export type CatalogLabelIndex = {
  labelFor(target: CatalogTargetRef): BomTargetLabel
}

type ScopeParams = { tenantId: string; organizationId: string }

type Container = { resolve<T>(key: string): T }

const MISSING_LABEL: BomTargetLabel = { productName: null, variantName: null, catalogState: 'missing' }

function readLabel(row: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  if (!row) return null
  for (const key of keys) {
    const value = row[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length) return trimmed
  }
  return null
}

function distinct(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && value.length) seen.add(value)
  }
  return [...seen]
}

async function loadLabelMap(
  queryEngine: QueryEngine,
  entityId: string,
  ids: string[],
  fields: string[],
  scope: ScopeParams,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  if (!ids.length) return map
  const result = await queryEngine.query<Record<string, unknown>>(entityId, {
    fields,
    filters: { id: { $in: ids } },
    page: { page: 1, pageSize: ids.length },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  for (const item of result.items ?? []) {
    const id = typeof item.id === 'string' ? item.id : null
    if (id) map.set(id, item)
  }
  return map
}

/**
 * Batch-loads Catalog display labels for a page of BOM targets or component
 * lines in at most two scoped queries. Enrichment fails soft for reads (spec
 * "Read architecture"): on any Catalog failure every target reports
 * `catalogState:'missing'` and the caller keeps rendering raw IDs instead of
 * failing the request.
 */
export async function loadCatalogLabels(
  container: Container,
  scope: ScopeParams,
  targets: CatalogTargetRef[],
): Promise<CatalogLabelIndex> {
  const productIds = distinct(targets.map((target) => target.productId))
  const variantIds = distinct(targets.map((target) => target.variantId))
  if (!productIds.length && !variantIds.length) {
    return { labelFor: () => MISSING_LABEL }
  }

  let products = new Map<string, Record<string, unknown>>()
  let variants = new Map<string, Record<string, unknown>>()
  try {
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    ;[products, variants] = await Promise.all([
      loadLabelMap(queryEngine, PRODUCT_ENTITY_ID, productIds, ['id', 'title', 'sku'], scope),
      loadLabelMap(queryEngine, VARIANT_ENTITY_ID, variantIds, ['id', 'name', 'sku'], scope),
    ])
  } catch {
    return { labelFor: () => MISSING_LABEL }
  }

  return {
    labelFor(target: CatalogTargetRef): BomTargetLabel {
      const productName = readLabel(products.get(target.productId), 'title', 'sku')
      const variantId = target.variantId ?? null
      const variantName = variantId ? readLabel(variants.get(variantId), 'name', 'sku') : null
      const expected = variantId ? 2 : 1
      const resolved = (productName ? 1 : 0) + (variantId && variantName ? 1 : 0)
      const catalogState: BomCatalogState = resolved === expected ? 'resolved' : resolved === 0 ? 'missing' : 'partial'
      return { productName, variantName, catalogState }
    },
  }
}

export const missingCatalogLabel = MISSING_LABEL
