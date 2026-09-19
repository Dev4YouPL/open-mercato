import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const activityKindSchema = z.enum([
  'email_received',
  'analysis_started',
  'sender_classified',
  'supplier_offer_extracted',
  'analysis_completed',
  'risk_detected',
  'case_created',
  'stage_changed',
  'waiting_external',
  'decision_recorded',
  'confirmation_recorded',
  'case_resolved',
  'operation_failed',
  'retry_started',
])
export type ActivityKind = z.infer<typeof activityKindSchema>

export const activityStatusSchema = z.enum(['info', 'running', 'success', 'warning', 'error', 'waiting'])
export type ActivityStatus = z.infer<typeof activityStatusSchema>

export const activityActorTypeSchema = z.enum(['system', 'agent', 'user', 'external'])
export type ActivityActorType = z.infer<typeof activityActorTypeSchema>

export const activitySupplierRoleSchema = z.enum(['SUPPLIER_1', 'SUPPLIER_2'])
export const activityStageSchema = z.enum([
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
export type ActivityStage = z.infer<typeof activityStageSchema>
export const activityReasonCodeSchema = z.enum([
  'AGENT_UNAVAILABLE',
  'SCHEMA_INVALID',
  'EMPTY_BODY',
  'MISSING_DATA',
  'ANALYSIS_FAILED',
  'FACTS_HASH_MISMATCH',
  'INVALID_CANDIDATE_INDEX',
  'UNRELATED',
])
export type ActivityReasonCode = z.infer<typeof activityReasonCodeSchema>
export const activityVerdictSchema = z.enum(['MATCHES_PLAN', 'DIFFERS_FROM_PLAN'])
export type ActivityVerdict = z.infer<typeof activityVerdictSchema>
export const activityRiskStatusSchema = z.enum(['PROTECTED', 'AT_RISK', 'BREACHED'])
export type ActivityRiskStatus = z.infer<typeof activityRiskStatusSchema>
const activityDateSchema = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), '[internal] invalid activity date')
const activityDeliverySchema = z.object({ quantity: z.number().nonnegative(), date: activityDateSchema }).strict()
export const activityParamsSchema = z.union([
  z.object({}).strict(),
  z.object({ agentKey: z.enum(['inboundTriage', 'initialImpact', 'finalResolution']) }).strict(),
  z.object({ agentKey: z.enum(['inboundTriage', 'initialImpact']), attempt: z.number().int().positive() }).strict(),
  z.object({ supplierRole: activitySupplierRoleSchema }).strict(),
  z.object({ supplierRole: activitySupplierRoleSchema, deliveries: z.array(activityDeliverySchema).max(20) }).strict(),
  z.object({ requiredQuantity: z.number().nonnegative(), coveredQuantity: z.number().nonnegative(), missingQuantity: z.number().nonnegative() }).strict(),
  z.object({ missingQuantity: z.number().nonnegative(), requiredDate: activityDateSchema }).strict(),
  z.object({ correlationId: z.string().min(1) }).strict(),
  z.object({ stage: activityStageSchema }).strict(),
  z.object({ reasonCode: activityReasonCodeSchema, retryable: z.boolean() }).strict(),
  z.object({ attempt: z.number().int().positive() }).strict(),
  z.object({ supplierRole: activitySupplierRoleSchema, verdict: activityVerdictSchema }).strict(),
  z.object({ supplierRole: activitySupplierRoleSchema, verdict: activityVerdictSchema, deliveries: z.array(activityDeliverySchema).max(20) }).strict(),
  z.object({ coveredQuantity: z.number().nonnegative(), requiredQuantity: z.number().nonnegative(), riskStatus: activityRiskStatusSchema }).strict(),
])
export type ActivityParams = z.infer<typeof activityParamsSchema>

export const activityEntrySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  caseId: z.string().min(1).nullable(),
  caseCorrelationId: z.string().min(1).nullable(),
  kind: activityKindSchema,
  status: activityStatusSchema,
  actorType: activityActorTypeSchema,
  actorRef: z.string().min(1).nullable(),
  titleKey: z.string().regex(/^supply_cases\.activity\.[a-zA-Z0-9_.]+$/),
  detailKey: z.string().regex(/^supply_cases\.activity\.[a-zA-Z0-9_.]+$/).nullable(),
  params: activityParamsSchema,
  occurredAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  dedupeKey: z.string().min(1).max(300),
  groupKey: z.string().min(1).max(200).nullable(),
  sourceEventId: z.string().min(1),
  sourceOccurrenceId: z.string().min(1),
  evidenceType: z.enum(['inbound_message', 'case', 'workflow']).nullable(),
  evidenceId: z.string().min(1).nullable(),
  technicalRefType: z.enum(['workflow_instance', 'agent_run']).nullable(),
  technicalRefId: z.string().min(1).nullable(),
}).strict()
export type SupplyActivityEntry = z.infer<typeof activityEntrySchema>

export const activityEntryInputSchema = activityEntrySchema.omit({ id: true, recordedAt: true }).extend({
  id: z.string().min(1).optional(),
  recordedAt: z.string().datetime({ offset: true }).optional(),
}).strict()
export type SupplyActivityEntryInput = z.infer<typeof activityEntryInputSchema>

export type ActivityAppendResult = {
  status: 'recorded' | 'already_recorded'
  entry: SupplyActivityEntry
}

export type ActivityCursor = {
  occurredAt: string
  id: string
}

const activityCursorSchema = z.object({
  version: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  id: z.string().min(1),
}).strict()

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), 'utf8').toString('base64url')
}

export function decodeActivityCursor(value: string): ActivityCursor {
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  const parsed = activityCursorSchema.parse(JSON.parse(decoded))
  return { occurredAt: parsed.occurredAt, id: parsed.id }
}

export function createActivityId(): string {
  return randomUUID()
}

export function compareActivityDesc(left: Pick<SupplyActivityEntry, 'occurredAt' | 'id'>, right: Pick<SupplyActivityEntry, 'occurredAt' | 'id'>): number {
  if (left.occurredAt !== right.occurredAt) return right.occurredAt.localeCompare(left.occurredAt)
  return right.id.localeCompare(left.id)
}

export function isActivityBeforeCursor(entry: Pick<SupplyActivityEntry, 'occurredAt' | 'id'>, cursor: ActivityCursor): boolean {
  return entry.occurredAt < cursor.occurredAt || (entry.occurredAt === cursor.occurredAt && entry.id < cursor.id)
}
