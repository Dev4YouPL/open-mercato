"use client"

import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"
import { toUnitLookupKey } from "@open-mercato/shared/lib/units/unitCodes"
import type { LookupSelectItem } from "@open-mercato/ui/backend/inputs"

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

export async function loadProductOptions(query?: string): Promise<LookupSelectItem[]> {
  const params = new URLSearchParams({ pageSize: "8" })
  const term = query?.trim()
  if (term) params.set("search", term)
  const items = await fetchCatalogItems(`/api/catalog/products?${params.toString()}`)
  return items.map(toProductOption)
}

function toProductOption(item: Record<string, unknown>): LookupSelectItem {
  const id = String(item.id)
  const title = readTrimmedString(item, "title")
  const sku = readTrimmedString(item, "sku")
  return { id, title: title ?? sku ?? id, subtitle: title && sku ? sku : null }
}

function toVariantOption(item: Record<string, unknown>): LookupSelectItem {
  const id = String(item.id)
  const name = readTrimmedString(item, "name")
  const sku = readTrimmedString(item, "sku")
  return { id, title: name ?? sku ?? id, subtitle: name && sku ? sku : null }
}

export async function loadVariantOptions(productId: string, query?: string): Promise<LookupSelectItem[]> {
  if (!productId) return []
  const params = new URLSearchParams({ productId, pageSize: "50" })
  const term = query?.trim()
  if (term) params.set("search", term)
  const items = await fetchCatalogItems(`/api/catalog/variants?${params.toString()}`)
  return items.map(toVariantOption)
}

async function loadProductById(productId: string): Promise<LookupSelectItem | null> {
  const items = await fetchCatalogItems(`/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`)
  return items[0] ? toProductOption(items[0]) : null
}

async function loadVariantById(variantId: string): Promise<LookupSelectItem | null> {
  const items = await fetchCatalogItems(`/api/catalog/variants?id=${encodeURIComponent(variantId)}&pageSize=1`)
  return items[0] ? toVariantOption(items[0]) : null
}

/**
 * `LookupSelect` renders the selected chip from its own item list, so a value
 * restored from a saved record (the editor's current target) disappears unless
 * the fetcher keeps returning it. Both selection-aware loaders prepend the
 * current selection whenever the query result does not already contain it.
 */
async function withSelection(
  items: LookupSelectItem[],
  selectedId: string | null | undefined,
  loadById: (id: string) => Promise<LookupSelectItem | null>,
): Promise<LookupSelectItem[]> {
  if (!selectedId || items.some((item) => item.id === selectedId)) return items
  const selected = await loadById(selectedId)
  return selected ? [selected, ...items] : items
}

/**
 * With no query typed, a picker holding a saved value shows just that value —
 * the compact "current selection" chip. Typing switches to a real search that
 * still keeps the selection in the list so it never vanishes mid-edit.
 */
async function selectionOnly(
  selectedId: string | null | undefined,
  loadById: (id: string) => Promise<LookupSelectItem | null>,
): Promise<LookupSelectItem[] | null> {
  if (!selectedId) return null
  const selected = await loadById(selectedId)
  return selected ? [selected] : null
}

export async function loadProductOptionsWithSelection(
  query: string | undefined,
  selectedId: string | null | undefined,
): Promise<LookupSelectItem[]> {
  if (!query?.trim()) {
    const only = await selectionOnly(selectedId, loadProductById)
    if (only) return only
  }
  return withSelection(await loadProductOptions(query), selectedId, loadProductById)
}

export async function loadVariantOptionsWithSelection(
  productId: string | null,
  query: string | undefined,
  selectedId: string | null | undefined,
): Promise<LookupSelectItem[]> {
  if (!productId) return []
  if (!query?.trim()) {
    const only = await selectionOnly(selectedId, loadVariantById)
    if (only) return only
  }
  return withSelection(await loadVariantOptions(productId, query), selectedId, loadVariantById)
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
): Promise<LookupSelectItem[]> {
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
  return filtered.map((code) => ({ id: code, title: code }))
}
