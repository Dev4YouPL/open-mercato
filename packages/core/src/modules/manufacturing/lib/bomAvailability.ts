import { z } from 'zod'

import { isBomStatusUsableInOrder } from '../data/bomStatus'
import type { ManufacturingBomStatus } from '../data/bomStatus'

export const bomAvailabilityReasonSchema = z.enum([
  'draft',
  'variantMissing',
  'variantInactive',
])

export const bomAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
  reason: bomAvailabilityReasonSchema.nullable(),
})

export type BomAvailability = z.infer<typeof bomAvailabilitySchema>

export type BomAvailabilityVariant = {
  isActive: boolean
  isDeleted: boolean
}

export function resolveBomAvailability(
  bom: { status: ManufacturingBomStatus },
  variant: BomAvailabilityVariant | null,
): BomAvailability {
  if (!isBomStatusUsableInOrder(bom.status)) {
    return { isAvailable: false, reason: 'draft' }
  }

  if (!variant || variant.isDeleted) {
    return { isAvailable: false, reason: 'variantMissing' }
  }

  if (!variant.isActive) {
    return { isAvailable: false, reason: 'variantInactive' }
  }

  return { isAvailable: true, reason: null }
}
