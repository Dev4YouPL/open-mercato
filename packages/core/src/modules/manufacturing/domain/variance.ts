import type { ProductionFactKind } from './executionDocument'
import { roundQuantity } from './quantity'

export type PlannedMaterial = {
  variantId: string
  plannedQuantity: number
}

export type RecordedFact = {
  factKind: ProductionFactKind
  variantId: string
  quantity: number
}

export type MaterialVariance = {
  variantId: string
  inPlan: boolean
  plannedQuantity: number
  issuedQuantity: number
  difference: number
}

export type OutputVariance = {
  plannedQuantity: number
  goodQuantity: number
  scrapQuantity: number
  difference: number
}

const MATERIAL_ISSUE_SIGN: Partial<Record<ProductionFactKind, number>> = {
  material_consumed: 1,
  material_returned: -1,
}

const OUTPUT_SIGN: Partial<Record<ProductionFactKind, { good: number; scrap: number }>> = {
  output_received: { good: 1, scrap: 0 },
  output_reversed: { good: -1, scrap: 0 },
  scrap_recorded: { good: 0, scrap: 1 },
  scrap_reversed: { good: 0, scrap: -1 },
}

function addTo(totals: Map<string, number>, variantId: string, quantity: number): void {
  totals.set(variantId, (totals.get(variantId) ?? 0) + quantity)
}

export function computeMaterialVariances(plan: PlannedMaterial[], facts: RecordedFact[]): MaterialVariance[] {
  const planned = new Map<string, number>()
  const issued = new Map<string, number>()

  for (const line of plan) addTo(planned, line.variantId, line.plannedQuantity)

  for (const fact of facts) {
    const sign = MATERIAL_ISSUE_SIGN[fact.factKind]

    if (sign) addTo(issued, fact.variantId, sign * fact.quantity)
  }

  const variantIds = [...planned.keys(), ...[...issued.keys()].filter((variantId) => !planned.has(variantId))]

  return variantIds.map((variantId) => {
    const plannedQuantity = roundQuantity(planned.get(variantId) ?? 0)
    const issuedQuantity = roundQuantity(issued.get(variantId) ?? 0)

    return {
      variantId,
      inPlan: planned.has(variantId),
      plannedQuantity,
      issuedQuantity,
      difference: roundQuantity(issuedQuantity - plannedQuantity),
    }
  })
}

export function hasMaterialVariance(variance: MaterialVariance): boolean {
  return !variance.inPlan || variance.difference !== 0
}

export function computeOutputVariance(plannedQuantity: number, facts: RecordedFact[]): OutputVariance {
  let good = 0
  let scrap = 0

  for (const fact of facts) {
    const sign = OUTPUT_SIGN[fact.factKind]

    if (!sign) continue

    good += sign.good * fact.quantity
    scrap += sign.scrap * fact.quantity
  }

  const goodQuantity = roundQuantity(good)

  return {
    plannedQuantity: roundQuantity(plannedQuantity),
    goodQuantity,
    scrapQuantity: roundQuantity(scrap),
    difference: roundQuantity(goodQuantity - plannedQuantity),
  }
}
