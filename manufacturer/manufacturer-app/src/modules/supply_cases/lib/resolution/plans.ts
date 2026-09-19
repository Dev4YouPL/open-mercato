import type { AlternativeOfferSnapshot, ProductionPlan, ResolutionPlan, StoreScope, SupplyCase } from '../../data/types'
import { alternativeOfferSnapshotSchema, finalResolutionFactsSchema, resolutionPlanSchema, type FinalResolutionFacts } from '../../data/types'
import { calculateInitialImpact, type InitialImpactSnapshot } from '../impact/initialImpactService'
import { calculateAlternativeOfferHash, hashCanonical } from './offer'
import { DEMO_INTERNAL_STOCK_COST, DEMO_INTERNAL_STOCK_COST_BASIS } from './stockPolicy'

export type ResolutionPlanInput = {
  supplyCase: SupplyCase
  productionPlan: ProductionPlan
  offer: AlternativeOfferSnapshot
}

export type ResolutionPlansResult = {
  facts: FinalResolutionFacts
  finalFactsHash: string
  plans: ResolutionPlan[]
}

export function buildResolutionPlans(input: ResolutionPlanInput): ResolutionPlansResult {
  const offer = assertResolutionInput(input)
  const supplier1 = parseSupplier1Deliveries(input.supplyCase)
  const initialImpact = calculateInitialImpact(toInitialImpactSnapshot(input, supplier1))
  const onTimeSupplier1 = supplier1.filter((delivery) => delivery.date <= input.productionPlan.requiredDate.slice(0, 10))
  const supplier1OnTimeQuantity = initialImpact.onTimePrimaryQuantity
  const supplier1LateQuantity = initialImpact.latePrimaryQuantity
  const customerDeadline = readCustomerDeadline(input.supplyCase)
  const facts = finalResolutionFactsSchema.parse({
    schemaVersion: 1,
    requiredQuantity: input.productionPlan.requiredQuantity,
    requiredDate: input.productionPlan.requiredDate.slice(0, 10),
    availableStock: initialImpact.availableStock,
    supplier1Commitments: supplier1,
    supplier1OnTimeQuantity,
    supplier1LateQuantity,
    offerQuantity: offer.offeredQuantity,
    offerPrice: offer.priceTotal,
    customerDeadline,
  })
  const finalFactsHash = hashCanonical(facts)
  const shortage = Math.max(0, facts.requiredQuantity - facts.supplier1OnTimeQuantity)
  if (
    offer.requestedQuantity !== shortage
    || offer.offeredQuantity !== offer.requestedQuantity
    || sumQuantities(offer.commitments) !== offer.offeredQuantity
  ) {
    throw new Error('[internal] Alternative offer quantities do not match the current shortage')
  }
  const supplier1TotalQuantity = supplier1.reduce((total, delivery) => total + delivery.quantity, 0)
  const acceptedOnTimeSupplier1 = onTimeSupplier1.map((delivery) => ({ ...delivery, status: 'ACCEPT' as const }))
  const cancelledLateSupplier1 = supplier1
    .filter((delivery) => delivery.date > facts.requiredDate)
    .map((delivery) => ({ ...delivery, status: 'CANCEL' as const }))
  const declinedSupplier2 = offer.commitments.map((commitment) => ({ ...commitment, status: 'DECLINE' as const }))
  const stockAllocated = Math.min(shortage, input.productionPlan.internalStockQuantity)
  const stockCovered = Math.min(facts.requiredQuantity, facts.supplier1OnTimeQuantity + stockAllocated)
  const alternativeOnTimeQuantity = sumQuantities(offer.commitments.filter((commitment) => commitment.date <= facts.requiredDate))
  const alternativeDatesFit = offer.commitments.every((commitment) => commitment.date <= facts.requiredDate)
  const alternativeQuantityFits = alternativeOnTimeQuantity >= shortage
  const alternativeReasons = [
    ...(!alternativeDatesFit ? ['ALTERNATIVE_DOES_NOT_MEET_REQUIRED_DATE'] : []),
    ...(!alternativeQuantityFits ? ['ALTERNATIVE_QUANTITY_INSUFFICIENT'] : []),
  ]
  const plans = [
    makePlan('ACCEPT_DELAY', finalFactsHash, offer, facts, {
      supplier1: supplier1.map((delivery) => ({ quantity: delivery.quantity, date: delivery.date, status: 'ACCEPT' as const })),
      supplier2: declinedSupplier2, stock: 0, feasibility: supplier1TotalQuantity >= facts.requiredQuantity ? 'FEASIBLE' as const : 'INFEASIBLE' as const,
      reasons: supplier1TotalQuantity >= facts.requiredQuantity ? [] : ['PRIMARY_SUPPLY_INSUFFICIENT'], cost: { amount: 0, currency: input.supplyCase.currency, basis: 'no_additional_cost' },
      confirmations: ['SUPPLIER_1' as const], onTime: facts.supplier1OnTimeQuantity,
    }, input.supplyCase),
    makePlan('USE_STOCK', finalFactsHash, offer, facts, {
      supplier1: [...acceptedOnTimeSupplier1, ...cancelledLateSupplier1],
      supplier2: declinedSupplier2, stock: stockAllocated,
      feasibility: stockCovered >= facts.requiredQuantity ? 'FEASIBLE' as const : 'INFEASIBLE' as const,
      reasons: stockCovered >= facts.requiredQuantity ? [] : ['INSUFFICIENT_INTERNAL_STOCK'],
      cost: { amount: DEMO_INTERNAL_STOCK_COST, currency: input.supplyCase.currency, basis: DEMO_INTERNAL_STOCK_COST_BASIS },
      confirmations: ['SUPPLIER_1' as const], onTime: stockCovered,
    }, input.supplyCase),
    makePlan('USE_ALTERNATIVE', finalFactsHash, offer, facts, {
      supplier1: [...acceptedOnTimeSupplier1, ...cancelledLateSupplier1],
      supplier2: offer.commitments.map((commitment) => ({ quantity: commitment.quantity, date: commitment.date, status: 'ACCEPT' as const })),
      stock: 0,
      feasibility: alternativeReasons.length === 0 ? 'FEASIBLE' as const : 'INFEASIBLE' as const,
      reasons: alternativeReasons,
      cost: { amount: offer.priceTotal.amount, currency: offer.priceTotal.currency, basis: 'supplier_2_offer' },
      confirmations: ['SUPPLIER_1' as const, 'SUPPLIER_2' as const], onTime: Math.min(facts.requiredQuantity, facts.supplier1OnTimeQuantity + alternativeOnTimeQuantity),
    }, input.supplyCase),
  ]
  return { facts, finalFactsHash, plans }
}

