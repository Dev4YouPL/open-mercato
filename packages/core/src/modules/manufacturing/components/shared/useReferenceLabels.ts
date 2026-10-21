'use client'

import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  CATALOG_VARIANTS_API_PATH,
  referenceIdsQuery,
  toLocationLabels,
  toOptions,
  toVariantLabels,
  WMS_LOCATIONS_API_PATH,
  type ReferenceOption,
} from './referenceLabels'

function distinct(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
}

function useLabels(kind: string, path: string, ids: Array<string | null | undefined>, parse: (response: unknown) => Record<string, string>) {
  const scopeVersion = useOrganizationScopeVersion()
  const wanted = distinct(ids)

  const query = useQuery({
    queryKey: ['manufacturing-reference-labels', kind, wanted.join(','), scopeVersion],
    enabled: wanted.length > 0,
    queryFn: async () => {
      const call = await apiCall<unknown>(`${path}?${referenceIdsQuery(wanted)}`)
      return call.ok ? parse(call.result) : {}
    },
  })

  return query.data ?? {}
}

export function useVariantLabels(ids: Array<string | null | undefined>): Record<string, string> {
  return useLabels('variants', CATALOG_VARIANTS_API_PATH, ids, toVariantLabels)
}

export function useLocationLabels(ids: Array<string | null | undefined>): Record<string, string> {
  return useLabels('locations', WMS_LOCATIONS_API_PATH, ids, toLocationLabels)
}

export async function searchVariantOptions(query?: string): Promise<ReferenceOption[]> {
  const params = new URLSearchParams({ pageSize: '20' })
  if (query?.trim()) params.set('search', query.trim())
  const call = await apiCall<unknown>(`${CATALOG_VARIANTS_API_PATH}?${params.toString()}`)
  return call.ok ? toOptions(toVariantLabels(call.result)) : []
}

export async function loadActiveLocationOptions(): Promise<ReferenceOption[]> {
  const params = new URLSearchParams({ isActive: 'true', pageSize: '100' })
  const call = await apiCall<unknown>(`${WMS_LOCATIONS_API_PATH}?${params.toString()}`)
  return call.ok ? toOptions(toLocationLabels(call.result)) : []
}
