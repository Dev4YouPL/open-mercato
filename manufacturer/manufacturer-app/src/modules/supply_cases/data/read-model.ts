import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { z } from 'zod'
import { calculatePlanCoverage, type PlanCoverage } from './coverage'
import type { SupplyCasesStore, StoreScope } from './repositories'
import type {
  InboundMessage,
  OutboundCorrelation,
  ProductionOrder,
  ProductionPlan,
  SupplyCase,
  SupplyCaseStatus,
  SupplyConfirmation,
  ConfirmationPlanContract,
} from './types'
import { planRiskStatusSchema, resolutionPlanSchema, supplyCaseStatusSchema } from './types'
import { initialOptionSchema } from './initial-impact'
import { evaluateConfirmationJoin } from '../lib/resolution/confirmationJoin'
import { parseConfirmationPlanContract } from '../lib/resolution/planContract'

const sortableFields = ['correlationId', 'status', 'sku', 'requiredDate', 'missingQuantity', 'riskStatus', 'updatedAt'] as const
const attentionFilters = ['decision_required', 'needs_attention', 'waiting_external', 'active', 'closed'] as const
const riskFilterSchema = z.union([planRiskStatusSchema, z.literal('NO_PLAN')])
const queryDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected a valid date filter',
})

export const supplyCaseListQuerySchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  q: z.string(),
  status: z.array(supplyCaseStatusSchema),
  riskStatus: z.array(riskFilterSchema),
  attention: z.enum(attentionFilters).nullable(),
  requiredFrom: queryDateSchema.nullable(),
  requiredTo: queryDateSchema.nullable(),
  supplierEmail: z.string().nullable(),
  sort: z.enum(sortableFields).nullable(),
  order: z.enum(['asc', 'desc']),
})

export type SupplyCaseListQuery = z.infer<typeof supplyCaseListQuerySchema>
export type SupplyCaseSortField = (typeof sortableFields)[number]
export type AttentionFilter = (typeof attentionFilters)[number]
export type AttentionGroup = 'decision_required' | 'needs_attention' | 'waiting_external' | 'processing' | 'closed'
export type CurrentWait =
  | 'decision'
  | 'analysis'
  | 'alternative_request'
  | 'alternative_offer'
  | 'confirmed_offer'
  | 'plan_acceptance'
  | 'confirmations'
  | 'resolution'
  | 'none'

const dataQualitySchema = z.enum(['complete', 'partial', 'degraded'])
const nextActionSchema = z.enum(['operator_decision', 'waiting_supplier', 'review_confirmations', 'apply_resolution', 'none'])
const liveEvidenceStatusSchema = z.enum(['available', 'pending', 'unavailable', 'invalid'])
const confirmationStatusSchema = z.enum(['pending', 'confirmed', 'mismatch', 'expired', 'delivery_failed'])

export const planCoverageSchema = z.object({
  requiredQuantity: z.number(),
  coveredQuantity: z.number(),
  missingQuantity: z.number(),
  isFullyCovered: z.boolean(),
  riskStatus: z.enum(['PROTECTED', 'AT_RISK', 'BREACHED']),
})

const productionOrderSummarySchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
})

const supplierCommitmentViewSchema = z.object({
  supplierEmail: z.string(),
  quantity: z.number(),
  deliveryDate: z.string(),
  status: z.enum(['PROPOSED', 'COMMITTED', 'CONFIRMED', 'CANCELLED']),
})

const productionOrderViewSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  productSku: z.string(),
  quantity: z.number(),
  materialSku: z.string(),
  materialQuantity: z.number(),
  dueDate: z.string(),
  customerName: z.string(),
  customerCommitmentDate: z.string(),
  status: z.string(),
})

const productionPlanViewSchema = z.object({
  id: z.string(),
  planNumber: z.string(),
  materialSku: z.string(),
  requiredQuantity: z.number(),
  requiredDate: z.string(),
  internalStockQuantity: z.number(),
  supplierCommitments: z.array(supplierCommitmentViewSchema),
  productionOrderIds: z.array(z.string()),
  persistedRiskStatus: z.string(),
})

const customerImpactSchema = z.object({
  status: z.enum(['on_time', 'at_risk', 'breached', 'unknown']),
  customerName: z.string().nullable(),
  commitmentDate: z.string().nullable(),
  earliestBreachDate: z.string().nullable(),
  affectedOrderIds: z.array(z.string()),
})