function makePlan(
  id: ResolutionPlan['id'],
  factsHash: string,
  offer: AlternativeOfferSnapshot,
  facts: FinalResolutionFacts,
  values: {
    supplier1: ResolutionPlan['supplier1Commitments']
    supplier2: ResolutionPlan['supplier2Commitments']
    stock: number
    feasibility: ResolutionPlan['feasibility']
    reasons: string[]
    cost: ResolutionPlan['additionalCost']
    confirmations: ResolutionPlan['requiredConfirmations']
    onTime: number
  },
  supplyCase: SupplyCase,
): ResolutionPlan {
  const shortage = Math.max(0, facts.requiredQuantity - values.onTime)
  const supplier1 = requireEmail(supplyCase.supplier1Email, 'supplier1Email')
  const supplier2 = requireEmail(supplyCase.supplier2Email, 'supplier2Email')
  const effects: ResolutionPlan['outboundEffects'] = [
    {
      effectId: `${id}:supplier1`, recipientEmail: supplier1, phase: 'SUPPLY_ACCEPTANCE',
      decision: id === 'ACCEPT_DELAY' ? 'ACCEPT' : 'AMEND', commitments: values.supplier1,
    },
  ]
  if (id === 'USE_ALTERNATIVE') effects.push({ effectId: `${id}:supplier2`, recipientEmail: supplier2, phase: 'SUPPLY_ACCEPTANCE', decision: 'ACCEPT', commitments: values.supplier2 })
  else effects.push({ effectId: `${id}:supplier2`, recipientEmail: supplier2, phase: 'SUPPLY_ACCEPTANCE', decision: 'DECLINE', commitments: [] })
  const base = {
    schemaVersion: 1 as const, id, factsHash, offerHash: offer.offerHash, planHash: '', feasibility: values.feasibility,
    infeasibilityReasons: values.reasons, supplier1Commitments: values.supplier1, supplier2Commitments: values.supplier2,
    stock: { allocated: values.stock, remaining: Math.max(0, facts.availableStock - values.stock) },
    coverage: { onTimeQuantity: values.onTime, shortage, productionImpact: shortage === 0 ? 'ON_TIME' as const : 'BREACHED' as const, customerImpact: shortage === 0 ? 'ON_TIME' as const : 'AT_RISK' as const },
    additionalCost: values.cost, requiredConfirmations: values.confirmations, outboundEffects: effects,
    action: { commandId: 'supply_cases.resolution.apply_decision' as const, planId: id },
  }
  const planHash = hashCanonical({ ...base, planHash: undefined })
  return resolutionPlanSchema.parse({ ...base, planHash })
}

