import type { ManufacturingBom, ManufacturingBomLine, ManufacturingBomRevision } from '../../data/entities'
import type { BomResolutionState } from './target-resolution'
import { missingCatalogLabel, type BomTargetLabel, type CatalogLabelIndex } from './catalog-enrichment'

function targetOf(bom: ManufacturingBom) {
  return { productId: bom.productId, variantId: bom.variantId ?? null }
}

function targetLabelOf(bom: ManufacturingBom, labels?: CatalogLabelIndex): BomTargetLabel {
  if (!labels) return missingCatalogLabel
  return labels.labelFor({ productId: bom.productId, variantId: bom.variantId ?? null })
}

export function toBomListItemDto(
  item: {
    bom: ManufacturingBom
    revision: ManufacturingBomRevision
    lineCount: number
    unresolvedProduceCount: number
  },
  labels?: CatalogLabelIndex,
) {
  return {
    id: item.bom.id,
    target: targetOf(item.bom),
    targetLabel: targetLabelOf(item.bom, labels),
    activeDraft: {
      id: item.revision.id,
      revisionNumber: item.revision.revisionNumber,
      revisionLabel: item.revision.revisionLabel ?? null,
      updatedAt: item.revision.updatedAt.toISOString(),
    },
    directLineSummary: { count: item.lineCount, unresolvedProduceCount: item.unresolvedProduceCount },
    updatedAt: item.bom.updatedAt.toISOString(),
  }
}

export function toBomDetailDto(
  bom: ManufacturingBom,
  revision: ManufacturingBomRevision,
  summary: { count: number; unresolvedProduceCount: number },
  labels?: CatalogLabelIndex,
) {
  return {
    id: bom.id,
    target: targetOf(bom),
    targetLabel: targetLabelOf(bom, labels),
    activeDraft: {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      revisionLabel: revision.revisionLabel ?? null,
      baseOutput: {
        value: revision.baseOutputEnteredQuantity,
        unitCode: revision.baseOutputEnteredUnitCode,
        normalizedValue: revision.baseOutputNormalizedQuantity,
        baseUnitCode: revision.baseOutputNormalizedUnitCode,
      },
      updatedAt: revision.updatedAt.toISOString(),
    },
    directLineSummary: summary,
    createdAt: bom.createdAt.toISOString(),
    updatedAt: bom.updatedAt.toISOString(),
  }
}

export function toBomMutationResultDto(
  bom: ManufacturingBom,
  revision: ManufacturingBomRevision,
  summary = { count: 0, unresolvedProduceCount: 0 },
  labels?: CatalogLabelIndex,
) {
  return { bom: toBomDetailDto(bom, revision, summary, labels), updatedAt: revision.updatedAt.toISOString() }
}

export function toBomLineDto(line: ManufacturingBomLine, resolution: BomResolutionState, labels?: CatalogLabelIndex) {
  const resolutionDto =
    resolution.state === 'stock_leaf'
      ? { state: 'stock_leaf' as const }
      : resolution.state === 'unresolved'
        ? { state: 'unresolved' as const, warning: { code: 'bom.child_unresolved' as const, lineId: line.id } }
        : { state: resolution.state, childBomId: resolution.childBomId, childRevisionId: resolution.childRevisionId }

  return {
    id: line.id,
    position: Number(line.position),
    componentProductId: line.componentProductId,
    componentVariantId: line.componentVariantId ?? null,
    componentLabel: labels
      ? labels.labelFor({ productId: line.componentProductId, variantId: line.componentVariantId ?? null })
      : missingCatalogLabel,
    quantity: {
      value: line.enteredQuantity,
      unitCode: line.enteredUnitCode,
      normalizedValue: line.normalizedQuantity,
      baseUnitCode: line.normalizedUnitCode,
    },
    consumptionBasis: line.consumptionBasis,
    yieldFactor: line.yieldFactor,
    supplyMode: line.supplyMode,
    resolution: resolutionDto,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  }
}

export function toBomLineMutationResultDto(
  line: ManufacturingBomLine,
  resolution: BomResolutionState,
  revisionUpdatedAt: Date,
  labels?: CatalogLabelIndex,
) {
  return { line: toBomLineDto(line, resolution, labels), updatedAt: revisionUpdatedAt.toISOString() }
}
