import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type { ProductionOrder, ProductionPlan, SupplyCase } from '../../data/types'
import {
  deliveryCommitmentSchema,
  hashInitialImpactFacts,
  initialImpactFactsSchema,
  initialOptionSchema,
  type CanonicalInitialOption,
  type InitialImpactFacts,
  type InitialImpactReasonCode,
  type ImpactStatus,
} from '../../data/initial-impact'

export type InitialImpactSnapshot = {
  supplyCase: SupplyCase
  productionPlan: ProductionPlan
  productionOrders: ProductionOrder[]
  supplier2Email: string | null
  supplier1Deliveries: Array<{ quantity: number; deliveryDate: string }>
  customerDeadline: string | null
  customerName: string | null
  stockUpdatedAt: string
}

export type InitialImpactLoadResult =
  | { ok: true; snapshot: InitialImpactSnapshot }
  | { ok: false; reasonCodes: InitialImpactReasonCode[]; unresolved: string[] }

export async function loadInitialImpactSnapshot(
  store: SupplyCasesStore,
  scope: StoreScope,
  caseId: string,
): Promise<InitialImpactLoadResult> {
  const supplyCase = await store.supplyCases.findById(scope, caseId)
  if (!supplyCase) return { ok: false, reasonCodes: ['MISSING_REQUIRED_FACT'], unresolved: ['case'] }
  const productionPlan = supplyCase.productionPlanId
    ? await store.productionPlans.findById(scope, supplyCase.productionPlanId)
    : null
  if (!productionPlan) return { ok: false, reasonCodes: ['MISSING_PRODUCTION_PLAN'], unresolved: ['productionPlan'] }
  if (
    supplyCase.sku !== productionPlan.materialSku
    || supplyCase.requiredQuantity !== productionPlan.requiredQuantity
    || Date.parse(supplyCase.requiredDate) !== Date.parse(productionPlan.requiredDate)
  ) {
    return { ok: false, reasonCodes: ['MISSING_REQUIRED_FACT'], unresolved: ['caseCanonicalSnapshot'] }
  }

  const deliveries = parseDeliveries(supplyCase.supplier1Proposal)
  if (deliveries.length === 0) {
    return { ok: false, reasonCodes: ['MISSING_PRIMARY_PROPOSAL'], unresolved: ['supplier1Proposal.deliveries'] }
  }
  const productionOrders = (await Promise.all(
    supplyCase.productionOrderIds.map((id) => store.productionOrders.findById(scope, id)),
  )).filter((order): order is ProductionOrder => order !== null)
  const customer = resolveCustomer(productionOrders, supplyCase.customerCommitmentSnapshot)
  return {
    ok: true,
    snapshot: {
      supplyCase,
      productionPlan,
      productionOrders,
      supplier2Email: supplyCase.supplier2Email,
      supplier1Deliveries: deliveries,
      customerDeadline: customer.commitmentDate,
      customerName: customer.customerName,
      stockUpdatedAt: productionPlan.updatedAt,
    },
  }
}

export function calculateInitialImpact(snapshot: InitialImpactSnapshot): InitialImpactFacts {
  const { productionPlan, supplier1Deliveries } = snapshot
  const requiredQuantity = productionPlan.requiredQuantity
  const onTimePrimaryQuantity = sum(supplier1Deliveries.filter((delivery) => onOrBefore(delivery.deliveryDate, productionPlan.requiredDate)))
  const totalPrimaryQuantity = sum(supplier1Deliveries)
  const latePrimaryQuantity = Math.max(0, totalPrimaryQuantity - onTimePrimaryQuantity)
  const coverageWithoutStock = Math.min(requiredQuantity, onTimePrimaryQuantity)
  const shortageWithoutStock = Math.max(0, requiredQuantity - coverageWithoutStock)
  const availableStock = productionPlan.internalStockQuantity
  const coverageWithStock = Math.min(requiredQuantity, coverageWithoutStock + availableStock)
  const shortageAfterStock = Math.max(0, requiredQuantity - coverageWithStock)
  const stockRemainingAfterCoverage = Math.max(0, availableStock - shortageWithoutStock)
  const latestPrimaryDeliveryDate = supplier1Deliveries.length > 0
    ? supplier1Deliveries.reduce((latest, current) => latest && Date.parse(latest) > Date.parse(current.deliveryDate) ? latest : current.deliveryDate, null as string | null)
    : null
  const customerDeadlineStatus = calculateCustomerDeadlineStatus(snapshot.customerDeadline, supplier1Deliveries, requiredQuantity)
  const reasonCodes: InitialImpactReasonCode[] = []
  if (latePrimaryQuantity > 0) reasonCodes.push('PRIMARY_DELIVERY_LATE')
  if (customerDeadlineStatus === 'BREACHED') reasonCodes.push('CUSTOMER_DEADLINE_BREACHED')
  if (shortageWithoutStock > 0 && stockRemainingAfterCoverage === 0) reasonCodes.push('STOCK_BUFFER_EXHAUSTED')
  if (shortageWithoutStock > 0) reasonCodes.push('ALTERNATIVE_PRICE_UNKNOWN')
  if (!snapshot.supplier2Email) reasonCodes.push('ALTERNATIVE_SUPPLIER_UNAVAILABLE')
  const latestSafeDecisionAt = snapshot.customerDeadline
    ? new Date(Math.min(Date.parse(snapshot.customerDeadline), Date.parse(productionPlan.requiredDate))).toISOString()
    : null
  return initialImpactFactsSchema.parse({
    requiredQuantity,
    requiredDate: productionPlan.requiredDate,
    onTimePrimaryQuantity,
    latePrimaryQuantity,
    coverageWithoutStock,
    shortageWithoutStock,
    coverageWithStock,
    shortageAfterStock,
    availableStock,
    stockRemainingAfterCoverage,
    customerDeadline: snapshot.customerDeadline,
    customerDeadlineStatus,
    latestPrimaryDeliveryDate,
    latestSafeDecisionAt,
    reasonCodes,
  })
}