const supplierOfferLineSchema = z.object({
  quantity: z.number(),
  deliveryDate: z.string(),
  onTime: z.boolean(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  status: z.string(),
  evidenceRef: z.string().nullable(),
})

const supplierRealitySchema = z.object({
  role: z.enum(['SUPPLIER_1', 'SUPPLIER_2']),
  supplierEmail: z.string().nullable(),
  offerStatus: z.enum(['proposal', 'offer', 'confirmed', 'unavailable']),
  evidenceStatus: liveEvidenceStatusSchema,
  offerLines: z.array(supplierOfferLineSchema),
  lastUpdated: z.string().nullable(),
})

const liveRealitySchema = z.object({
  requiredQuantity: z.number(),
  onTimeQuantity: z.number(),
  lateQuantity: z.number(),
  missingQuantity: z.number(),
  riskStatus: z.union([planRiskStatusSchema, z.literal('NO_PLAN')]),
  asOf: z.string().nullable(),
  evidenceStatus: liveEvidenceStatusSchema,
})

const confirmationChecklistItemSchema = z.object({
  requirementId: z.string(),
  role: z.enum(['SUPPLIER_1', 'SUPPLIER_2']),
  supplierEmail: z.string().nullable(),
  quantity: z.number(),
  deliveryDate: z.string(),
  status: confirmationStatusSchema,
  evidenceRef: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  mismatchReason: z.string().nullable(),
})

const resolutionGateSchema = z.object({
  requiredQuantity: z.number(),
  coveredOnTime: z.number(),
  missingQuantity: z.number(),
  confirmationsComplete: z.boolean(),
  planApplicable: z.boolean(),
  riskStatus: z.union([planRiskStatusSchema, z.literal('NO_PLAN')]),
  caseStatus: z.string(),
  applyCompleted: z.boolean(),
  blockers: z.array(z.string()),
  isGreen: z.boolean(),
})

const timelineEventSchema = z.object({
  id: z.string(),
  type: z.enum(['case', 'message', 'outbound']),
  timestamp: z.string(),
  stage: z.string(),
  messageIntent: z.string().nullable(),
  senderEmail: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  body: z.string().nullable(),
})

const analysisProjectionSchema = z.object({
  available: z.boolean(),
  summary: z.string().nullable(),
  recommendedOptionId: z.string().nullable(),
  confidence: z.number().nullable(),
})

export const supplyCaseListItemSchema = z.object({
  id: z.string(),
  correlationId: z.string(),
  status: z.string(),
  needsAttentionReason: z.string().nullable(),
  sku: z.string(),
  requiredQuantity: z.number(),
  requiredDate: z.string(),
  productionOrders: z.array(productionOrderSummarySchema),
  planNumber: z.string().nullable(),
  coverage: planCoverageSchema.nullable(),
  baselineCoverage: planCoverageSchema.nullable(),
  liveCoverage: planCoverageSchema.nullable(),
  shortage: z.number(),
  customerImpact: z.enum(['on_time', 'at_risk', 'breached', 'unknown']),
  affectedOrderCount: z.number(),
  earliestCustomerCommitmentDate: z.string().nullable(),
  nextAction: nextActionSchema,
  dataQuality: dataQualitySchema,
  dataQualityReasons: z.array(z.string()),
  currentWait: z.string(),
  attentionGroup: z.string(),
  updatedAt: z.string(),
})

export const supplyCaseListResponseSchema = z.object({
  items: z.array(supplyCaseListItemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
})

export const supplyCaseDetailResponseSchema = z.object({
  case: z.object({
    id: z.string(),
    correlationId: z.string(),
    status: z.string(),
    needsAttentionReason: z.string().nullable(),
    sku: z.string(),
    requiredQuantity: z.number(),
    requiredDate: z.string(),
    supplier1Email: z.string().nullable(),
    supplier2Email: z.string().nullable(),
    productionOrderIds: z.array(z.string()),
    productionPlanId: z.string().nullable(),
    currency: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  productionOrders: z.array(productionOrderViewSchema),
  missingProductionOrderIds: z.array(z.string()),
  productionPlan: productionPlanViewSchema.nullable(),
  coverage: planCoverageSchema.nullable(),
  need: z.object({ sku: z.string(), requiredQuantity: z.number(), requiredDate: z.string() }),
  baseline: z.object({
    planNumber: z.string(),
    internalStockQuantity: z.number(),
    supplierCommitments: z.array(supplierCommitmentViewSchema),
    coverage: planCoverageSchema,
    persistedRiskStatus: z.string(),
  }).nullable(),
  baselineCoverage: planCoverageSchema.nullable(),
  liveReality: liveRealitySchema,
  liveCoverage: planCoverageSchema.nullable(),
  shortage: z.number(),
  suppliers: z.array(supplierRealitySchema),
  dataQuality: dataQualitySchema,
  dataQualityReasons: z.array(z.string()),
  customerImpact: customerImpactSchema,
  analyses: z.object({ initial: analysisProjectionSchema, final: analysisProjectionSchema }),
  proposals: z.object({
    initialOptionCount: z.number(),
    resolutionPlanCount: z.number(),
    initialProposalId: z.string().nullable(),
    factsHash: z.string().nullable(),
    selectedOptionId: z.string().nullable(),
    initialOptions: z.array(initialOptionSchema),
    resolutionProposalId: z.string().nullable(),
    resolutionFactsHash: z.string().nullable(),
    resolutionOfferHash: z.string().nullable(),
    resolutionPlans: z.array(resolutionPlanSchema),
    selectedResolutionPlanId: z.string().nullable(),
  }),
  confirmationChecklist: z.array(confirmationChecklistItemSchema),
  resolutionGate: resolutionGateSchema,
  timeline: z.array(timelineEventSchema),
  availableActions: z.array(z.enum([
    'apply_initial_sourcing_decision',
    'apply_resolution_decision',
    'retry_resolution_analysis',
    'retry_supplier_request',
    'retry_confirmation_wait',
  ])),
  updatedAt: z.string(),
})

export type SupplyCaseListItem = z.infer<typeof supplyCaseListItemSchema>
export type SupplyCaseListResponse = z.infer<typeof supplyCaseListResponseSchema>
export type SupplyCaseDetailResponse = z.infer<typeof supplyCaseDetailResponseSchema>

export function parseSupplyCaseListQuery(searchParams: URLSearchParams): SupplyCaseListQuery {
  const parseNullableDate = (value: string | null) => value && value.trim().length > 0 ? value : null
  return supplyCaseListQuerySchema.parse({
    page: Number(searchParams.get('page') ?? '1'),
    pageSize: Number(searchParams.get('pageSize') ?? '25'),
    q: searchParams.get('q')?.trim() ?? '',
    status: collectListValues(searchParams, 'status'),
    riskStatus: collectListValues(searchParams, 'riskStatus'),
    attention: parseNullableEnumValue(searchParams.get('attention')),
    requiredFrom: parseNullableDate(searchParams.get('requiredFrom')),
    requiredTo: parseNullableDate(searchParams.get('requiredTo')),
    supplierEmail: searchParams.get('supplierEmail')?.trim().toLowerCase() || null,
    sort: parseNullableEnumValue(searchParams.get('sort')),
    order: searchParams.get('order') ?? 'asc',
  })
}

function collectListValues(searchParams: URLSearchParams, key: string): string[] {
  return searchParams.getAll(key).flatMap((value) => parseCommaSeparatedList(value))
}

function parseNullableEnumValue(value: string | null): string | null {
  return value && value.trim().length > 0 ? value : null
}

export async function buildSupplyCaseList(
  store: SupplyCasesStore,
  scope: StoreScope,
  query: SupplyCaseListQuery,
): Promise<SupplyCaseListResponse> {
  const cases = await store.supplyCases.list(scope)
  const hydrated = await Promise.all(cases.map((supplyCase) => hydrateCase(store, scope, supplyCase)))
  const filtered = hydrated
    .filter((entry) => matchesQuery(entry, query))
    .sort((left, right) => compareHydratedCases(left, right, query))

  const total = filtered.length
  const start = (query.page - 1) * query.pageSize
  const items = filtered.slice(start, start + query.pageSize).map(toListItem)

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  }
}

export async function buildSupplyCaseDetail(
  store: SupplyCasesStore,
  scope: StoreScope,
  id: string,
  includeMessageContent: boolean,
): Promise<SupplyCaseDetailResponse | null> {
  const supplyCase = await store.supplyCases.findById(scope, id)
  if (!supplyCase) return null

  const entry = await hydrateCase(store, scope, supplyCase)
  return toDetail(entry, includeMessageContent)
}

type HydratedCase = {
  supplyCase: SupplyCase
  orders: ProductionOrder[]
  missingProductionOrderIds: string[]
  plan: ProductionPlan | null
  coverage: PlanCoverage | null
  messages: InboundMessage[]
  outboundCorrelations: OutboundCorrelation[]
  confirmations: SupplyConfirmation[]
}

type LiveCommitment = {
  quantity: number
  deliveryDate: string
  status: string
  evidenceRef: string | null
  price: number | null
  currency: string | null
}

type OperationalState = {
  baselineCoverage: PlanCoverage | null
  liveCoverage: PlanCoverage | null
  shortage: number
  liveReality: z.infer<typeof liveRealitySchema>
  suppliers: z.infer<typeof supplierRealitySchema>[]
  customerImpact: SupplyCaseDetailResponse['customerImpact']
  dataQuality: z.infer<typeof dataQualitySchema>
  dataQualityReasons: string[]
  nextAction: z.infer<typeof nextActionSchema>
  validResolutionPlans: z.infer<typeof resolutionPlanSchema>[]
  resolutionFactsHash: string | null
  resolutionOfferHash: string | null
  confirmationChecklist: z.infer<typeof confirmationChecklistItemSchema>[]
  resolutionGate: z.infer<typeof resolutionGateSchema>
}

async function hydrateCase(store: SupplyCasesStore, scope: StoreScope, supplyCase: SupplyCase): Promise<HydratedCase> {
  const orderResults = await Promise.all(supplyCase.productionOrderIds.map((id) => store.productionOrders.findById(scope, id)))
  const orders = orderResults.filter((order): order is ProductionOrder => order !== null)
  const missingProductionOrderIds = supplyCase.productionOrderIds.filter((id) => !orders.some((order) => order.id === id))
  const plan = supplyCase.productionPlanId
    ? await store.productionPlans.findById(scope, supplyCase.productionPlanId)
    : null
  const [messages, outboundCorrelations, confirmations] = await Promise.all([
    store.inboundMessages.list(scope, { where: { caseId: supplyCase.id } }),
    store.outboundCorrelations.list(scope, { where: { caseId: supplyCase.id } }),
    store.supplyConfirmations.findByCaseId(scope, supplyCase.id),
  ])

  return {
    supplyCase,
    orders,
    missingProductionOrderIds,
    plan,
    coverage: plan ? calculatePlanCoverage(plan) : null,
    messages,
    outboundCorrelations,
    confirmations,
  }
}

function matchesQuery(entry: HydratedCase, query: SupplyCaseListQuery): boolean {
  const { supplyCase, orders, plan } = entry
  const operational = buildOperationalState(entry)
  if (query.status.length > 0 && !query.status.includes(supplyCase.status)) return false

  const riskStatus = operational.liveCoverage?.riskStatus ?? 'NO_PLAN'
  if (query.riskStatus.length > 0 && !query.riskStatus.includes(riskStatus)) return false

  const group = getAttentionGroup(supplyCase.status, supplyCase.needsAttentionReason)
  if (query.attention === 'active' && group === 'closed') return false
  if (query.attention === 'closed' && group !== 'closed') return false
  if (query.attention && !['active', 'closed'].includes(query.attention) && group !== query.attention) return false

  const requiredTime = Date.parse(supplyCase.requiredDate)
  if (query.requiredFrom && requiredTime < Date.parse(query.requiredFrom)) return false
  if (query.requiredTo && requiredTime > Date.parse(query.requiredTo)) return false

  const supplierEmails = [supplyCase.supplier1Email, supplyCase.supplier2Email, ...(plan?.supplierCommitments.map((commitment) => commitment.supplierEmail) ?? [])]
    .filter((email): email is string => email !== null)
  if (query.supplierEmail && !supplierEmails.some((email) => email.toLowerCase().includes(query.supplierEmail as string))) return false

  if (!query.q) return true
  const haystack = [
    supplyCase.correlationId,
    supplyCase.sku,
    ...orders.map((order) => order.orderNumber),
    ...supplierEmails,
  ].join(' ').toLowerCase()
  return haystack.includes(query.q.toLowerCase())
}

function compareHydratedCases(left: HydratedCase, right: HydratedCase, query: SupplyCaseListQuery): number {
  if (!query.sort) {
    return compareValues(
      [getAttentionRank(left.supplyCase.status, left.supplyCase.needsAttentionReason), left.supplyCase.requiredDate, right.supplyCase.updatedAt],
      [getAttentionRank(right.supplyCase.status, right.supplyCase.needsAttentionReason), right.supplyCase.requiredDate, left.supplyCase.updatedAt],
    ) || left.supplyCase.correlationId.localeCompare(right.supplyCase.correlationId)
  }

  const leftValue = getSortValue(left, query.sort)
  const rightValue = getSortValue(right, query.sort)
  const result = compareNullableValues(leftValue, rightValue)
  return (query.order === 'desc' ? -result : result) || left.supplyCase.correlationId.localeCompare(right.supplyCase.correlationId)
}

function compareValues(left: Array<number | string>, right: Array<number | string>): number {
  for (let index = 0; index < left.length; index += 1) {
    const result = typeof left[index] === 'number' && typeof right[index] === 'number'
      ? (left[index] as number) - (right[index] as number)
      : String(left[index]).localeCompare(String(right[index]))
    if (result !== 0) return result
  }
  return 0
}

function compareNullableValues(left: number | string | null, right: number | string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))
}

function getSortValue(entry: HydratedCase, field: SupplyCaseSortField): number | string | null {
  switch (field) {
    case 'correlationId': return entry.supplyCase.correlationId
    case 'status': return entry.supplyCase.status
    case 'sku': return entry.supplyCase.sku
    case 'requiredDate': return entry.supplyCase.requiredDate
    case 'missingQuantity': return buildOperationalState(entry).liveCoverage?.missingQuantity ?? null
    case 'riskStatus': return buildOperationalState(entry).liveCoverage?.riskStatus ?? 'NO_PLAN'
    case 'updatedAt': return entry.supplyCase.updatedAt
  }
}

function toListItem(entry: HydratedCase): SupplyCaseListItem {
  const { supplyCase, orders } = entry
  const operational = buildOperationalState(entry)
  return {
    id: supplyCase.id,
    correlationId: supplyCase.correlationId,
    status: supplyCase.status,
    needsAttentionReason: supplyCase.needsAttentionReason,
    sku: supplyCase.sku,
    requiredQuantity: supplyCase.requiredQuantity,
    requiredDate: supplyCase.requiredDate,
    productionOrders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber })),
    planNumber: entry.plan?.planNumber ?? null,
    coverage: operational.baselineCoverage,
    baselineCoverage: operational.baselineCoverage,
    liveCoverage: operational.liveCoverage,
    shortage: operational.shortage,
    customerImpact: operational.customerImpact.status,
    affectedOrderCount: orders.length,
    earliestCustomerCommitmentDate: operational.customerImpact.commitmentDate,
    nextAction: operational.nextAction,
    dataQuality: operational.dataQuality,
    dataQualityReasons: operational.dataQualityReasons,
    currentWait: getCurrentWait(supplyCase.status),
    attentionGroup: getAttentionGroup(supplyCase.status, supplyCase.needsAttentionReason),
    updatedAt: supplyCase.updatedAt,
  }
}

