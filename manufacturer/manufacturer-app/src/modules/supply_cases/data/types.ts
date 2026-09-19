import { z } from 'zod'
import { extractedCommitmentSchema, inboundSignalSchema, messageIntentSchema } from './inbound-signal'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO 8601 date-time string',
})

const identifierSchema = z.string().min(1)

const scopeShape = {
  tenantId: identifierSchema,
  organizationId: identifierSchema,
}

export const storeScopeSchema = z.object(scopeShape)
export type StoreScope = z.infer<typeof storeScopeSchema>

export const productionOrderStatusSchema = z.enum([
  'PLANNED',
  'RELEASED',
  'AT_RISK',
  'PROTECTED',
  'COMPLETED',
  'CANCELLED',
])
export type ProductionOrderStatus = z.infer<typeof productionOrderStatusSchema>

export const productionOrderSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  orderNumber: identifierSchema,
  productSku: identifierSchema,
  quantity: z.number().nonnegative(),
  materialSku: identifierSchema,
  materialQuantity: z.number().nonnegative(),
  dueDate: isoDateTimeSchema,
  customerName: z.string().min(1),
  customerCommitmentDate: isoDateTimeSchema,
  status: productionOrderStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type ProductionOrder = z.infer<typeof productionOrderSchema>

export const productionOrderCreateSchema = productionOrderSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true, updatedAt: true, deletedAt: true })
  .partial({ id: true, status: true })
export type ProductionOrderCreateInput = z.infer<typeof productionOrderCreateSchema>

export const productionOrderUpdateSchema = productionOrderCreateSchema
  .omit({ id: true, orderNumber: true })
  .partial()
export type ProductionOrderUpdateInput = z.infer<typeof productionOrderUpdateSchema>

export const supplierCommitmentStatusSchema = z.enum(['PROPOSED', 'COMMITTED', 'CONFIRMED', 'CANCELLED'])
export type SupplierCommitmentStatus = z.infer<typeof supplierCommitmentStatusSchema>

export const supplierCommitmentSchema = z.object({
  supplierEmail: z.string().min(1),
  quantity: z.number().nonnegative(),
  deliveryDate: isoDateTimeSchema,
  status: supplierCommitmentStatusSchema,
})
export type SupplierCommitment = z.infer<typeof supplierCommitmentSchema>

export const planRiskStatusSchema = z.enum(['PROTECTED', 'AT_RISK', 'BREACHED'])
export type PlanRiskStatus = z.infer<typeof planRiskStatusSchema>

export const productionPlanSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  planNumber: identifierSchema,
  materialSku: identifierSchema,
  requiredQuantity: z.number().nonnegative(),
  requiredDate: isoDateTimeSchema,
  internalStockQuantity: z.number().nonnegative(),
  supplierCommitments: z.array(supplierCommitmentSchema),
  productionOrderIds: z.array(identifierSchema),
  riskStatus: planRiskStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type ProductionPlan = z.infer<typeof productionPlanSchema>

export const productionPlanCreateSchema = productionPlanSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true, updatedAt: true, deletedAt: true })
  .partial({
    id: true,
    internalStockQuantity: true,
    supplierCommitments: true,
    productionOrderIds: true,
    riskStatus: true,
  })
export type ProductionPlanCreateInput = z.infer<typeof productionPlanCreateSchema>

export const productionPlanUpdateSchema = productionPlanCreateSchema.omit({ id: true, planNumber: true }).partial()
export type ProductionPlanUpdateInput = z.infer<typeof productionPlanUpdateSchema>

