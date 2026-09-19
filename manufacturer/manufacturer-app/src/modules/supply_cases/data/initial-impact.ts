import { createHash } from 'node:crypto'
import { z } from 'zod'
import { jsonValueSchema } from './types'

export const INITIAL_OPTION_IDS = [
  'ACCEPT_PRIMARY_DELAY',
  'USE_INTERNAL_STOCK',
  'CHECK_ALTERNATIVE_SUPPLIER',
] as const

export const initialOptionIdSchema = z.enum(INITIAL_OPTION_IDS)
export type InitialOptionId = z.infer<typeof initialOptionIdSchema>

export const impactStatusSchema = z.enum(['ON_TIME', 'AT_RISK', 'BREACHED', 'UNKNOWN'])
export type ImpactStatus = z.infer<typeof impactStatusSchema>

export const feasibilitySchema = z.enum(['FEASIBLE', 'CONDITIONALLY_FEASIBLE', 'INFEASIBLE'])
export type Feasibility = z.infer<typeof feasibilitySchema>

export const initialImpactReasonCodeSchema = z.enum([
  'PRIMARY_DELIVERY_LATE',
  'CUSTOMER_DEADLINE_BREACHED',
  'STOCK_BUFFER_EXHAUSTED',
  'ALTERNATIVE_PRICE_UNKNOWN',
  'ALTERNATIVE_SUPPLIER_UNAVAILABLE',
  'ALTERNATIVE_RESPONSE_TIME_RISK',
  'MISSING_PRODUCTION_PLAN',
  'MISSING_PRIMARY_PROPOSAL',
  'MISSING_REQUIRED_FACT',
])
export type InitialImpactReasonCode = z.infer<typeof initialImpactReasonCodeSchema>

const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO 8601 date-time string',
})

export const deliveryCommitmentSchema = z.object({
  quantity: z.number().positive(),
  deliveryDate: dateSchema,
}).strict()
export type DeliveryCommitment = z.infer<typeof deliveryCommitmentSchema>

export const initialImpactFactsSchema = z.object({
  requiredQuantity: z.number().nonnegative(),
  requiredDate: dateSchema,
  onTimePrimaryQuantity: z.number().nonnegative(),
  latePrimaryQuantity: z.number().nonnegative(),
  coverageWithoutStock: z.number().nonnegative(),
  shortageWithoutStock: z.number().nonnegative(),
  coverageWithStock: z.number().nonnegative(),
  shortageAfterStock: z.number().nonnegative(),
  availableStock: z.number().nonnegative(),
  stockRemainingAfterCoverage: z.number().nonnegative(),
  customerDeadline: dateSchema.nullable(),
  customerDeadlineStatus: impactStatusSchema,
  latestPrimaryDeliveryDate: dateSchema.nullable(),
  latestSafeDecisionAt: dateSchema.nullable(),
  reasonCodes: z.array(initialImpactReasonCodeSchema),
}).strict()
export type InitialImpactFacts = z.infer<typeof initialImpactFactsSchema>

export const optionSupplySchema = z.object({
  source: z.enum(['SUPPLIER_1', 'INTERNAL_STOCK', 'SUPPLIER_2']),
  quantity: z.number().nonnegative(),
  date: dateSchema.nullable(),
}).strict()

export const initialOptionSchema = z.object({
  id: initialOptionIdSchema,
  factsHash: z.string().min(1),
  feasibility: feasibilitySchema,
  supply: z.array(optionSupplySchema),
  onTimeCoverage: z.number().nonnegative(),
  shortageOnRequiredDate: z.number().nonnegative(),
  stockRemaining: z.number().nonnegative(),
  productionImpact: impactStatusSchema,
  customerImpact: impactStatusSchema,
  cost: z.object({
    status: z.enum(['KNOWN', 'UNKNOWN']),
    amount: z.number().nullable(),
    currency: z.string().min(1),
  }).strict(),
  risks: z.array(z.string().min(1)),
  requiredConfirmations: z.array(z.string().min(1)),
  outboundEffects: z.array(z.string().min(1)),
}).strict()
export type CanonicalInitialOption = z.infer<typeof initialOptionSchema>

export const initialImpactAdvisorInputSchema = z.object({
  schemaVersion: z.literal(1),
  caseRef: z.object({
    correlationId: z.string().min(1),
    sku: z.string().min(1),
    status: z.literal('ANALYZING_INITIAL_IMPACT'),
  }).strict(),
  factsHash: z.string().min(1),
  demand: z.object({
    requiredQuantity: z.number().nonnegative(),
    requiredDate: dateSchema,
    productionOrders: z.array(z.object({
      orderNumber: z.string().min(1),
      materialQuantity: z.number().nonnegative(),
      dueDate: dateSchema,
      customerName: z.string().min(1),
      customerCommitmentDate: dateSchema.nullable(),
    }).strict()),
  }).strict(),
  primaryProposal: z.object({
    supplierEmail: z.string().email(),
    deliveries: z.array(deliveryCommitmentSchema),
  }).strict(),
  stock: z.object({
    availableQuantity: z.number().nonnegative(),
    sourceUpdatedAt: dateSchema,
  }).strict(),
  impact: initialImpactFactsSchema,
  options: z.array(initialOptionSchema).length(3),
  unresolved: z.array(z.string().min(1)),
}).strict()
export type InitialImpactAdvisorInput = z.infer<typeof initialImpactAdvisorInputSchema>

export const initialImpactAdvisorResultSchema = z.object({
  schemaVersion: z.literal(1),
  factsHash: z.string().min(1),
  summary: z.string().min(1).max(4000),
  optionAssessments: z.array(z.object({
    optionId: initialOptionIdSchema,
    consequenceSummary: z.string().min(1).max(2000),
    whyGood: z.array(z.string().min(1)).max(10),
    whyBad: z.array(z.string().min(1)).max(10),
    evidenceRefs: z.array(z.string().min(1)).max(20),
  }).strict()).length(3),
  recommendedOptionId: initialOptionIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  unresolved: z.array(z.string().min(1)),
}).strict()
export type InitialImpactAdvisorResult = z.infer<typeof initialImpactAdvisorResultSchema>

export const initialImpactAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  factsHash: z.string().min(1),
  facts: initialImpactFactsSchema,
  options: z.array(initialOptionSchema).length(3),
  advisor: initialImpactAdvisorResultSchema.nullable(),
  dataQuality: z.enum(['VALID', 'NEEDS_ATTENTION']),
  failureReason: z.string().nullable(),
  recordedAt: dateSchema,
  operatorEdit: z.object({
    reason: z.string().min(1),
    selectedOptionId: initialOptionIdSchema,
  }).nullable().optional(),
}).strict()
export type InitialImpactAnalysis = z.infer<typeof initialImpactAnalysisSchema>

export function hashInitialImpactFacts(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const initialImpactJsonSchema = jsonValueSchema
