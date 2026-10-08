import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'

export type CatalogVariantScope = {
  tenantId: string
  organizationId: string
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