function toDetail(entry: HydratedCase, includeMessageContent: boolean): SupplyCaseDetailResponse {
  const { supplyCase, orders, missingProductionOrderIds, plan, messages, outboundCorrelations } = entry
  const operational = buildOperationalState(entry)
  const initialOptions = readArray(supplyCase.initialOptions)

  return {
    case: {
      id: supplyCase.id,
      correlationId: supplyCase.correlationId,
      status: supplyCase.status,
      needsAttentionReason: supplyCase.needsAttentionReason,
      sku: supplyCase.sku,
      requiredQuantity: supplyCase.requiredQuantity,
      requiredDate: supplyCase.requiredDate,
      supplier1Email: supplyCase.supplier1Email,
      supplier2Email: supplyCase.supplier2Email,
      productionOrderIds: supplyCase.productionOrderIds,
      productionPlanId: supplyCase.productionPlanId,
      currency: supplyCase.currency,
      createdAt: supplyCase.createdAt,
      updatedAt: supplyCase.updatedAt,
    },
    productionOrders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      productSku: order.productSku,
      quantity: order.quantity,
      materialSku: order.materialSku,
      materialQuantity: order.materialQuantity,
      dueDate: order.dueDate,
      customerName: order.customerName,
      customerCommitmentDate: order.customerCommitmentDate,
      status: order.status,
    })),
    missingProductionOrderIds,
    productionPlan: plan ? {
      id: plan.id,
      planNumber: plan.planNumber,
      materialSku: plan.materialSku,
      requiredQuantity: plan.requiredQuantity,
      requiredDate: plan.requiredDate,
      internalStockQuantity: plan.internalStockQuantity,
      supplierCommitments: plan.supplierCommitments,
      productionOrderIds: plan.productionOrderIds,
      persistedRiskStatus: plan.riskStatus,
    } : null,
    coverage: operational.baselineCoverage,
    need: {
      sku: supplyCase.sku,
      requiredQuantity: supplyCase.requiredQuantity,
      requiredDate: supplyCase.requiredDate,
    },
    baseline: plan ? {
      planNumber: plan.planNumber,
      internalStockQuantity: plan.internalStockQuantity,
      supplierCommitments: plan.supplierCommitments,
      coverage: operational.baselineCoverage as PlanCoverage,
      persistedRiskStatus: plan.riskStatus,
    } : null,
    baselineCoverage: operational.baselineCoverage,
    liveReality: operational.liveReality,
    liveCoverage: operational.liveCoverage,
    shortage: operational.shortage,
    suppliers: operational.suppliers,
    dataQuality: operational.dataQuality,
    dataQualityReasons: operational.dataQualityReasons,
    customerImpact: operational.customerImpact,
    analyses: {
      initial: projectAnalysis(supplyCase.initialAnalysis),
      final: projectAnalysis(supplyCase.finalAnalysis),
    },
    proposals: {
      initialOptionCount: initialOptions.length,
      resolutionPlanCount: readArray(supplyCase.resolutionPlans).length,
      initialProposalId: supplyCase.initialProposalId,
      factsHash: supplyCase.initialFactsHash,
      selectedOptionId: supplyCase.selectedInitialOptionId,
      initialOptions: initialOptions.flatMap((option) => {
        const parsed = initialOptionSchema.safeParse(option)
        return parsed.success ? [parsed.data] : []
      }),
      resolutionProposalId: null,
      resolutionFactsHash: operational.resolutionFactsHash,
      resolutionOfferHash: operational.resolutionOfferHash,
      resolutionPlans: operational.validResolutionPlans,
      selectedResolutionPlanId: supplyCase.selectedResolutionPlanId,
    },
    confirmationChecklist: operational.confirmationChecklist,
    resolutionGate: operational.resolutionGate,
    timeline: buildTimeline(supplyCase, messages, outboundCorrelations, includeMessageContent),
    availableActions: supplyCase.status === 'AWAITING_SOURCING_DECISION'
      && supplyCase.initialProposalId !== null
      && supplyCase.initialFactsHash !== null
      ? ['apply_initial_sourcing_decision']
      : [],
    updatedAt: supplyCase.updatedAt,
  }
}

