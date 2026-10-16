import type {
  ManufacturingBom,
  ManufacturingBomItem,
} from '../data/entities'
import type { BomReleaseInput } from '../data/validators'
import type { CatalogVariantForRelease } from './catalogVariants'
import {
  resolveEffectiveTrackingPolicy,
} from './wmsTrackingPolicy'
import type { TrackingPolicy } from './wmsTrackingPolicy'

export type TrackingRequirement = 'lot' | 'serial' | 'expiration'

export type TrackingViolation = {
  variantId: string
  role: 'output' | 'component'
  name: string | null
  sku: string | null
  requirements: TrackingRequirement[]
}

type ExpectedReleaseItem = BomReleaseInput['expectedItems'][number]

type ActiveReleaseItem = Pick<
  ManufacturingBomItem,
  'id' | 'updatedAt'
>

export function collectReleaseVariantIds(
  bom: Pick<ManufacturingBom, 'outputVariantId'>,
  items: readonly Pick<
    ManufacturingBomItem,
    'componentVariantId'
  >[],
): string[] {
  const variantIds = [
    bom.outputVariantId,
    ...items.map((item) => item.componentVariantId),
  ]

  return Array.from(
    new Set(variantIds.map((variantId) => variantId.toLowerCase())),
  )
}

export function findTrackingViolations(
  variants: readonly CatalogVariantForRelease[],
  policies: ReadonlyMap<string, TrackingPolicy>,
  outputVariantId: string,
): TrackingViolation[] {
  const violations: TrackingViolation[] = []
  const normalizedOutputVariantId = outputVariantId.toLowerCase()

  for (const variant of variants) {
    const normalizedVariantId = variant.id.toLowerCase()

    const policy =
      policies.get(normalizedVariantId) ??
      resolveEffectiveTrackingPolicy(null)

    const requirements: TrackingRequirement[] = []

    if (policy.requiresLot) {
      requirements.push('lot')
    }

    if (policy.requiresSerial) {
      requirements.push('serial')
    }

    if (policy.requiresExpiration) {
      requirements.push('expiration')
    }

    if (requirements.length === 0) {
      continue
    }

    violations.push({
      variantId: variant.id,
      role:
        normalizedVariantId === normalizedOutputVariantId
          ? 'output'
          : 'component',
      name: variant.name,
      sku: variant.sku,
      requirements,
    })
  }

  return violations
}

export function isIncompleteRelease(
  items: readonly unknown[],
): boolean {
  return items.length === 0
}

export function hasReleaseItemsChanged(
  expectedItems: readonly ExpectedReleaseItem[],
  activeItems: readonly ActiveReleaseItem[],
): boolean {
  if (expectedItems.length !== activeItems.length) {
    return true
  }

  const expectedVersions = new Map(
    expectedItems.map((item) => [
      item.id.toLowerCase(),
      new Date(item.updatedAt).getTime(),
    ]),
  )

  const activeVersions = new Map(
    activeItems.map((item) => [
      item.id.toLowerCase(),
      item.updatedAt.getTime(),
    ]),
  )

  if (
    expectedVersions.size !== expectedItems.length ||
    activeVersions.size !== activeItems.length
  ) {
    return true
  }

  for (const [itemId, expectedVersion] of expectedVersions) {
    const activeVersion = activeVersions.get(itemId)

    if (
      activeVersion === undefined ||
      activeVersion !== expectedVersion
    ) {
      return true
    }
  }

  return false
}