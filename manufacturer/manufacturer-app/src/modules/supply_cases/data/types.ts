import { z } from 'zod'
import { inboundSignalSchema, messageIntentSchema } from './inbound-signal'

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

export const needsAttentionReasonSchema = z.enum(['WAIT_TIMEOUT', 'DELIVERY_FAILED', 'CONFIRMATION_MISMATCH'])
export type NeedsAttentionReason = z.infer<typeof needsAttentionReasonSchema>

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
  alternativeOffer: jsonValueSchema,
  initialAnalysis: jsonValueSchema,
  initialOptions: jsonValueSchema,
  selectedInitialOptionId: z.string().nullable(),
  finalAnalysis: jsonValueSchema,
  resolutionPlans: jsonValueSchema,
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