function buildOperationalState(entry: HydratedCase): OperationalState {
  const { supplyCase, orders, missingProductionOrderIds, plan, messages, confirmations } = entry
  const baselineCoverage = plan ? calculatePlanCoverage(plan) : null
  const validResolutionPlans = readArray(supplyCase.resolutionPlans).flatMap((value) => {
    const parsed = resolutionPlanSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  const resolutionPlanData = readArray(supplyCase.resolutionPlans)
  const finalAnalysis = supplyCase.finalAnalysis
  const resolutionFactsHash = finalAnalysis && typeof finalAnalysis === 'object' && !Array.isArray(finalAnalysis) && typeof finalAnalysis.finalFactsHash === 'string'
    ? finalAnalysis.finalFactsHash
    : null
  const resolutionOfferHash = finalAnalysis && typeof finalAnalysis === 'object' && !Array.isArray(finalAnalysis) && typeof finalAnalysis.offerHash === 'string'
    ? finalAnalysis.offerHash
    : supplyCase.alternativeOffer?.offerHash ?? null

  const shouldReadConfirmationPlan = supplyCase.selectedResolutionPlanId !== null
    || ['WAITING_FOR_SUPPLIER_CONFIRMATIONS', 'APPLYING_RESOLUTION', 'RESOLVED'].includes(supplyCase.status)
  const confirmationPlanResult = shouldReadConfirmationPlan
    ? parseConfirmationPlanContract(supplyCase.pendingResolutionPlan)
    : { ok: false as const, reason: 'PLAN_MISSING' as const }
  const confirmationPlan = confirmationPlanResult.ok ? confirmationPlanResult.plan : null
  const planForLiveReality = confirmationPlan && confirmationPlanResult.ok ? confirmationPlan : null
  const supplier1Commitments = readSupplier1Commitments(supplyCase, messages)
  const supplier2Commitments = supplyCase.alternativeOffer?.commitments.map((commitment) => ({
    quantity: commitment.quantity,
    deliveryDate: commitment.date,
    status: 'OFFERED',
    evidenceRef: `${supplyCase.alternativeOffer?.sourceInboundMessageId}:${supplyCase.alternativeOffer?.sourceRfcMessageId}`,
    price: supplyCase.alternativeOffer?.priceTotal.amount ?? null,
    currency: supplyCase.alternativeOffer?.priceTotal.currency ?? null,
  })) ?? []
  const liveCommitments = buildLiveCommitments(
    supplier1Commitments,
    planForLiveReality,
    confirmations,
  )
  const liveStock = supplyCase.status === 'RESOLVED' || supplyCase.status === 'APPLYING_RESOLUTION'
    ? planForLiveReality?.internalStockAllocation ?? 0
    : 0
  const liveCoverage = plan ? calculateOperationalCoverage(
    supplyCase.requiredQuantity,
    supplyCase.requiredDate,
    liveCommitments,
    liveStock,
  ) : null
  const customerImpact = getCustomerImpact(orders, supplyCase, liveCoverage)
  const confirmationChecklist = buildConfirmationChecklist(supplyCase, confirmationPlan, confirmations)
  const confirmationJoin = confirmationPlan
    ? evaluateConfirmationJoin(
      confirmationPlan.requiredConfirmations,
      confirmations.filter((confirmation) => confirmation.planHash === confirmationPlan.planHash),
    )
    : null
  const selectedResolutionPlan = validResolutionPlans.find((resolutionPlan) => resolutionPlan.id === supplyCase.selectedResolutionPlanId) ?? null
  const planApplicable = Boolean(
    selectedResolutionPlan
      && confirmationPlan
      && selectedResolutionPlan.planHash === confirmationPlan.planHash
      && selectedResolutionPlan.feasibility === 'FEASIBLE',
  )
  const confirmationsComplete = confirmationJoin === 'COMPLETE'
  const blockers: string[] = []
  if (!plan) blockers.push('missing_plan')
  if (missingProductionOrderIds.length > 0) blockers.push('missing_production_order')
  if (supplier1Commitments.length === 0) blockers.push('missing_supplier_proposal')
  if (resolutionPlanData.length > 0 && validResolutionPlans.length !== 3) blockers.push('invalid_resolution_plans')
  if (shouldReadConfirmationPlan && !confirmationPlan) blockers.push('invalid_confirmation_plan')
  if (liveCoverage && liveCoverage.missingQuantity > 0) blockers.push('live_shortage')
  if (supplyCase.selectedResolutionPlanId === null && supplyCase.status !== 'RESOLVED') blockers.push('resolution_plan_not_selected')
  if (supplyCase.selectedResolutionPlanId !== null && !planApplicable) blockers.push('resolution_plan_unavailable')
  if (confirmationPlan && !confirmationsComplete) blockers.push(confirmationJoin === 'BLOCKED' ? 'confirmation_mismatch' : 'confirmations_pending')
  if (supplyCase.status !== 'RESOLVED') blockers.push('apply_not_completed')
  const isGreen = Boolean(
    liveCoverage?.isFullyCovered
      && liveCoverage.riskStatus === 'PROTECTED'
      && confirmationsComplete
      && planApplicable
      && supplyCase.status === 'RESOLVED'
      && supplyCase.resolvedAt,
  )
  const structuralReasons = blockers.filter((reason) => ['missing_plan', 'missing_production_order', 'invalid_resolution_plans', 'invalid_confirmation_plan'].includes(reason))
  const evidenceReasons = blockers.filter((reason) => ['missing_supplier_proposal'].includes(reason))
  const dataQualityReasons = [...new Set([...structuralReasons, ...evidenceReasons])]
  const dataQuality = structuralReasons.length > 0 ? 'degraded' : evidenceReasons.length > 0 ? 'partial' : 'complete'
  const liveReality = buildLiveReality(supplyCase, liveCommitments, liveCoverage, messages)

  return {
    baselineCoverage,
    liveCoverage,
    shortage: liveCoverage?.missingQuantity ?? supplyCase.requiredQuantity,
    liveReality,
    suppliers: [
      buildSupplierReality('SUPPLIER_1', supplyCase.supplier1Email, supplyCase.requiredDate, supplier1Commitments, supplier1Commitments.length > 0 ? 'proposal' : 'unavailable', messages),
      buildSupplierReality('SUPPLIER_2', supplyCase.supplier2Email, supplyCase.requiredDate, supplier2Commitments, supplyCase.alternativeOffer ? 'offer' : 'unavailable', messages),
    ],
    customerImpact,
    dataQuality,
    dataQualityReasons,
    nextAction: getNextAction(supplyCase.status),
    validResolutionPlans,
    resolutionFactsHash,
    resolutionOfferHash,
    confirmationChecklist,
    resolutionGate: {
      requiredQuantity: supplyCase.requiredQuantity,
      coveredOnTime: liveCoverage?.coveredQuantity ?? 0,
      missingQuantity: liveCoverage?.missingQuantity ?? supplyCase.requiredQuantity,
      confirmationsComplete,
      planApplicable,
      riskStatus: liveCoverage?.riskStatus ?? 'NO_PLAN',
      caseStatus: supplyCase.status,
      applyCompleted: supplyCase.status === 'RESOLVED' && supplyCase.resolvedAt !== null,
      blockers: [...new Set(blockers)],
      isGreen,
    },
  }
}

function calculateOperationalCoverage(
  requiredQuantity: number,
  requiredDate: string,
  commitments: LiveCommitment[],
  internalStockQuantity: number,
): PlanCoverage {
  const requiredAt = Date.parse(requiredDate)
  const onTimeCommitted = commitments
    .filter((commitment) => !['CANCELLED', 'CANCEL'].includes(commitment.status))
    .filter((commitment) => Date.parse(commitment.deliveryDate) <= requiredAt)
    .reduce((total, commitment) => total + commitment.quantity, 0)
  const coveredQuantity = Math.min(internalStockQuantity + onTimeCommitted, requiredQuantity)
  const missingQuantity = Math.max(requiredQuantity - coveredQuantity, 0)
  return {
    requiredQuantity,
    coveredQuantity,
    missingQuantity,
    isFullyCovered: missingQuantity === 0,
    riskStatus: coveredQuantity >= requiredQuantity ? 'PROTECTED' : coveredQuantity > 0 ? 'AT_RISK' : 'BREACHED',
  }
}

function buildLiveCommitments(
  supplier1Commitments: LiveCommitment[],
  confirmationPlan: ConfirmationPlanContract | null,
  confirmations: SupplyConfirmation[],
): LiveCommitment[] {
  if (!confirmationPlan) return supplier1Commitments

  const matchedConfirmations = new Map(
    confirmations
      .filter((confirmation) => confirmation.planHash === confirmationPlan.planHash && confirmation.verdict === 'MATCHES_PLAN')
      .map((confirmation) => [confirmation.role, confirmation]),
  )
  const supplier1Confirmation = matchedConfirmations.get('SUPPLIER_1')
  const supplier2Confirmation = matchedConfirmations.get('SUPPLIER_2')
  const confirmedSupplier1 = supplier1Confirmation
    ? supplier1Confirmation.confirmedCommitments.map((commitment) => ({
      quantity: commitment.quantity,
      deliveryDate: commitment.date,
      status: 'CONFIRMED',
      evidenceRef: `${supplier1Confirmation.inboundMessageId}:${supplier1Confirmation.rfcMessageId}`,
      price: null,
      currency: null,
    }))
    : supplier1Commitments
  const confirmedSupplier2 = supplier2Confirmation
    ? supplier2Confirmation.confirmedCommitments.map((commitment) => ({
      quantity: commitment.quantity,
      deliveryDate: commitment.date,
      status: 'CONFIRMED',
      evidenceRef: `${supplier2Confirmation.inboundMessageId}:${supplier2Confirmation.rfcMessageId}`,
      price: null,
      currency: null,
    }))
    : []

  return [...confirmedSupplier1, ...confirmedSupplier2]
}

function readSupplier1Commitments(supplyCase: SupplyCase, messages: InboundMessage[]): LiveCommitment[] {
  const proposal = asRecord(supplyCase.supplier1Proposal)
  const deliveries = proposal?.deliveries
  if (!Array.isArray(deliveries)) return []
  const evidence = messages.find((message) => message.messageIntent === 'SUPPLY_PROPOSAL' && message.senderEmail === supplyCase.supplier1Email)
  const evidenceRef = evidence ? `${evidence.id}:${evidence.rfcMessageId}` : null
  return deliveries.flatMap((delivery) => {
    const record = asRecord(delivery)
    if (!record || typeof record.quantity !== 'number' || typeof record.deliveryDate !== 'string') return []
    if (!Number.isFinite(record.quantity) || record.quantity <= 0 || Number.isNaN(Date.parse(record.deliveryDate))) return []
    return [{ quantity: record.quantity, deliveryDate: record.deliveryDate, status: 'PROPOSED', evidenceRef, price: null, currency: null }]
  })
}

function buildSupplierReality(
  role: 'SUPPLIER_1' | 'SUPPLIER_2',
  supplierEmail: string | null,
  requiredDate: string,
  commitments: LiveCommitment[],
  offerStatus: 'proposal' | 'offer' | 'confirmed' | 'unavailable',
  messages: InboundMessage[],
): z.infer<typeof supplierRealitySchema> {
  const evidenceStatus = commitments.length > 0 ? 'available' : supplierEmail ? 'pending' : 'unavailable'
  const lastMessage = messages
    .filter((message) => supplierEmail !== null && message.senderEmail === supplierEmail)
    .sort((left, right) => (right.receivedAt ?? right.createdAt).localeCompare(left.receivedAt ?? left.createdAt))[0]
  return {
    role,
    supplierEmail,
    offerStatus,
    evidenceStatus,
    offerLines: commitments.map((commitment) => ({
      quantity: commitment.quantity,
      deliveryDate: commitment.deliveryDate,
      onTime: Date.parse(commitment.deliveryDate) <= Date.parse(requiredDate),
      price: commitment.price,
      currency: commitment.currency,
      status: commitment.status,
      evidenceRef: commitment.evidenceRef,
    })),
    lastUpdated: lastMessage ? (lastMessage.receivedAt ?? lastMessage.createdAt) : null,
  }
}

function buildLiveReality(
  supplyCase: SupplyCase,
  commitments: LiveCommitment[],
  coverage: PlanCoverage | null,
  messages: InboundMessage[],
): z.infer<typeof liveRealitySchema> {
  const requiredAt = Date.parse(supplyCase.requiredDate)
  const lateQuantity = commitments
    .filter((commitment) => Date.parse(commitment.deliveryDate) > requiredAt)
    .reduce((total, commitment) => total + commitment.quantity, 0)
  const evidenceDates = messages.map((message) => message.receivedAt ?? message.createdAt)
  const asOf = [...evidenceDates, supplyCase.alternativeOffer?.recordedAt ?? null]
    .filter((value): value is string => value !== null)
    .sort((left, right) => right.localeCompare(left))[0] ?? null
  return {
    requiredQuantity: supplyCase.requiredQuantity,
    onTimeQuantity: coverage?.coveredQuantity ?? 0,
    lateQuantity,
    missingQuantity: coverage?.missingQuantity ?? supplyCase.requiredQuantity,
    riskStatus: coverage?.riskStatus ?? 'NO_PLAN',
    asOf,
    evidenceStatus: commitments.length > 0 ? 'available' : 'unavailable',
  }
}

function buildConfirmationChecklist(
  supplyCase: SupplyCase,
  plan: ConfirmationPlanContract | null,
  confirmations: SupplyConfirmation[],
): z.infer<typeof confirmationChecklistItemSchema>[] {
  if (!plan) return []
  return plan.requiredConfirmations.flatMap((role) => {
    const roleCommitments = plan.supplierCommitments.filter((commitment) => commitment.role === role && commitment.intent === 'COMMIT')
    const confirmation = confirmations.find((candidate) => candidate.planHash === plan.planHash && candidate.role === role)
    return roleCommitments.map((commitment, index) => ({
      requirementId: `${plan.planHash}:${role}:${index}`,
      role,
      supplierEmail: commitment.supplierEmail || (role === 'SUPPLIER_1' ? supplyCase.supplier1Email : supplyCase.supplier2Email),
      quantity: commitment.quantity,
      deliveryDate: commitment.deliveryDate,
      status: confirmation
        ? confirmation.verdict === 'MATCHES_PLAN' ? 'confirmed' as const : 'mismatch' as const
        : supplyCase.needsAttentionReason === 'WAIT_TIMEOUT' ? 'expired' as const
          : supplyCase.needsAttentionReason === 'DELIVERY_FAILED' ? 'delivery_failed' as const
            : 'pending' as const,
      evidenceRef: confirmation ? `${confirmation.inboundMessageId}:${confirmation.rfcMessageId}` : null,
      confirmedAt: confirmation?.createdAt ?? null,
      expiresAt: null,
      mismatchReason: confirmation?.mismatchReasons[0] ?? null,
    }))
  })
}

function getNextAction(status: SupplyCaseStatus): z.infer<typeof nextActionSchema> {
  if (['AWAITING_SOURCING_DECISION', 'AWAITING_RESOLUTION_APPROVAL'].includes(status)) return 'operator_decision'
  if (['WAITING_FOR_ALTERNATIVE_OFFER', 'ANALYZING_CONFIRMED_OFFER'].includes(status)) return 'waiting_supplier'
  if (status === 'WAITING_FOR_SUPPLIER_CONFIRMATIONS') return 'review_confirmations'
  if (status === 'APPLYING_RESOLUTION') return 'apply_resolution'
  return 'none'
}

function getCustomerImpact(orders: ProductionOrder[], supplyCase: SupplyCase, coverage: PlanCoverage | null): SupplyCaseDetailResponse['customerImpact'] {
  const firstOrder = orders[0]
  const snapshot = asRecord(supplyCase.customerCommitmentSnapshot)
  const customerName = firstOrder?.customerName ?? (snapshot ? readString(snapshot, 'customerName') : null)
  const commitmentDate = firstOrder?.customerCommitmentDate ?? (snapshot ? readString(snapshot, 'commitmentDate') : null)
  const affectedOrderIds = orders.filter((order) => !coverage?.isFullyCovered || Date.parse(order.dueDate) > Date.parse(order.customerCommitmentDate)).map((order) => order.id)
  const earliestBreachDate = orders
    .filter((order) => !coverage?.isFullyCovered && Date.parse(order.dueDate) > Date.parse(order.customerCommitmentDate))
    .map((order) => order.customerCommitmentDate)
    .sort()[0] ?? null
  if (!coverage || !commitmentDate) return { status: 'unknown', customerName, commitmentDate, earliestBreachDate, affectedOrderIds }
  if (Date.parse(supplyCase.requiredDate) > Date.parse(commitmentDate)) return { status: 'breached', customerName, commitmentDate, earliestBreachDate: commitmentDate, affectedOrderIds }
  return { status: coverage.isFullyCovered ? 'on_time' : 'at_risk', customerName, commitmentDate, earliestBreachDate, affectedOrderIds }
}

function projectAnalysis(value: SupplyCase['initialAnalysis']): z.infer<typeof analysisProjectionSchema> {
  if (value === null) return { available: false, summary: null, recommendedOptionId: null, confidence: null }
  const record = asRecord(value)
  const advisor = record ? asRecord(record.advisor) : null
  return {
    available: true,
    summary: advisor ? readString(advisor, 'summary') : null,
    recommendedOptionId: advisor ? readString(advisor, 'recommendedOptionId') : null,
    confidence: advisor && typeof advisor.confidence === 'number' ? advisor.confidence : null,
  }
}

function buildTimeline(
  supplyCase: SupplyCase,
  messages: InboundMessage[],
  outboundCorrelations: OutboundCorrelation[],
  includeMessageContent: boolean,
): SupplyCaseDetailResponse['timeline'] {
  const events: SupplyCaseDetailResponse['timeline'] = [{
    id: `${supplyCase.id}:created`,
    type: 'case',
    timestamp: supplyCase.createdAt,
    stage: 'case_created',
    messageIntent: null,
    senderEmail: null,
    recipientEmail: null,
    body: null,
  }]

  for (const message of messages) {
    events.push({
      id: message.id,
      type: 'message',
      timestamp: message.receivedAt ?? message.createdAt,
      stage: 'inbound_message',
      messageIntent: message.messageIntent,
      senderEmail: includeMessageContent ? message.senderEmail : null,
      recipientEmail: includeMessageContent ? message.recipientEmail : null,
      body: includeMessageContent ? message.sanitizedBody : null,
    })
  }

  for (const correlation of outboundCorrelations) {
    events.push({
      id: correlation.id,
      type: 'outbound',
      timestamp: correlation.createdAt,
      stage: 'outbound_message',
      messageIntent: correlation.phase,
      senderEmail: null,
      recipientEmail: includeMessageContent ? correlation.recipientEmail : null,
      body: null,
    })
  }

  if (supplyCase.updatedAt !== supplyCase.createdAt) {
    events.push({
      id: `${supplyCase.id}:updated:${supplyCase.updatedAt}`,
      type: 'case',
      timestamp: supplyCase.updatedAt,
      stage: 'case_updated',
      messageIntent: null,
      senderEmail: null,
      recipientEmail: null,
      body: null,
    })
  }

  return events.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id))
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null
}

