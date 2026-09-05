import type { AwilixContainer } from 'awilix'
import { mapQuantityNormalizationError } from './errors'

/**
 * Structural mirror of Catalog's frozen P1.3a
 * `QuantityNormalizationSnapshotV1` contract, resolved at runtime through the
 * `catalogQuantityNormalizationService` DI key. This package depends on
 * Catalog only through the module registry (`requires: ['catalog']`) and the
 * DI container — never through a compile-time import of Catalog's package
 * (enforced by a metadata test). Any shape change to the P1.3a contract must
 * be mirrored here.
 */
export type BomQuantityNormalizationSnapshot = {
  version: 1
  productId: string
  productVariantId: string | null
  baseUnitCode: string
  enteredUnitCode: string
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: { mode: 'half_up' | 'down' | 'up'; scale: number }
  source: { conversionId: string | null; resolvedAt: string }
}

export type CatalogQuantityNormalizationServiceContract = {
  resolve(request: {
    tenantId: string
    organizationId: string
    productId: string
    productVariantId?: string | null
    enteredQuantity: string
    enteredUnitCode?: string | null
  }): Promise<BomQuantityNormalizationSnapshot>
}

export type BomQuantityResolution = {
  enteredQuantity: string
  enteredUnitCode: string
  normalizedQuantity: string
  normalizedUnitCode: string
  snapshot: BomQuantityNormalizationSnapshot
}

/**
 * Module-local adapter over the frozen P1.3a Catalog resolver. Never
 * reimplements decimal/UoM arithmetic locally — resolves the DI-registered
 * service through the container and maps its errors onto BOM domain codes.
 */
export async function resolveBomQuantity(params: {
  container: AwilixContainer
  tenantId: string
  organizationId: string
  productId: string
  variantId?: string | null
  quantity: { value: string; unitCode?: string | null }
}): Promise<BomQuantityResolution> {
  const service = params.container.resolve<CatalogQuantityNormalizationServiceContract>(
    'catalogQuantityNormalizationService',
  )
  try {
    const snapshot = await service.resolve({
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      productId: params.productId,
      productVariantId: params.variantId ?? null,
      enteredQuantity: params.quantity.value,
      enteredUnitCode: params.quantity.unitCode ?? null,
    })
    return {
      enteredQuantity: snapshot.enteredQuantity,
      enteredUnitCode: snapshot.enteredUnitCode,
      normalizedQuantity: snapshot.normalizedQuantity,
      normalizedUnitCode: snapshot.baseUnitCode,
      snapshot,
    }
  } catch (error) {
    throw mapQuantityNormalizationError(error)
  }
}