export const supplyCaseStatusSchema = z.enum([
  'RECEIVED',
  'ANALYZING_INITIAL_IMPACT',
  'AWAITING_SOURCING_DECISION',
  'SENDING_ALTERNATIVE_REQUEST',
  'WAITING_FOR_ALTERNATIVE_OFFER',
  'ANALYZING_CONFIRMED_OFFER',
  'AWAITING_RESOLUTION_APPROVAL',
  'SENDING_PLAN_ACCEPTANCE',
  'WAITING_FOR_SUPPLIER_CONFIRMATIONS',
  'APPLYING_RESOLUTION',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
  'NEEDS_ATTENTION',
])
export type SupplyCaseStatus = z.infer<typeof supplyCaseStatusSchema>

export const needsAttentionReasonSchema = z.enum([
  'WAIT_TIMEOUT',
  'DELIVERY_FAILED',
  'CONFIRMATION_MISMATCH',
  'MISSING_DATA',
  'ANALYSIS_FAILED',
  'STALE_DECISION',
  'OFFER_INVALID',
  'OFFER_CONFLICT',
  'DECISION_UNAUTHORIZED',
])
export type NeedsAttentionReason = z.infer<typeof needsAttentionReasonSchema>

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return parsed.toISOString().slice(0, 10) === value
}, '[internal] Expected a valid calendar date')

export const alternativeOfferCommitmentSchema = z.object({
  quantity: z.number().int().positive(),
  date: calendarDateSchema,
}).strict()
export type AlternativeOfferCommitment = z.infer<typeof alternativeOfferCommitmentSchema>

export const alternativeOfferPriceSchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict()

export const alternativeOfferSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  supplierId: identifierSchema,
  sku: identifierSchema,
  sourceInboundMessageId: identifierSchema,
  sourceRfcMessageId: identifierSchema,
  sourceOutboundCorrelationId: identifierSchema,
  requestedQuantity: z.number().int().positive(),
  offeredQuantity: z.number().int().positive(),
  commitments: z.array(alternativeOfferCommitmentSchema).min(1),
  priceTotal: alternativeOfferPriceSchema,
  offerHash: identifierSchema,
  recordedAt: isoDateTimeSchema,
}).strict()
export type AlternativeOfferSnapshot = z.infer<typeof alternativeOfferSnapshotSchema>

export const resolutionCommitmentSchema = z.object({
  quantity: z.number().int().positive(),
  date: calendarDateSchema,
  status: z.enum(['ACCEPT', 'DECLINE', 'CANCEL']),
}).strict()

export const resolutionOutboundEffectSchema = z.object({
  effectId: identifierSchema,
  recipientEmail: z.string().email(),
  phase: z.literal('SUPPLY_ACCEPTANCE'),
  decision: z.enum(['ACCEPT', 'DECLINE', 'AMEND']),
  commitments: z.array(resolutionCommitmentSchema),
}).strict()

export const resolutionPlanIdSchema = z.enum(['ACCEPT_DELAY', 'USE_STOCK', 'USE_ALTERNATIVE'])

export const resolutionPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: resolutionPlanIdSchema,
  factsHash: identifierSchema,
  offerHash: identifierSchema,
  planHash: identifierSchema,
  feasibility: z.enum(['FEASIBLE', 'INFEASIBLE']),
  infeasibilityReasons: z.array(identifierSchema),
  supplier1Commitments: z.array(resolutionCommitmentSchema),
  supplier2Commitments: z.array(resolutionCommitmentSchema),
  stock: z.object({ allocated: z.number().int().nonnegative(), remaining: z.number().int().nonnegative() }).strict(),
  coverage: z.object({
    onTimeQuantity: z.number().int().nonnegative(),
    shortage: z.number().int().nonnegative(),
    productionImpact: z.enum(['ON_TIME', 'AT_RISK', 'BREACHED', 'UNKNOWN']),
    customerImpact: z.enum(['ON_TIME', 'AT_RISK', 'BREACHED', 'UNKNOWN']),
  }).strict(),
  additionalCost: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), basis: identifierSchema }).strict(),
  requiredConfirmations: z.array(z.enum(['SUPPLIER_1', 'SUPPLIER_2'])),
  outboundEffects: z.array(resolutionOutboundEffectSchema),
  action: z.object({ commandId: z.literal('supply_cases.resolution.apply_decision'), planId: resolutionPlanIdSchema }).strict(),
}).strict().refine((plan) => plan.action.planId === plan.id, {
  message: '[internal] Resolution action planId must match the plan id',
  path: ['action', 'planId'],
})
export type ResolutionPlan = z.infer<typeof resolutionPlanSchema>

