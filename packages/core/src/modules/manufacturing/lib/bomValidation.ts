import type { EntityManager } from "@mikro-orm/postgresql";
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'

import { isBomStatusUsableInOrder } from '../data/bomStatus'
import { ManufacturingBom } from '../data/entities'

export type BomScope = {
  tenantId: string
  organizationId: string
}

export async function requireScopedBom(
  em: EntityManager,
  bomId: string,
  scope: BomScope,
  errorMessage: string,
): Promise<ManufacturingBom> {
  const bom = await findOneWithDecryption(
    em,
    ManufacturingBom,
    {
      id: bomId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )

  if (!bom) {
    throw notFound(errorMessage)
  }

  return bom
}

export function assertBomIsDraft(
  bom: ManufacturingBom,
  errorMessage: string,
): void {
  if (bom.status !== 'draft') {
    throw conflict(errorMessage)
  }
}

export function assertBomIsReleased(
  bom: ManufacturingBom,
  errorMessage: string,
): void {
  if (!isBomStatusUsableInOrder(bom.status)) {
    throw new CrudHttpError(409, {
      error: errorMessage,
      code: 'manufacturing.bom_availability.not_released',
    })
  }
}
