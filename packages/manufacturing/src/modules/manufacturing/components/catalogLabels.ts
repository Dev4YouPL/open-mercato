export type CatalogLabel = {
  productName: string | null
  variantName: string | null
  catalogState: "resolved" | "partial" | "missing"
}

export type CatalogTargetIds = { productId: string; variantId?: string | null }

export const missingCatalogLabel: CatalogLabel = {
  productName: null,
  variantName: null,
  catalogState: "missing",
}

export function parseCatalogLabel(value: unknown): CatalogLabel {
  if (!value || typeof value !== "object") return missingCatalogLabel
  const record = value as Record<string, unknown>
  const state = record.catalogState
  return {
    productName: typeof record.productName === "string" ? record.productName : null,
    variantName: typeof record.variantName === "string" ? record.variantName : null,
    catalogState: state === "resolved" || state === "partial" ? state : "missing",
  }
}

/**
 * Renders a Catalog target for display. A record Catalog could not resolve
 * stays readable by its raw ID (spec US-BOM-10) instead of disappearing.
 */
export function formatCatalogTarget(label: CatalogLabel, ids: CatalogTargetIds): string {
  const product = label.productName ?? ids.productId
  const variantId = ids.variantId ?? null
  if (!variantId) return product
  return `${product} / ${label.variantName ?? variantId}`
}
