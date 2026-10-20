import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { bomResponseSchema } from '../api/openapi'
import { ManufacturingBom } from '../data/entities'
import { resolveBomAvailability } from './bomAvailability'
import type { BomScope } from './bomValidation'
import {
  findCatalogVariantIdsBySearch,
  loadCatalogVariantSummaries,
} from './catalogVariants'

const decoratableBomSchema = z.object({
  outputVariantId: bomResponseSchema.shape.outputVariantId,
  status: bomResponseSchema.shape.status,
})

export async function decorateBomListItems(
  em: EntityManager,
  items: unknown[],
  scope: BomScope,
): Promise<void> {
  const boms = items.flatMap((item) => {
    const parsed = decoratableBomSchema.safeParse(item)

    return parsed.success && item && typeof item === 'object'
      ? [{ item, bom: parsed.data }]
      : []
  })

  if (boms.length === 0) {
    return
  }

  const variants = await loadCatalogVariantSummaries(
    em,
    boms.map(({ bom }) => bom.outputVariantId),
    scope,
  )

  for (const { item, bom } of boms) {
    const variant = variants.get(bom.outputVariantId) ?? null

    Object.assign(item, {
      outputVariant: variant,
      availability: resolveBomAvailability(bom, variant),
    })
  }
}

export async function findBomOutputVariantIdsBySearch(
  em: EntityManager,
  term: string,
  scope: BomScope,
  outputVariantId?: string,
): Promise<string[]> {
  if (!term.trim()) {
    return []
  }

  const boms = await findWithDecryption(
    em,
    ManufacturingBom,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(outputVariantId ? { outputVariantId } : {}),
    },
    {
      fields: ['outputVariantId'],
    },
    scope,
  )

  return findCatalogVariantIdsBySearch(
    em,
    term,
    scope,
    boms.map((bom) => bom.outputVariantId),
  )
}
