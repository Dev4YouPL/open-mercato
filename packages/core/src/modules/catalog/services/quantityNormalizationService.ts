import type { EntityManager } from '@mikro-orm/postgresql'
import {
  canonicalizeDecimal,
  compareDecimals,
  multiplyDecimals,
  roundDecimal,
  type DecimalRoundingMode,
} from '@open-mercato/shared/lib/decimal/exact'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct, CatalogProductUnitConversion, CatalogProductVariant } from '../data/entities'
import { resolveCanonicalUnitCode } from '../lib/unitResolution'
import { toUnitLookupKey } from '../lib/unitCodes'

export const CATALOG_QUANTITY_NORMALIZATION_SERVICE = 'catalogQuantityNormalizationService' as const

export type QuantityNormalizationRequest = {
  tenantId: string
  organizationId: string
  productId: string
  productVariantId?: string | null
  enteredQuantity: string
  enteredUnitCode?: string | null
}

export type QuantityNormalizationSnapshotV1 = {
  version: 1
  productId: string
  productVariantId: string | null
  baseUnitCode: string
  enteredUnitCode: string
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: { mode: DecimalRoundingMode; scale: number }
  source: { conversionId: string | null; resolvedAt: string }
}

/**
 * Per-request outcome of a batch that tolerates normalization failures.
 * A product with no conversion for the requested unit is an ordinary catalog
 * state, not a request failure, so read paths degrade that single entry
 * instead of losing the whole page.
 */
export type QuantityNormalizationOutcome =
  | { ok: true; snapshot: QuantityNormalizationSnapshotV1 }
  | { ok: false; productId: string; code: string }

export type CatalogQuantityNormalizationService = {
  resolve(request: QuantityNormalizationRequest): Promise<QuantityNormalizationSnapshotV1>
  resolveMany(requests: QuantityNormalizationRequest[]): Promise<QuantityNormalizationSnapshotV1[]>
  resolveManySettled(requests: QuantityNormalizationRequest[]): Promise<QuantityNormalizationOutcome[]>
}

export class QuantityNormalizationError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'QuantityNormalizationError'
  }
}

function fail(code: string): never {
  throw new QuantityNormalizationError(code)
}

function requireQuantity(value: string): string {
  try {
    const canonical = canonicalizeDecimal(value)
    if (canonical.length > 25 || (canonical.includes('.') && canonical.split('.')[1].length > 18)) {
      return fail('uom.precision_overflow')
    }
    return canonical
  } catch {
    return fail('uom.precision_overflow')
  }
}

function requirePositiveFactor(value: string): string {
  try {
    const canonical = canonicalizeDecimal(value)
    if (compareDecimals(canonical, '0') <= 0 || canonical.length > 40) return fail('uom.invalid_factor')
    return canonical
  } catch {
    return fail('uom.invalid_factor')
  }
}

function rounding(product: CatalogProduct): { mode: DecimalRoundingMode; scale: number } {
  const mode = product.uomRoundingMode
  const scale = product.uomRoundingScale
  if (!Number.isInteger(scale) || scale < 0 || scale > 6 || !['half_up', 'down', 'up'].includes(mode)) {
    return fail('uom.precision_overflow')
  }
  return { mode, scale }
}

