import { z } from 'zod'

export const CATALOG_VARIANTS_API_PATH = '/api/catalog/variants'
export const WMS_LOCATIONS_API_PATH = '/api/wms/locations'
export const REFERENCE_PAGE_SIZE = 100

const variantListSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string().nullish(), sku: z.string().nullish() })),
})

const locationListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      code: z.string().nullable().optional(),
      warehouse_code: z.string().nullable().optional(),
      warehouse_name: z.string().nullable().optional(),
    }),
  ),
})

export type ReferenceOption = { value: string; label: string }

export function toVariantLabels(response: unknown): Record<string, string> {
  const parsed = variantListSchema.safeParse(response)

  if (!parsed.success) return {}

  return Object.fromEntries(
    parsed.data.items.map((variant) => {
      const name = variant.name?.trim()
      const sku = variant.sku?.trim()
      const label = name && sku && name !== sku ? `${name} (${sku})` : name || sku || variant.id

      return [variant.id, label]
    }),
  )
}

export function toLocationLabels(response: unknown): Record<string, string> {
  const parsed = locationListSchema.safeParse(response)

  if (!parsed.success) return {}

  return Object.fromEntries(
    parsed.data.items.map((item) => {
      const warehouse = item.warehouse_code ?? item.warehouse_name
      const code = item.code ?? item.id

      return [item.id, warehouse ? `${warehouse} / ${code}` : code]
    }),
  )
}

export function toOptions(labels: Record<string, string>): ReferenceOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export function referenceIdsQuery(ids: string[]): string {
  return new URLSearchParams({ ids: ids.join(','), pageSize: String(REFERENCE_PAGE_SIZE) }).toString()
}