export const finalResolutionFactsSchema = z.object({
  schemaVersion: z.literal(1),
  requiredQuantity: z.number().int().nonnegative(),
  requiredDate: calendarDateSchema,
  availableStock: z.number().int().nonnegative(),
  supplier1Commitments: z.array(alternativeOfferCommitmentSchema),
  supplier1OnTimeQuantity: z.number().int().nonnegative(),
  supplier1LateQuantity: z.number().int().nonnegative(),
  offerQuantity: z.number().int().positive(),
  offerPrice: alternativeOfferPriceSchema,
  customerDeadline: calendarDateSchema.nullable(),
}).strict()
export type FinalResolutionFacts = z.infer<typeof finalResolutionFactsSchema>

export const finalResolutionAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  finalFactsHash: identifierSchema,
  offerHash: identifierSchema,
  facts: finalResolutionFactsSchema,
  plans: z.array(resolutionPlanSchema).length(3),
  recordedAt: isoDateTimeSchema,
}).strict()
export type FinalResolutionAnalysis = z.infer<typeof finalResolutionAnalysisSchema>

export const supplyCaseSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  correlationId: identifierSchema,
  status: supplyCaseStatusSchema,
  needsAttentionReason: needsAttentionReasonSchema.nullable(),
  sku: identifierSchema,
  requiredQuantity: z.number().nonnegative(),
  requiredDate: isoDateTimeSchema,
  supplier1Email: z.string().nullable(),
  supplier2Email: z.string().nullable(),
  productionOrderIds: z.array(identifierSchema),
  productionPlanId: identifierSchema.nullable(),
  customerCommitmentSnapshot: jsonValueSchema,
  originalCommitment: jsonValueSchema,
  supplier1Proposal: jsonValueSchema,
  alternativeOffer: alternativeOfferSnapshotSchema.nullable(),
  initialAnalysis: jsonValueSchema,
  initialOptions: jsonValueSchema,
  selectedInitialOptionId: z.string().nullable(),
  initialProposalId: z.string().nullable().default(null),
  initialAnalyzedAt: isoDateTimeSchema.nullable().default(null),
  initialFactsHash: z.string().nullable().default(null),
  initialDecisionIdempotencyKey: z.string().nullable().default(null),
  initialDecisionKind: z.enum(['SELECT', 'REJECT', 'EDIT']).nullable().default(null),
  initialDecisionReason: z.string().nullable().default(null),
  finalAnalysis: finalResolutionAnalysisSchema.nullable(),
  resolutionPlans: z.array(resolutionPlanSchema).length(3).nullable(),
  selectedResolutionPlanId: z.string().nullable(),
  pendingResolutionPlan: jsonValueSchema,
  estimatedAdditionalCost: z.number().nullable(),
  actualAdditionalCost: z.number().nullable(),
  currency: z.string().min(1),
  supplier1ConfirmedAt: isoDateTimeSchema.nullable(),
  supplier2ConfirmedAt: isoDateTimeSchema.nullable(),
  workflowInstanceId: z.string().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
})
export type SupplyCase = z.infer<typeof supplyCaseSchema>

