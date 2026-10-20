import type { EntityManager } from '@mikro-orm/postgresql'

import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'

const VARIANT_ID_CHUNK_SIZE = 1000

export type CatalogVariantScope = {
  tenantId: string
  organizationId: string
}

export type CatalogVariantForRelease = {
  id: string
  name: string | null
  sku: string | null
}

export type CatalogVariantSummary = {
  id: string
  name: string | null
  sku: string | null
  isActive: boolean
  isDeleted: boolean
}

export async function requireAvailableCatalogVariant(
  em: EntityManager,
  variantId: string,
  scope: CatalogVariantScope,
  errorMessage: string,
): Promise<CatalogProductVariant> {
  const variant = await findOneWithDecryption(
    em,
    CatalogProductVariant,
    {
      id: variantId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )

  if (!variant) {
    throw badRequest(errorMessage)
  }

  return variant
}

export async function loadCatalogVariantsForRelease(
  em: EntityManager,
  variantIds: readonly string[],
  scope: CatalogVariantScope,
): Promise<CatalogVariantForRelease[]> {
  const uniqueVariantIds = Array.from(new Set(variantIds))

  if (uniqueVariantIds.length === 0) {
    return []
  }

  const variants = await findWithDecryption(
    em,
    CatalogProductVariant,
    {
      id: { $in: uniqueVariantIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {
      fields: ['id', 'name', 'sku'],
      refresh: true,
    },
    scope,
  )

  return variants.map((variant) => ({
    id: variant.id,
    name: variant.name ?? null,
    sku: variant.sku ?? null,
  }))
}

export async function findCatalogVariantIdsBySearch(
  em: EntityManager,
  term: string,
  scope: CatalogVariantScope,
  candidateVariantIds: readonly string[],
): Promise<string[]> {
  const normalizedTerm = term.trim()
  const uniqueCandidateIds = Array.from(new Set(candidateVariantIds))

  if (!normalizedTerm || uniqueCandidateIds.length === 0) {
    return []
  }

  const like = `%${escapeLikePattern(normalizedTerm)}%`
  const matchedVariantIds: string[] = []

  for (
    let offset = 0;
    offset < uniqueCandidateIds.length;
    offset += VARIANT_ID_CHUNK_SIZE
  ) {
    const variants = await findWithDecryption(
      em,
      CatalogProductVariant,
      {
        id: {
          $in: uniqueCandidateIds.slice(
            offset,
            offset + VARIANT_ID_CHUNK_SIZE,
          ),
        },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        $or: [
          { name: { $ilike: like } },
          { sku: { $ilike: like } },
          { barcode: { $ilike: like } },
        ],
      },
      {
        fields: ['id'],
      },
      scope,
    )

    matchedVariantIds.push(...variants.map((variant) => variant.id))
  }

  return matchedVariantIds
}

export async function loadCatalogVariantSummaries(
  em: EntityManager,
  variantIds: readonly string[],
  scope: CatalogVariantScope,
): Promise<Map<string, CatalogVariantSummary>> {
  const uniqueVariantIds = Array.from(new Set(variantIds))

  if (uniqueVariantIds.length === 0) {
    return new Map()
  }

  const variants = await findWithDecryption(
    em,
    CatalogProductVariant,
    {
      id: { $in: uniqueVariantIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    {
      fields: ['id', 'name', 'sku', 'isActive', 'deletedAt'],
    },
    scope,
  )

  return new Map(variants.map((variant) => [
    variant.id,
    {
      id: variant.id,
      name: variant.name ?? null,
      sku: variant.sku ?? null,
      isActive: variant.isActive,
      isDeleted: variant.deletedAt != null,
    },
  ]))
}