export function buildCanonicalInitialOptions(
  snapshot: InitialImpactSnapshot,
  impact: InitialImpactFacts,
): CanonicalInitialOption[] {
  const factsHash = hashInitialImpactFacts({ snapshot: canonicalSnapshot(snapshot), impact })
  const currency = snapshot.supplyCase.currency
  const primarySupply = snapshot.supplier1Deliveries.map((delivery) => ({
    source: 'SUPPLIER_1' as const,
    quantity: delivery.quantity,
    date: delivery.deliveryDate,
  }))
  const acceptsDelay = impact.customerDeadlineStatus !== 'BREACHED'
  const stockCanCover = impact.shortageWithoutStock <= impact.availableStock
  const canAskAlternative = Boolean(snapshot.supplier2Email) && impact.shortageWithoutStock > 0
  const optionA = initialOptionSchema.parse({
    id: 'ACCEPT_PRIMARY_DELAY',
    factsHash,
    feasibility: acceptsDelay ? 'CONDITIONALLY_FEASIBLE' : 'INFEASIBLE',
    supply: primarySupply,
    onTimeCoverage: impact.coverageWithoutStock,
    shortageOnRequiredDate: impact.shortageWithoutStock,
    stockRemaining: impact.availableStock,
    productionImpact: impact.shortageWithoutStock > 0 ? 'BREACHED' : 'ON_TIME',
    customerImpact: impact.customerDeadlineStatus,
    cost: { status: 'UNKNOWN', amount: null, currency },
    risks: impact.customerDeadlineStatus === 'BREACHED' ? ['Customer commitment is missed by the late primary delivery.'] : ['Customer must accept the revised delivery date.'],
    requiredConfirmations: ['Customer acceptance of the revised delivery date.', 'Supplier 1 confirmation of both delivery dates.'],
    outboundEffects: ['Create a pending delay-acceptance plan.', 'Do not contact Supplier 2.', 'Do not mutate production or stock.'],
  })
  const optionB = initialOptionSchema.parse({
    id: 'USE_INTERNAL_STOCK',
    factsHash,
    feasibility: stockCanCover ? 'CONDITIONALLY_FEASIBLE' : 'INFEASIBLE',
    supply: [
      ...primarySupply.filter((delivery) => onOrBefore(delivery.date, snapshot.productionPlan.requiredDate)),
      { source: 'INTERNAL_STOCK', quantity: Math.min(impact.availableStock, impact.shortageWithoutStock), date: snapshot.productionPlan.requiredDate },
    ],
    onTimeCoverage: impact.coverageWithStock,
    shortageOnRequiredDate: impact.shortageAfterStock,
    stockRemaining: impact.stockRemainingAfterCoverage,
    productionImpact: impact.shortageAfterStock > 0 ? 'BREACHED' : 'ON_TIME',
    customerImpact: impact.shortageAfterStock > 0 ? 'AT_RISK' : 'ON_TIME',
    cost: { status: 'UNKNOWN', amount: null, currency },
    risks: ['Stock availability must be confirmed and may remove the safety buffer.', 'Another order may claim the same stock before allocation.'],
    requiredConfirmations: ['Warehouse confirmation that stock is allocatable.', 'Supplier 1 confirmation of the on-time quantity.'],
    outboundEffects: ['Create a pending stock-allocation plan.', 'Do not reserve or consume stock in Phase 2.', 'Do not contact Supplier 2.'],
  })
  const optionC = initialOptionSchema.parse({
    id: 'CHECK_ALTERNATIVE_SUPPLIER',
    factsHash,
    feasibility: canAskAlternative ? 'CONDITIONALLY_FEASIBLE' : 'INFEASIBLE',
    supply: [
      ...primarySupply.filter((delivery) => onOrBefore(delivery.date, snapshot.productionPlan.requiredDate)),
      { source: 'SUPPLIER_2', quantity: impact.shortageWithoutStock, date: snapshot.productionPlan.requiredDate },
    ],
    onTimeCoverage: impact.coverageWithoutStock,
    shortageOnRequiredDate: impact.shortageWithoutStock,
    stockRemaining: impact.availableStock,
    productionImpact: impact.shortageWithoutStock > 0 ? 'AT_RISK' : 'ON_TIME',
    customerImpact: impact.shortageWithoutStock > 0 ? 'AT_RISK' : 'ON_TIME',
    cost: { status: 'UNKNOWN', amount: null, currency },
    risks: ['Supplier 2 price and availability are unknown.', 'A late response may miss the safe decision time.'],
    requiredConfirmations: ['Supplier 2 quote for the canonical shortage quantity.', 'Delivery date and price confirmation before further action.'],
    outboundEffects: canAskAlternative
      ? ['Send one RFQ for the shortage only.', 'Use the trusted Supplier 2 address from the case.', 'Do not mutate production or stock.']
      : ['No RFQ can be sent until an approved alternative supplier exists.'],
  })
  return [optionA, optionB, optionC]
}

