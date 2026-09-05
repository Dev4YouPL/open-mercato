import { apiCall } from "@open-mercato/ui/backend/utils/apiCall"

export const RESOURCE_PAGE_SIZE = 50
export const RESOURCE_HYDRATE_PAGE_SIZE = 100

export type ResourceOption = {
  id: string
  name: string
  isActive: boolean
  /** True when the id is stored but the provider returned no record for it. */
  unresolved: boolean
}

type ResourceApiItem = {
  id?: unknown
  name?: unknown
  is_active?: unknown
}

type ResourceApiResponse = {
  items?: ResourceApiItem[]
  total?: unknown
}

export type ResourcePage = {
  options: ResourceOption[]
  total: number
  hasMore: boolean
}

function mapItem(item: ResourceApiItem): ResourceOption | null {
  if (typeof item?.id !== "string" || item.id.length === 0) return null
  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.length > 0 ? item.name : item.id,
    isActive: item.is_active !== false,
    unresolved: false,
  }
}

/**
 * Reads the resources module through its own public API — never a cross-module
 * ORM entity — and always with an explicit page and pageSize, so a resource
 * beyond the first page stays discoverable.
 */
export async function loadResourceCandidates(
  search: string,
  page: number,
  signal?: AbortSignal,
): Promise<ResourcePage> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(RESOURCE_PAGE_SIZE),
    isActive: "true",
  })
  const term = search.trim()
  if (term.length > 0) params.set("search", term)
  const response = await apiCall<ResourceApiResponse>(`/api/resources/resources?${params.toString()}`, { signal })
  if (!response.ok) throw new Error("[internal] resource_candidates_failed")
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const options = items.map(mapItem).filter((option): option is ResourceOption => option !== null)
  const total = typeof response.result?.total === "number" ? response.result.total : options.length
  return { options, total, hasMore: page * RESOURCE_PAGE_SIZE < total }
}

/**
 * Hydrates the stored selection by id, deliberately without `search` or
 * `isActive`: a selected resource that is inactive, or absent from the current
 * candidate page, must still render with its real name. Membership is capped at
 * 100, so one bounded page covers any stored set.
 *
 * Ids the provider does not return stay selected as opaque unresolved options —
 * a soft-deleted resource must never be silently dropped from the set, and this
 * never retries with `withDeleted` to recover a hidden record.
 */
export async function hydrateSelectedResources(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<ResourceOption[]> {
  if (ids.length === 0) return []
  const params = new URLSearchParams({
    ids: ids.join(","),
    pageSize: String(RESOURCE_HYDRATE_PAGE_SIZE),
  })
  const response = await apiCall<ResourceApiResponse>(`/api/resources/resources?${params.toString()}`, { signal })
  if (!response.ok) throw new Error("[internal] resource_hydration_failed")
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const byId = new Map<string, ResourceOption>()
  for (const item of items) {
    const option = mapItem(item)
    if (option) byId.set(option.id, option)
  }
  return ids.map((id) => byId.get(id) ?? { id, name: id, isActive: false, unresolved: true })
}

/** Merges hydrated and candidate options by id without touching form values. */
export function mergeResourceOptions(
  existing: readonly ResourceOption[],
  incoming: readonly ResourceOption[],
): ResourceOption[] {
  const byId = new Map<string, ResourceOption>()
  for (const option of existing) byId.set(option.id, option)
  for (const option of incoming) {
    const current = byId.get(option.id)
    // A resolved record always wins over a placeholder for the same id.
    if (!current || current.unresolved) byId.set(option.id, option)
  }
  return Array.from(byId.values())
}

export function sortResourceIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.length > 0))).sort()
}
