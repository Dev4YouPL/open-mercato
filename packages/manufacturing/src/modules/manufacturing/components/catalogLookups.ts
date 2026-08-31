"use client"

import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { toUnitLookupKey } from "@open-mercato/shared/lib/units/unitCodes"
import type { ComboboxOption } from "@open-mercato/ui/backend/inputs"

type CatalogListResponse = { items?: Array<Record<string, unknown>> }

function readTrimmedString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function fetchCatalogItems(url: string): Promise<Array<Record<string, unknown>>> {
  const response = await apiCall<CatalogListResponse>(url, undefined, { fallback: { items: [] } })
  const items = response.result?.items
  return Array.isArray(items) ? items : []
}

/**
 * Catalog pickers render as compact comboboxes: one line of label plus the SKU
 * as a secondary description. They deliberately carry no product imagery — a
 * BOM author scans hundreds of component rows, and a thumbnail per option
 * turns a searchable list into a scrolling gallery.
 */
function toProductOption(item: Record<string, unknown>): ComboboxOption {
  const id = String(item.id)
  const title = readTrimmedString(item, "title")
  const sku = readTrimmedString(item, "sku")
  return { value: id, label: title ?? sku ?? id, description: title && sku ? sku : null }
}

function toVariantOption(item: Record<string, unknown>): ComboboxOption {
  const id = String(item.id)
  const name = readTrimmedString(item, "name")
  const sku = readTrimmedString(item, "sku")
  return { value: id, label: name ?? sku ?? id, description: name && sku ? sku : null }
}

export async function loadProductOptions(query?: string): Promise<ComboboxOption[]> {
  const params = new URLSearchParams({ pageSize: "20" })
  const term = query?.trim()
  if (term) params.set("search", term)
  const items = await fetchCatalogItems(`/api/catalog/products?${params.toString()}`)
  return items.map(toProductOption)
}

export async function loadVariantOptions(productId: string, query?: string): Promise<ComboboxOption[]> {
  if (!productId) return []
  const params = new URLSearchParams({ productId, pageSize: "50" })
  const term = query?.trim()
  if (term) params.set("search", term)
  const items = await fetchCatalogItems(`/api/catalog/variants?${params.toString()}`)
  return items.map(toVariantOption)
}

/**
 * The list filter narrows by one variant without first pinning its product, so
 * it searches the whole Catalog variant space. Product scoping stays inside the
 * authoring forms, where the product is already chosen.
 */
export async function loadVariantFilterOptions(query?: string): Promise<ComboboxOption[]> {
  const params = new URLSearchParams({ pageSize: "20" })
  const term = query?.trim()
  if (term) params.set("search", term)
  const items = await fetchCatalogItems(`/api/catalog/variants?${params.toString()}`)
  return items.map(toVariantOption)
}

async function loadProductById(productId: string): Promise<ComboboxOption | null> {
  const items = await fetchCatalogItems(`/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`)
  return items[0] ? toProductOption(items[0]) : null
}

async function loadVariantById(variantId: string): Promise<ComboboxOption | null> {
  const items = await fetchCatalogItems(`/api/catalog/variants?id=${encodeURIComponent(variantId)}&pageSize=1`)
  return items[0] ? toVariantOption(items[0]) : null
}

/**
 * A combobox holding a saved id renders that raw id until the label is
 * resolved, so both authoring forms and the filter chips resolve eagerly and
 * fall back to the id when Catalog no longer knows the record (US-BOM-10).
 */
export async function resolveProductLabel(productId: string): Promise<string> {
  if (!productId) return productId
  const option = await loadProductById(productId).catch(() => null)
  return option?.label ?? productId
}

export async function resolveVariantLabel(variantId: string): Promise<string> {
  if (!variantId) return variantId
  const option = await loadVariantById(variantId).catch(() => null)
  return option?.label ?? variantId
}

export async function loadProductDefaultUnitCode(productId: string): Promise<string | null> {
  if (!productId) return null
  const items = await fetchCatalogItems(
    `/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`,
  )
  const product = items[0]
  return product ? readTrimmedString(product, "default_unit") : null
}

async function loadProductConversionUnitCodes(productId: string): Promise<string[]> {
  const items = await fetchCatalogItems(
    `/api/catalog/product-unit-conversions?productId=${encodeURIComponent(productId)}&pageSize=100&isActive=true`,
  )
  return items
    .map((item) => readTrimmedString(item, "unit_code") ?? readTrimmedString(item, "unitCode"))
    .filter((code): code is string => Boolean(code))
}

/**
 * Base and conversion units a BOM quantity may be entered in, for one product.
 * The product's own base unit comes first; conversions follow in Catalog order.
 * Anything outside this set is rejected by Catalog normalization as
 * `uom.unit_not_found`, so the picker must never accept free text.
 */
export async function loadProductUnitOptions(
  productId: string | null,
  query?: string,
): Promise<ComboboxOption[]> {
  if (!productId) return []
  const [defaultUnitCode, conversionUnitCodes] = await Promise.all([
    loadProductDefaultUnitCode(productId),
    loadProductConversionUnitCodes(productId),
  ])
  const seen = new Set<string>()
  const codes: string[] = []
  for (const code of [defaultUnitCode, ...conversionUnitCodes]) {
    if (!code) continue
    const key = toUnitLookupKey(code)
    if (!key || seen.has(key)) continue
    seen.add(key)
    codes.push(code)
  }
  const term = query?.trim().toLowerCase()
  const filtered = term ? codes.filter((code) => code.toLowerCase().includes(term)) : codes
  return filtered.map((code) => ({ value: code, label: code }))
}