function parseSupplier1Deliveries(supplyCase: SupplyCase): Array<{ quantity: number; date: string }> {
  const value = supplyCase.supplier1Proposal
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const deliveries = (value as { deliveries?: unknown }).deliveries
  if (!Array.isArray(deliveries)) return []
  return deliveries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.quantity !== 'number' || typeof record.deliveryDate !== 'string') return []
    if (!Number.isInteger(record.quantity) || record.quantity <= 0 || Number.isNaN(Date.parse(record.deliveryDate))) return []
    return [{ quantity: record.quantity, date: record.deliveryDate.slice(0, 10) }]
  }).sort((left, right) => left.date.localeCompare(right.date) || left.quantity - right.quantity)
}

function readCustomerDeadline(supplyCase: SupplyCase): string | null {
  if (!supplyCase.customerCommitmentSnapshot || typeof supplyCase.customerCommitmentSnapshot !== 'object' || Array.isArray(supplyCase.customerCommitmentSnapshot)) return null
  const value = (supplyCase.customerCommitmentSnapshot as { commitmentDate?: unknown }).commitmentDate
  return typeof value === 'string' ? value.slice(0, 10) : null
}

function assertResolutionInput(input: ResolutionPlanInput): AlternativeOfferSnapshot {
  const { supplyCase, productionPlan } = input
  const offer = alternativeOfferSnapshotSchema.parse(input.offer)
  if (
    supplyCase.productionPlanId !== productionPlan.id
    || supplyCase.sku !== productionPlan.materialSku
    || supplyCase.requiredQuantity !== productionPlan.requiredQuantity
    || Date.parse(supplyCase.requiredDate) !== Date.parse(productionPlan.requiredDate)
  ) throw new Error('[internal] Resolution input does not match the case canonical snapshot')
  if (offer.sku !== supplyCase.sku || offer.priceTotal.currency !== supplyCase.currency) {
    throw new Error('[internal] Alternative offer does not match the case')
  }
  const persistedOffer = alternativeOfferSnapshotSchema.safeParse(supplyCase.alternativeOffer)
  if (
    !persistedOffer.success
    || calculateAlternativeOfferHash(offer) !== offer.offerHash
    || hashCanonical(persistedOffer.data) !== hashCanonical(offer)
  ) {
    throw new Error('[internal] Resolution plans require the persisted alternative offer')
  }
  requireEmail(supplyCase.supplier1Email, 'supplier1Email')
  requireEmail(supplyCase.supplier2Email, 'supplier2Email')
  return offer
}

function sumQuantities(values: ReadonlyArray<{ quantity: number }>): number {
  return values.reduce((total, value) => total + value.quantity, 0)
}

function toInitialImpactSnapshot(
  input: ResolutionPlanInput,
  supplier1: Array<{ quantity: number; date: string }>,
): InitialImpactSnapshot {
  return {
    supplyCase: input.supplyCase,
    productionPlan: input.productionPlan,
    productionOrders: [],
    supplier2Email: input.supplyCase.supplier2Email,
    supplier1Deliveries: supplier1.map((entry) => ({ quantity: entry.quantity, deliveryDate: entry.date })),
    customerDeadline: readCustomerDeadline(input.supplyCase),
    customerName: null,
    stockUpdatedAt: input.productionPlan.updatedAt,
  }
}

function requireEmail(value: string | null, field: string): string {
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`[internal] Resolution input is missing ${field}`)
  }
  return value.trim().toLowerCase()
}

export type { StoreScope }
