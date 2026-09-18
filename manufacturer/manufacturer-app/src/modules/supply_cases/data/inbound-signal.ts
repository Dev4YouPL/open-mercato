import { z } from 'zod'

/**
 * The triage agent's entire output surface. Two jobs: it constrains what the
 * model is asked to produce, and it rejects what the model actually produced
 * when that does not hold. Everything downstream may assume a value parsed here.
 */

export const messageIntentSchema = z.enum([
  'SUPPLY_PROPOSAL',
  'ALTERNATIVE_SUPPLY_REQUEST',
  'ALTERNATIVE_SUPPLY_OFFER',
  'SUPPLY_ACCEPTANCE',
  'SUPPLY_COMMITMENT_CONFIRMED',
  'UNRELATED',
])
export type MessageIntent = z.infer<typeof messageIntentSchema>

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: '[internal] Expected a calendar date' })

export const extractedCommitmentSchema = z
  .object({
    quantity: z.number().int().positive(),
    date: isoDateSchema,
  })
  .strict()
export type ExtractedCommitment = z.infer<typeof extractedCommitmentSchema>

export const extractedPriceSchema = z
  .object({
    amount: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
export type ExtractedPrice = z.infer<typeof extractedPriceSchema>

/**
 * Closed-set correlation. `candidateIndex` addresses the candidate list the
 * module builds deterministically, never a case identifier the model could
 * invent, so message text cannot route a message into a record its sender has
 * no part in.
 */
export const correlationChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NEW_CASE') }).strict(),
  z.object({ kind: z.literal('EXISTING_CASE'), candidateIndex: z.number().int().nonnegative() }).strict(),
])
export type CorrelationChoice = z.infer<typeof correlationChoiceSchema>

const inboundSignalShape = z
  .object({
    intent: messageIntentSchema,
    correlation: correlationChoiceSchema,
    sku: z.string().min(1).nullable(),
    commitments: z.array(extractedCommitmentSchema),
    price: extractedPriceSchema.nullable(),
    confidence: z.number().min(0).max(1),
    unresolved: z.array(z.string().min(1)),
    rationale: z.string().min(1),
  })
  .strict()

export type InboundSignal = z.infer<typeof inboundSignalShape>

/**
 * An unrelated message must not be able to attach itself to an open case, and a
 * price only means something on an offer. Both are modelled here rather than in
 * the apply step so a violating result is quarantined before it is ever read.
 */
function unrelatedStaysUncorrelated(value: InboundSignal): boolean {
  return value.intent !== 'UNRELATED' || value.correlation.kind === 'NEW_CASE'
}

function priceOnlyOnOffer(value: InboundSignal): boolean {
  return value.price === null || value.intent === 'ALTERNATIVE_SUPPLY_OFFER'
}

type RefinementIssue = { message: string; path: PropertyKey[] }

const UNRELATED_ISSUE: RefinementIssue = {
  message: '[internal] An UNRELATED message cannot select an existing case',
  path: ['correlation'],
}

const PRICE_ISSUE: RefinementIssue = {
  message: '[internal] A price is only valid on an ALTERNATIVE_SUPPLY_OFFER',
  path: ['price'],
}

export const inboundSignalSchema = inboundSignalShape
  .refine(unrelatedStaysUncorrelated, UNRELATED_ISSUE)
  .refine(priceOnlyOnOffer, PRICE_ISSUE)

/**
 * The static schema cannot know how many candidates the module offered, so the
 * upper bound on `candidateIndex` is applied per run. With no candidates at all,
 * `EXISTING_CASE` is unreachable by construction.
 */
export function createInboundSignalSchema(candidateCount: number) {
  if (!Number.isInteger(candidateCount) || candidateCount < 0) {
    throw new Error('[internal] candidateCount must be a non-negative integer')
  }
  return inboundSignalShape
    .refine(unrelatedStaysUncorrelated, UNRELATED_ISSUE)
    .refine(priceOnlyOnOffer, PRICE_ISSUE)
    .refine(
      (value: InboundSignal) =>
        value.correlation.kind !== 'EXISTING_CASE' || value.correlation.candidateIndex < candidateCount,
      {
        message: '[internal] candidateIndex is outside the offered candidate list',
        path: ['correlation', 'candidateIndex'],
      },
    )
}
