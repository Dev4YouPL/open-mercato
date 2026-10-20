import { z } from 'zod'

export const bomAvailabilityResponseSchema = z.object({
  id: z.string().uuid(),
  isAvailableForNewOrders: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
})

const availabilityErrorSchema = z.object({
  status: z.number().int(),
  code: z.string().optional(),
})

export function parseBomAvailabilityError(error: unknown) {
  if (typeof error !== 'object' || error === null) return null
  const record = error as Record<string, unknown>
  const body = typeof record.body === 'object' && record.body !== null
    ? record.body as Record<string, unknown>
    : record
  const parsed = availabilityErrorSchema.safeParse({ ...body, status: record.status })
  return parsed.success ? parsed.data : null
}