export function createCatalogQuantityNormalizationService({ em }: { em: EntityManager }): CatalogQuantityNormalizationService {
  const productCache = new Map<string, Promise<CatalogProduct | null>>()
  const variantCache = new Map<string, Promise<CatalogProductVariant | null>>()
  const conversionCache = new Map<string, Promise<CatalogProductUnitConversion[]>>()

  function scopedKey(tenantId: string, organizationId: string, id: string): string {
    return `${tenantId}:${organizationId}:${id}`
  }

  function loadProduct(request: QuantityNormalizationRequest): Promise<CatalogProduct | null> {
    const key = scopedKey(request.tenantId, request.organizationId, request.productId)
    const existing = productCache.get(key)
    if (existing) return existing
    const loaded = findOneWithDecryption(em, CatalogProduct, {
      id: request.productId,
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      deletedAt: null,
    })
    productCache.set(key, loaded)
    return loaded
  }

  function loadVariant(request: QuantityNormalizationRequest, product: CatalogProduct, variantId: string): Promise<CatalogProductVariant | null> {
    const key = scopedKey(request.tenantId, request.organizationId, variantId)
    const existing = variantCache.get(key)
    if (existing) return existing
    const loaded = findOneWithDecryption(em, CatalogProductVariant, {
      id: variantId,
      product: product.id,
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      deletedAt: null,
    })
    variantCache.set(key, loaded)
    return loaded
  }

  function loadConversions(request: QuantityNormalizationRequest, product: CatalogProduct): Promise<CatalogProductUnitConversion[]> {
    const key = scopedKey(request.tenantId, request.organizationId, product.id)
    const existing = conversionCache.get(key)
    if (existing) return existing
    const loaded = findWithDecryption(em, CatalogProductUnitConversion, {
      product: product.id,
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      deletedAt: null,
      isActive: true,
    })
    conversionCache.set(key, loaded)
    return loaded
  }

  async function resolve(request: QuantityNormalizationRequest): Promise<QuantityNormalizationSnapshotV1> {
    const product = await loadProduct(request)
    if (!product) return fail('uom.variant_product_mismatch')

    const variantId = request.productVariantId ?? null
    if (variantId) {
      const variant = await loadVariant(request, product, variantId)
      if (!variant) return fail('uom.variant_product_mismatch')
    }

    const baseUnitRaw = product.defaultUnit
    if (!baseUnitRaw) return fail('uom.default_unit_missing')
    let baseUnitCode: string
    let enteredUnitCode: string
    try {
      baseUnitCode = await resolveCanonicalUnitCode(em, {
        tenantId: request.tenantId,
        organizationId: request.organizationId,
        unitCode: baseUnitRaw,
      })
      enteredUnitCode = await resolveCanonicalUnitCode(em, {
        tenantId: request.tenantId,
        organizationId: request.organizationId,
        unitCode: request.enteredUnitCode ?? baseUnitCode,
      })
    } catch {
      return fail('uom.unit_not_found')
    }

    const enteredQuantity = requireQuantity(request.enteredQuantity)
    const policy = rounding(product)
    const sameUnit = toUnitLookupKey(baseUnitCode) === toUnitLookupKey(enteredUnitCode)
    let factor = '1'
    let conversionId: string | null = null
    if (!sameUnit) {
      const conversions = await loadConversions(request, product)
      const conversion = conversions.find((candidate) => toUnitLookupKey(candidate.unitCode) === toUnitLookupKey(enteredUnitCode))
      if (!conversion) return fail('uom.conversion_not_found')
      factor = requirePositiveFactor(conversion.toBaseFactor)
      conversionId = conversion.id
    }

    let normalizedQuantity: string
    try {
      normalizedQuantity = roundDecimal(multiplyDecimals(enteredQuantity, factor), policy.scale, policy.mode)
    } catch {
      return fail('uom.precision_overflow')
    }
    if (normalizedQuantity.length > 25) return fail('uom.precision_overflow')

    return {
      version: 1,
      productId: product.id,
      productVariantId: variantId,
      baseUnitCode,
      enteredUnitCode,
      enteredQuantity,
      toBaseFactor: factor,
      normalizedQuantity,
      rounding: policy,
      source: { conversionId, resolvedAt: new Date().toISOString() },
    }
  }

  return {
    resolve,
    async resolveMany(requests) {
      return Promise.all(requests.map((request) => resolve(request)))
    },
    async resolveManySettled(requests) {
      return Promise.all(
        requests.map(async (request): Promise<QuantityNormalizationOutcome> => {
          try {
            return { ok: true, snapshot: await resolve(request) }
          } catch (error) {
            if (!(error instanceof QuantityNormalizationError)) throw error
            return { ok: false, productId: request.productId, code: error.code }
          }
        }),
      )
    },
  }
}