export const supplyCaseCreateSchema = supplyCaseSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true, updatedAt: true, deletedAt: true })
  .partial({
    id: true,
    status: true,
    needsAttentionReason: true,
    supplier1Email: true,
    supplier2Email: true,
    productionOrderIds: true,
    productionPlanId: true,
    customerCommitmentSnapshot: true,
    originalCommitment: true,
    supplier1Proposal: true,
    alternativeOffer: true,
    initialAnalysis: true,
    initialOptions: true,
    selectedInitialOptionId: true,
    initialProposalId: true,
    initialAnalyzedAt: true,
    initialFactsHash: true,
    initialDecisionIdempotencyKey: true,
    initialDecisionKind: true,
    initialDecisionReason: true,
    finalAnalysis: true,
    resolutionPlans: true,
    selectedResolutionPlanId: true,
    pendingResolutionPlan: true,
    estimatedAdditionalCost: true,
    actualAdditionalCost: true,
    currency: true,
    supplier1ConfirmedAt: true,
    supplier2ConfirmedAt: true,
    workflowInstanceId: true,
    resolvedAt: true,
  })
export type SupplyCaseCreateInput = z.infer<typeof supplyCaseCreateSchema>

export const supplyCaseUpdateSchema = supplyCaseCreateSchema.omit({ id: true, correlationId: true }).partial()
export type SupplyCaseUpdateInput = z.infer<typeof supplyCaseUpdateSchema>

/**
 * Re-exported rather than redeclared: the intent a stored message carries and
 * the intent the triage agent may return are the same closed set, and two copies
 * would drift the moment one of them gains a value.
 */
export { messageIntentSchema }
export type MessageIntent = z.infer<typeof messageIntentSchema>

/**
 * How an inbound message reached its case. Null until triage runs.
 */
export const triageDispositionSchema = z.enum([
  'AUTO_APPLIED',
  'HUMAN_CONFIRMED',
  'HUMAN_REASSIGNED',
  'QUARANTINED',
])
export type TriageDisposition = z.infer<typeof triageDispositionSchema>

export const triageOutcomeSchema = z.enum(['AUTO_APPLIED', 'NEEDS_ATTENTION', 'QUARANTINED'])
export type TriageOutcome = z.infer<typeof triageOutcomeSchema>

export const proposalAnnouncementStateSchema = z.enum(['NONE', 'CLAIMED', 'EMITTED'])
export type ProposalAnnouncementState = z.infer<typeof proposalAnnouncementStateSchema>

/**
 * Every accepted inbound message, recorded BEFORE business classification. It
 * is deliberately neutral: at this point the message may be a supplier
 * proposal, a reply on an existing case, customer traffic or noise, so nothing
 * here presumes a `SupplyCase` exists. `caseId`, `correlationId`,
 * `messageIntent`, `extraction` and `triageDisposition` all stay null until the
 * triage step links the message to a case.
 *
 * Outbound transport records are NOT modelled here — they remain owned by
 * `communication_channels`, which is why the record carries no direction, no
 * delivery status and no send timestamp.
 */
export const inboundMessageSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  caseId: identifierSchema.nullable(),
  rfcMessageId: identifierSchema,
  correlationId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string().min(1)),
  messageIntent: messageIntentSchema.nullable(),
  senderEmail: z.string().min(1),
  recipientEmail: z.string().min(1),
  payload: jsonValueSchema,
  rawBody: z.string().nullable(),
  sanitizedBody: z.string().nullable(),
  extraction: inboundSignalSchema.nullable(),
  extractionConfidence: z.number().min(0).max(1).nullable(),
  triageDisposition: triageDispositionSchema.nullable(),
  triageOutcome: triageOutcomeSchema.nullable().default(null),
  proposalAnnouncementState: proposalAnnouncementStateSchema.optional(),
  candidateIndexes: z.array(z.number().int().nonnegative()).default([]),
  needsAttention: z.boolean().default(false),
  providerMessageId: z.string().nullable(),
  failureReason: z.string().nullable(),
  receivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
})
export type InboundMessage = z.infer<typeof inboundMessageSchema>

