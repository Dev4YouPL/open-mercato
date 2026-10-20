import type { SortingState } from '@tanstack/react-table'
import { z } from 'zod'

import { bomListItemSchema, bomListResponseSchema } from '../api/openapi'

export type BomListItem = z.infer<typeof bomListItemSchema>

export const bomListStatusFilterSchema = z.enum([
  'draft',
  'released',
  'incomplete',
])

export type BomListStatusFilter = z.infer<typeof bomListStatusFilterSchema>

const SORTABLE_COLUMNS = new Set([
  'revision',
  'status',
  'createdAt',
  'updatedAt',
])

// createPagedListResponseSchema erases the item type, so narrow it back here.
const typedBomListResponseSchema = bomListResponseSchema.extend({
  items: z.array(bomListItemSchema),
})

export function buildBomListSearchParams(input: {
  page: number
  pageSize: number
  search: string
  status: BomListStatusFilter | null
  sorting: SortingState
}): URLSearchParams {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  })

  const search = input.search.trim()

  if (search) {
    params.set('search', search)
  }

  if (input.status === 'incomplete') {
    params.set('status', 'released')
    params.set('isIncomplete', 'true')
  } else if (input.status) {
    params.set('status', input.status)
  }

  const sort = input.sorting[0]

  if (sort && SORTABLE_COLUMNS.has(sort.id)) {
    params.set('sortField', sort.id)
    params.set('sortDir', sort.desc ? 'desc' : 'asc')
  }

  return params
}

export function parseBomListStatusFilter(
  value: unknown,
): BomListStatusFilter | null {
  const parsed = bomListStatusFilterSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function parseBomListResponse(payload: unknown) {
  return typedBomListResponseSchema.safeParse(payload)
}
