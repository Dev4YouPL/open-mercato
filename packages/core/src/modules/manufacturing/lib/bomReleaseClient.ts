import { z } from 'zod'

import {
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'

import type { BomReleaseInput } from '../data/validators'

const PAGE_SIZE = 100

const releaseItemSchema = z.object({
  id: z.string().uuid(),
  bomId: z.string().uuid(),
  updatedAt: z.string().datetime({ offset: true }),
})

const releaseItemsPageSchema = z.object({
  items: z.array(releaseItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(PAGE_SIZE),
  totalPages: z.number().int().nonnegative(),
  totalIsCapped: z.boolean().optional(),
})

export const bomReleaseResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('released'),
  isIncomplete: z.boolean(),
})

export const bomReleaseTrackingViolationSchema = z.object({
  variantId: z.string().uuid(),
  role: z.enum(['output', 'component']),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  requirements: z.array(
    z.enum(['lot', 'serial', 'expiration']),
  ),
})

export type BomReleaseTrackingViolation =
  z.infer<typeof bomReleaseTrackingViolationSchema>

const releaseErrorSchema = z.object({
  status: z.number().int(),
  code: z.string().optional(),
  violations: z.array(
    bomReleaseTrackingViolationSchema,
  ).optional(),
})

export function parseBomReleaseError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const record = error as Record<string, unknown>

  const body =
    typeof record.body === 'object' && record.body !== null
      ? record.body as Record<string, unknown>
      : record

  const parsed = releaseErrorSchema.safeParse({
    ...body,
    status: record.status,
  })

  return parsed.success ? parsed.data : null
}

export async function loadAllBomReleaseItems(
  bomId: string,
  errorMessage: string,
  signal?: AbortSignal,
): Promise<BomReleaseInput['expectedItems']> {
  const expectedItems: BomReleaseInput['expectedItems'] = []
  const seenIds = new Set<string>()

  let requestedPage = 1
  let pageCount = 1
  let expectedTotal: number | null = null

  while (requestedPage <= pageCount) {
    const params = new URLSearchParams({
      bomId,
      page: String(requestedPage),
      pageSize: String(PAGE_SIZE),
      sortField: 'id',
      sortDir: 'asc',
    })

    const payload = await readApiResultOrThrow<unknown>(
      `/api/manufacturing/bom-items?${params.toString()}`,
      { signal },
      { errorMessage },
    )

    const data = releaseItemsPageSchema.parse(payload)

    if (
      data.totalIsCapped ||
      data.page !== requestedPage ||
      data.pageSize !== PAGE_SIZE
    ) {
      throw new Error('[internal] Invalid BOM release pagination')
    }

    if (expectedTotal === null) {
      expectedTotal = data.total
      pageCount = Math.max(1, data.totalPages)
    } else if (
      data.total !== expectedTotal ||
      Math.max(1, data.totalPages) !== pageCount
    ) {
      throw new Error('[internal] BOM items changed while loading')
    }

    for (const item of data.items) {
      const normalizedId = item.id.toLowerCase()

      if (
        item.bomId.toLowerCase() !== bomId.toLowerCase() ||
        seenIds.has(normalizedId)
      ) {
        throw new Error('[internal] Invalid BOM release item set')
      }

      seenIds.add(normalizedId)

      expectedItems.push({
        id: item.id,
        updatedAt: item.updatedAt,
      })
    }

    requestedPage += 1
  }

  if (expectedItems.length !== expectedTotal) {
    throw new Error('[internal] Incomplete BOM release item set')
  }

  return expectedItems
}