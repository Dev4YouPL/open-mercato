export const BOM_USAGE_SOURCE_KINDS = ['production_order'] as const
export type BomUsageSourceKind = (typeof BOM_USAGE_SOURCE_KINDS)[number]

export type BomRevisionUsageFact = {
  bomId: string
  revision: string
  sourceKind: BomUsageSourceKind
  sourceId: string
  sourceNumber: string | null
  firstUsedAt: Date
}

export type BomRevisionForDeletion = {
  id: string
  revision: string
  status: 'draft' | 'released'
}

export type BomDeletionBlockReason = 'revision_used' | 'bom_used'
export type BomDeletionDecision =
  | { status: 'allowed' }
  | { status: 'blocked'; reason: BomDeletionBlockReason; usages: BomRevisionUsageFact[] }

function byFirstUse(left: BomRevisionUsageFact, right: BomRevisionUsageFact): number {
  return left.firstUsedAt.getTime() - right.firstUsedAt.getTime()
}

export function decideRevisionDeletion(
  target: BomRevisionForDeletion,
  familyUsages: readonly BomRevisionUsageFact[],
): BomDeletionDecision {
  const directUsages = familyUsages.filter((usage) => usage.bomId === target.id)
  if (directUsages.length > 0) {
    return { status: 'blocked', reason: 'revision_used', usages: [...directUsages].sort(byFirstUse) }
  }
  if (target.status === 'released' && familyUsages.length > 0) {
    return { status: 'blocked', reason: 'bom_used', usages: [...familyUsages].sort(byFirstUse) }
  }
  return { status: 'allowed' }
}

export function decideBomDeletion(familyUsages: readonly BomRevisionUsageFact[]): BomDeletionDecision {
  return familyUsages.length > 0
    ? { status: 'blocked', reason: 'bom_used', usages: [...familyUsages].sort(byFirstUse) }
    : { status: 'allowed' }
}
