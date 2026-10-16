import type { AwilixContainer } from 'awilix'
import { z } from 'zod'

import { E } from '#generated/entities.ids.generated'

import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

import type { BomScope } from './bomValidation'

export type TrackingPolicy = {
  requiresLot: boolean
  requiresSerial: boolean
  requiresExpiration: boolean
}

export type VariantTrackingProfile = {
  trackLot: boolean
  trackSerial: boolean
  trackExpiration: boolean
}

const trackingFlagSchema = z
  .union([
    z.boolean(),
    z.string(),
    z.number(),
  ])
  .nullish()

const trackingProfileRowSchema = z.object({
  id: z.string().uuid(),
  catalog_variant_id: z.string().uuid().nullable(),
  track_lot: trackingFlagSchema,
  track_serial: trackingFlagSchema,
  track_expiration: trackingFlagSchema,
})

const profileFields = [
  'id',
  'catalog_variant_id',
  'track_lot',
  'track_serial',
  'track_expiration',
]

const profileBatchSize = 100

function normalizeTrackingFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  const token =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined

  return parseBooleanWithDefault(token, false)
}

export function resolveEffectiveTrackingPolicy(
  profile: VariantTrackingProfile | null,
): TrackingPolicy {
  return {
    requiresLot: profile?.trackLot ?? false,
    requiresSerial: profile?.trackSerial ?? false,
    requiresExpiration: profile?.trackExpiration ?? false,
  }
}

export async function loadEffectiveTrackingPolicies(
  container: Pick<AwilixContainer, 'resolve'>,
  variantIds: readonly string[],
  scope: BomScope,
): Promise<Map<string, TrackingPolicy>> {
  const policies = new Map<string, TrackingPolicy>()
  const profileEntityId = E.wms?.product_inventory_profile

  if (!profileEntityId) {
    return policies
  }

  const uniqueVariantIds = Array.from(new Set(variantIds))

  if (uniqueVariantIds.length === 0) {
    return policies
  }

  const queryEngine = container.resolve<QueryEngine>('queryEngine')

  for (
    let offset = 0;
    offset < uniqueVariantIds.length;
    offset += profileBatchSize
  ) {
    const batch = uniqueVariantIds.slice(
      offset,
      offset + profileBatchSize,
    )

    const batchIds = new Set(batch)

    const result = await queryEngine.query<unknown>(
      profileEntityId,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        filters: {
          deleted_at: { $eq: null },
          catalog_variant_id: { $in: batch },
        },
        fields: profileFields,
        page: {
          page: 1,
          pageSize: batch.length,
        },
      },
    )

    for (const item of result.items) {
      const row = trackingProfileRowSchema.parse(item)
      const variantId = row.catalog_variant_id

      if (!variantId || !batchIds.has(variantId)) {
        continue
      }

      policies.set(
        variantId,
        resolveEffectiveTrackingPolicy({
          trackLot: normalizeTrackingFlag(row.track_lot),
          trackSerial: normalizeTrackingFlag(row.track_serial),
          trackExpiration: normalizeTrackingFlag(
            row.track_expiration,
          ),
        }),
      )
    }
  }

  return policies
}