import type { EntityManager } from '@mikro-orm/postgresql'
import { addEdge, detectCycle, type DirectedGraphEdges } from '../structure/graph'
import { BomDomainError } from './errors'

type FamilyTargetRow = { id: string; product_id: string; variant_id: string | null }
type ProduceLineRow = {
  bom_id: string
  component_product_id: string
  component_variant_id: string | null
}

/**
 * Loads every live family target and every live active-draft `produce` line
 * in one pair of scoped, indexed batch reads (O(V+E)), resolves each line's
 * variant-first/product-fallback child family in memory, and returns the
 * resulting family-to-family edge set. `stock` lines and unresolved
 * `produce` lines contribute no edge.
 */
export async function loadLiveBomGraphEdges(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  targetOverrides?: Map<string, { productId: string; variantId: string | null }>,
): Promise<DirectedGraphEdges> {
  const db = em.getKysely<any>()

  const families = (await db
    .selectFrom('manufacturing_boms')
    .select(['id', 'product_id', 'variant_id'])
    .where('tenant_id', '=', tenantId)
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as FamilyTargetRow[]

  const variantIndex = new Map<string, string>()
  const productIndex = new Map<string, string>()
  for (const family of families) {
    const override = targetOverrides?.get(family.id)
    const productId = override?.productId ?? family.product_id
    const variantId = override ? override.variantId : family.variant_id
    if (variantId) variantIndex.set(`${productId}:${variantId}`, family.id)
    else productIndex.set(productId, family.id)
  }

  const produceLines = (await db
    .selectFrom('manufacturing_bom_lines as l')
    .innerJoin('manufacturing_bom_revisions as r', 'r.id', 'l.revision_id')
    .select(['r.bom_id as bom_id', 'l.component_product_id as component_product_id', 'l.component_variant_id as component_variant_id'])
    .where('l.tenant_id', '=', tenantId)
    .where('l.organization_id', '=', organizationId)
    .where('l.deleted_at', 'is', null)
    .where('l.supply_mode', '=', 'produce')
    .where('r.deleted_at', 'is', null)
    .where('r.status', '=', 'draft')
    .execute()) as ProduceLineRow[]

  const edges: DirectedGraphEdges = new Map()
  for (const line of produceLines) {
    const childId = line.component_variant_id
      ? (variantIndex.get(`${line.component_product_id}:${line.component_variant_id}`) ?? productIndex.get(line.component_product_id))
      : productIndex.get(line.component_product_id)
    if (childId) addEdge(edges, line.bom_id, childId)
  }
  return edges
}

/**
 * Validates a candidate mutation against the full live graph plus a set of
 * extra candidate edges (representing the write being validated). Throws
 * `bom.cycle_detected` when the resulting graph is cyclic.
 */
export async function assertNoCandidateCycle(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    candidateEdges: Array<{ from: string; to: string }>
    removeFromNode?: string
    targetOverrides?: Map<string, { productId: string; variantId: string | null }>
  },
): Promise<void> {
  const edges = await loadLiveBomGraphEdges(em, params.tenantId, params.organizationId, params.targetOverrides)
  if (params.removeFromNode) edges.set(params.removeFromNode, new Set())
  for (const edge of params.candidateEdges) addEdge(edges, edge.from, edge.to)
  const result = detectCycle(edges)
  if (result.cyclic) {
    throw new BomDomainError('bom.cycle_detected', { path: result.path })
  }
}
