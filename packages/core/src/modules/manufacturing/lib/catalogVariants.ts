import type { EntityManager } from '@mikro-orm/postgresql'

import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'

export type CatalogVariantScope = {
  tenantId: string
  organizationId: string
}

export type CatalogVariantForRelease = {
  id: string
  name: string | null
  sku: string | null
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