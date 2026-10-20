import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../data/entities'
import { resolveBomAvailability } from './bomAvailability'
import type { BomScope } from './bomValidation'
import { loadFreshCatalogVariantSummary } from './catalogVariants'

type Translate = (key: string) => string

export async function requireBomForNewOrder(
  em: EntityManager,
  bomId: string,
  scope: BomScope,
  translate: Translate,
): Promise<ManufacturingBom> {
  const bom = await findOneWithDecryption(
    em,
    ManufacturingBom,
    { id: bomId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_READ, refresh: true },
    scope,
  )
  if (!bom) throw notFound(translate('manufacturing.errors.bomUnavailable'))
  const variant = await loadFreshCatalogVariantSummary(em, bom.outputVariantId, scope)
  const availability = resolveBomAvailability(bom, variant)
  if (!availability.isAvailable) {
    throw new CrudHttpError(422, {
      error: translate('manufacturing.errors.bomUnavailableForNewOrders'),
      code: 'manufacturing.bom.unavailable_for_new_orders',
      reason: availability.reason,
    })
  }
  return bom
}
