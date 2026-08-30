import type { EntityManager } from '@mikro-orm/postgresql'
import { ManufacturingBom, ManufacturingBomRevision } from '../../data/entities'

export type BomResolutionState =
  | { state: 'stock_leaf' }
  | { state: 'variant' | 'product_fallback'; childBomId: string; childRevisionId: string }
  | { state: 'unresolved' }

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
