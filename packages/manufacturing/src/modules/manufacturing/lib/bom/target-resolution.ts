import type { EntityManager } from '@mikro-orm/postgresql'
import { ManufacturingBom, ManufacturingBomRevision } from '../../data/entities'

export type ComponentTargetKey = { componentProductId: string; componentVariantId?: string | null }

export function componentTargetKey(target: ComponentTargetKey): string {
  return `${target.componentProductId}:${target.componentVariantId ?? ''}`
}

export type BomResolutionState =
  | { state: 'stock_leaf' }
  | { state: 'variant' | 'product_fallback'; childBomId: string; childRevisionId: string }
  | { state: 'unresolved' }

/**
 * Batched variant-first/product-fallback resolution for many component targets.
 *
 * Two scoped reads regardless of how many components are asked about, so a
 * list page costs a constant number of queries instead of one round trip per
 * row. Keyed by `componentTargetKey`; a target with no live child family is
 * absent from the map and is therefore `unresolved`.
 */
export async function resolveComponentTargets(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; targets: ComponentTargetKey[] },
): Promise<Map<string, BomResolutionState>> {
  const resolved = new Map<string, BomResolutionState>()
  const productIds = Array.from(new Set(params.targets.map((target) => target.componentProductId)))
  if (!productIds.length) return resolved

  const families = await em.find(ManufacturingBom, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    productId: { $in: productIds },
    deletedAt: null,
  })
  if (!families.length) return resolved

  const drafts = await em.find(ManufacturingBomRevision, {
    bom: { $in: families.map((family) => family.id) },
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    status: 'draft',
    deletedAt: null,
  })
  const draftByBomId = new Map(drafts.map((draft) => [draft.bom.id, draft.id]))

  const variantIndex = new Map<string, { bomId: string; revisionId: string }>()
  const productIndex = new Map<string, { bomId: string; revisionId: string }>()
  for (const family of families) {
    const revisionId = draftByBomId.get(family.id)
    if (!revisionId) continue
    const entry = { bomId: family.id, revisionId }
    if (family.variantId) variantIndex.set(`${family.productId}:${family.variantId}`, entry)
    else productIndex.set(family.productId, entry)
  }

  for (const target of params.targets) {
    const key = componentTargetKey(target)
    if (resolved.has(key)) continue
    const variantMatch = target.componentVariantId
      ? variantIndex.get(`${target.componentProductId}:${target.componentVariantId}`)
      : undefined
    if (variantMatch) {
      resolved.set(key, { state: 'variant', childBomId: variantMatch.bomId, childRevisionId: variantMatch.revisionId })
      continue
    }
    const productMatch = productIndex.get(target.componentProductId)
    resolved.set(
      key,
      productMatch
        ? { state: 'product_fallback', childBomId: productMatch.bomId, childRevisionId: productMatch.revisionId }
        : { state: 'unresolved' },
    )
  }
  return resolved
}

/**
 * Variant-first/product-fallback child family resolution for one component
 * target, used both for line-detail resolution status and for graph-edge
 * membership. A `stock` line never calls this — it is always a leaf.
 */
export async function resolveComponentTarget(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    componentProductId: string
    componentVariantId?: string | null
  },
): Promise<BomResolutionState> {
  if (params.componentVariantId) {
    const variantFamily = await em.findOne(ManufacturingBom, {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      productId: params.componentProductId,
      variantId: params.componentVariantId,
      deletedAt: null,
    })
    if (variantFamily) {
      const draft = await em.findOne(ManufacturingBomRevision, {
        bom: variantFamily.id,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        status: 'draft',
        deletedAt: null,
      })
      if (draft) return { state: 'variant', childBomId: variantFamily.id, childRevisionId: draft.id }
    }
  }

  const productFamily = await em.findOne(ManufacturingBom, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    productId: params.componentProductId,
    variantId: null,
    deletedAt: null,
  })
  if (productFamily) {
    const draft = await em.findOne(ManufacturingBomRevision, {
      bom: productFamily.id,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      status: 'draft',
      deletedAt: null,
    })
    if (draft) return { state: 'product_fallback', childBomId: productFamily.id, childRevisionId: draft.id }
  }

  return { state: 'unresolved' }
}