export const inboundMessageAppendSchema = inboundMessageSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true })
  .partial({
    id: true,
    caseId: true,
    correlationId: true,
    inReplyTo: true,
    references: true,
    messageIntent: true,
    payload: true,
    rawBody: true,
    sanitizedBody: true,
    extraction: true,
    extractionConfidence: true,
    triageDisposition: true,
    triageOutcome: true,
    proposalAnnouncementState: true,
    candidateIndexes: true,
    needsAttention: true,
    providerMessageId: true,
    failureReason: true,
    receivedAt: true,
  })
export type InboundMessageAppendInput = z.infer<typeof inboundMessageAppendSchema>

/**
 * The one narrow write an accepted message still accepts: what triage concluded
 * about it. Every field here is null at append time by design — the intake
 * record is deliberately neutral about which case, if any, a message belongs
 * to — and the received facts (headers, addresses, bodies) are not in this
 * shape at all, so append-only still holds for everything the sender wrote.
 */
export const inboundMessageTriageSchema = z
  .object({
    caseId: identifierSchema.nullable(),
    correlationId: z.string().nullable(),
    messageIntent: messageIntentSchema.nullable(),
    extraction: inboundSignalSchema.nullable(),
    extractionConfidence: z.number().min(0).max(1).nullable(),
    triageDisposition: triageDispositionSchema.nullable(),
    triageOutcome: triageOutcomeSchema.nullable().optional(),
    candidateIndexes: z.array(z.number().int().nonnegative()).optional(),
    needsAttention: z.boolean().optional(),
    /**
     * Why a message is not linked, as `NEEDS_ATTENTION:<reason>` or
     * `QUARANTINED:<reason>`. Null once a message is linked.
     */
    failureReason: z.string().nullable(),
  })
  .strict()
export type InboundMessageTriageInput = z.infer<typeof inboundMessageTriageSchema>

/**
 * The outbound phases this module can be replied to. They are a subset of the
 * message intents by construction — the assertion below fails to compile if the
 * two ever drift — because the phase of an outbound message IS the intent we
 * sent it with.
 */
export const OUTBOUND_PHASES = ['ALTERNATIVE_SUPPLY_REQUEST', 'SUPPLY_ACCEPTANCE'] as const

const outboundPhasesAreMessageIntents: readonly MessageIntent[] = OUTBOUND_PHASES
void outboundPhasesAreMessageIntents

export const outboundPhaseSchema = z.enum(OUTBOUND_PHASES)
export type OutboundPhase = z.infer<typeof outboundPhaseSchema>

/**
 * What we sent, to whom, for which case — and nothing else.
 *
 * This is NOT an outbound transport record: it carries no body, no delivery
 * status and no retry state, all of which stay owned by
 * `communication_channels`. It exists because a reply can only be correlated
 * against a `Message-ID` we can attribute to a case and a phase, and the
 * platform's transport rows know neither.
 *
 * There is deliberately no `supersededAt` column. Whether a request is still
 * current is a question about the set — the newest anchor for a given case,
 * phase and recipient wins — and a stored flag would need updating on every
 * resend, drifting away from the records it describes on the first missed
 * write.
 */
export const outboundCorrelationSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  caseId: identifierSchema,
  phase: outboundPhaseSchema,
  recipientEmail: z.string().min(1),
  rfcMessageId: identifierSchema,
  /** Derived from case + phase + recipient; the same key must never send twice. */
  idempotencyKey: identifierSchema,
  createdAt: isoDateTimeSchema,
})
export type OutboundCorrelation = z.infer<typeof outboundCorrelationSchema>

export const outboundCorrelationRecordSchema = outboundCorrelationSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true })
  .partial({ id: true })
export type OutboundCorrelationRecordInput = z.infer<typeof outboundCorrelationRecordSchema>

export const STORE_FILE_VERSION = 1

export function storeFileSchema<TRecord>(recordSchema: z.ZodType<TRecord>) {
  return z.object({
    version: z.literal(STORE_FILE_VERSION),
    records: z.array(recordSchema),
  })
}