export function buildAdvisorInput(snapshot: InitialImpactSnapshot, impact: InitialImpactFacts, options: CanonicalInitialOption[]) {
  const factsHash = options[0]?.factsHash ?? hashInitialImpactFacts({ snapshot: canonicalSnapshot(snapshot), impact })
  return {
    schemaVersion: 1 as const,
    caseRef: { correlationId: snapshot.supplyCase.correlationId, sku: snapshot.supplyCase.sku, status: 'ANALYZING_INITIAL_IMPACT' as const },
    factsHash,
    demand: {
      requiredQuantity: snapshot.productionPlan.requiredQuantity,
      requiredDate: snapshot.productionPlan.requiredDate,
      productionOrders: snapshot.productionOrders.map((order) => ({
        orderNumber: order.orderNumber,
        materialQuantity: order.materialQuantity,
        dueDate: order.dueDate,
        customerName: order.customerName,
        customerCommitmentDate: order.customerCommitmentDate,
      })),
    },
    primaryProposal: { supplierEmail: snapshot.supplyCase.supplier1Email ?? 'unknown@example.invalid', deliveries: snapshot.supplier1Deliveries },
    stock: { availableQuantity: snapshot.productionPlan.internalStockQuantity, sourceUpdatedAt: snapshot.stockUpdatedAt },
    impact,
    options,
    unresolved: snapshot.customerDeadline ? [] : ['customerCommitmentDate'],
  }
}

function parseDeliveries(value: unknown): Array<{ quantity: number; deliveryDate: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const deliveries = (value as Record<string, unknown>).deliveries
  if (!Array.isArray(deliveries)) return []
  return deliveries.flatMap((entry) => {
    const parsed = deliveryCommitmentSchema.safeParse(entry)
    return parsed.success ? [{ quantity: parsed.data.quantity, deliveryDate: parsed.data.deliveryDate }] : []
  })
}

function resolveCustomer(orders: ProductionOrder[], snapshot: unknown): { customerName: string | null; commitmentDate: string | null } {
  const first = orders[0]
  if (first) return { customerName: first.customerName, commitmentDate: first.customerCommitmentDate }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { customerName: null, commitmentDate: null }
  const record = snapshot as Record<string, unknown>
  return {
    customerName: typeof record.customerName === 'string' ? record.customerName : null,
    commitmentDate: typeof record.commitmentDate === 'string' ? record.commitmentDate : null,
  }
}

function calculateCustomerDeadlineStatus(customerDeadline: string | null, deliveries: Array<{ quantity: number; deliveryDate: string }>, requiredQuantity: number): ImpactStatus {
  if (!customerDeadline) return 'UNKNOWN'
  const coveredByDeadline = Math.min(requiredQuantity, sum(deliveries.filter((delivery) => onOrBefore(delivery.deliveryDate, customerDeadline))))
  if (coveredByDeadline >= requiredQuantity) return 'ON_TIME'
  return deliveries.some((delivery) => Date.parse(delivery.deliveryDate) > Date.parse(customerDeadline)) ? 'BREACHED' : 'AT_RISK'
}

function canonicalSnapshot(snapshot: InitialImpactSnapshot) {
  return {
    caseId: snapshot.supplyCase.id,
    requiredQuantity: snapshot.productionPlan.requiredQuantity,
    requiredDate: snapshot.productionPlan.requiredDate,
    supplier1Email: snapshot.supplyCase.supplier1Email,
    supplier2Email: snapshot.supplier2Email,
    deliveries: snapshot.supplier1Deliveries,
    stock: snapshot.productionPlan.internalStockQuantity,
    customerDeadline: snapshot.customerDeadline,
  }
}

function sum(values: Array<{ quantity: number }>): number {
  return values.reduce((total, entry) => total + entry.quantity, 0)
}

function onOrBefore(left: string, right: string): boolean {
  return Date.parse(left) <= Date.parse(right)
}