function getAttentionGroup(status: SupplyCaseStatus, reason: SupplyCase['needsAttentionReason']): AttentionGroup {
  if (reason || status === 'NEEDS_ATTENTION') return 'needs_attention'
  if (['RESOLVED', 'REJECTED', 'CANCELLED'].includes(status)) return 'closed'
  if (['AWAITING_SOURCING_DECISION', 'AWAITING_RESOLUTION_APPROVAL'].includes(status)) return 'decision_required'
  if (['WAITING_FOR_ALTERNATIVE_OFFER', 'WAITING_FOR_SUPPLIER_CONFIRMATIONS'].includes(status)) return 'waiting_external'
  return 'processing'
}

function getAttentionRank(status: SupplyCaseStatus, reason: SupplyCase['needsAttentionReason']): number {
  const group = getAttentionGroup(status, reason)
  return { needs_attention: 0, decision_required: 1, waiting_external: 2, processing: 3, closed: 4 }[group]
}

function getCurrentWait(status: SupplyCaseStatus): CurrentWait {
  const waitByStatus: Partial<Record<SupplyCaseStatus, CurrentWait>> = {
    RECEIVED: 'analysis',
    ANALYZING_INITIAL_IMPACT: 'analysis',
    AWAITING_SOURCING_DECISION: 'decision',
    SENDING_ALTERNATIVE_REQUEST: 'alternative_request',
    WAITING_FOR_ALTERNATIVE_OFFER: 'alternative_offer',
    ANALYZING_CONFIRMED_OFFER: 'confirmed_offer',
    AWAITING_RESOLUTION_APPROVAL: 'decision',
    SENDING_PLAN_ACCEPTANCE: 'plan_acceptance',
    WAITING_FOR_SUPPLIER_CONFIRMATIONS: 'confirmations',
    APPLYING_RESOLUTION: 'resolution',
  }
  return waitByStatus[status] ?? 'none'
}