/**
 * The two roles a case can wait on. A role, not a supplier row: `ACCEPT_DELAY`
 * carries two deliveries for `SUPPLIER_1` and one role can still hold a
 * `CANCEL` alongside a `COMMIT` (`USE_STOCK`), so the join tracks roles, never
 * individual commitment rows.
 */
export const confirmationRoleSchema = z.enum(['SUPPLIER_1', 'SUPPLIER_2'])
export type ConfirmationRole = z.infer<typeof confirmationRoleSchema>

export const confirmationVerdictSchema = z.enum(['MATCHES_PLAN', 'DIFFERS_FROM_PLAN'])
export type ConfirmationVerdict = z.infer<typeof confirmationVerdictSchema>

/**
 * One durable record per role per plan (`idempotencyKey` enforces it). Append
 * only, like `OutboundCorrelation`: a supplier's confirmation is a historical
 * fact, and the join is computed by reading the set, never by rewriting one row
 * in place.
 */
export const supplyConfirmationSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  caseId: identifierSchema,
  planId: z.string().min(1),
  planHash: z.string().min(1),
  role: confirmationRoleSchema,
  supplierEmail: z.string().min(1),
  inboundMessageId: identifierSchema,
  rfcMessageId: identifierSchema,
  confirmedCommitments: z.array(extractedCommitmentSchema),
  verdict: confirmationVerdictSchema,
  mismatchReasons: z.array(z.string()),
  /** `{caseId}:{planHash}:{role}` — one confirmation per role per plan. */
  idempotencyKey: identifierSchema,
  createdAt: isoDateTimeSchema,
})
export type SupplyConfirmation = z.infer<typeof supplyConfirmationSchema>

export const supplyConfirmationRecordSchema = supplyConfirmationSchema
  .omit({ tenantId: true, organizationId: true, createdAt: true })
  .partial({ id: true })
export type SupplyConfirmationRecordInput = z.infer<typeof supplyConfirmationRecordSchema>

export const commitmentIntentSchema = z.enum(['COMMIT', 'CANCEL'])
export type CommitmentIntent = z.infer<typeof commitmentIntentSchema>

export const confirmationPlanIdSchema = z.enum(['ACCEPT_DELAY', 'USE_STOCK', 'USE_ALTERNATIVE'])
export type ConfirmationPlanId = z.infer<typeof confirmationPlanIdSchema>

const planSupplierCommitmentSchema = z.object({
  role: confirmationRoleSchema,
  supplierEmail: z.string().min(1),
  quantity: z.number().nonnegative(),
  deliveryDate: isoDateTimeSchema,
  intent: commitmentIntentSchema,
})
export type ConfirmationPlanSupplierCommitment = z.infer<typeof planSupplierCommitmentSchema>

/**
 * The narrow, Zod-parsed slice of `SupplyCase.pendingResolutionPlan` the
 * confirmation join is allowed to read. The column itself stays
 * `jsonValueSchema` (Phase 3's contract), so this is parsed on every read,
 * never assumed from the stored type.
 *
 * `requiredConfirmations` is carried on the plan rather than derived from
 * `supplierCommitments`, because the set a case is waiting on is a decision a
 * human already made when the plan was selected, not something a later code
 * change should get to recompute retroactively for a case already in flight.
 */
export const confirmationPlanContractSchema = z.object({
  planId: confirmationPlanIdSchema,
  planHash: z.string().min(1),
  supplierCommitments: z.array(planSupplierCommitmentSchema),
  /** Absolute target allocation, never a delta — see coverage semantics in `data/coverage.ts`. */
  internalStockAllocation: z.number().nonnegative(),
  requiredConfirmations: z.array(confirmationRoleSchema),
  additionalCost: z.number().nullable(),
})
export type ConfirmationPlanContract = z.infer<typeof confirmationPlanContractSchema>
