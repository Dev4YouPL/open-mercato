import { z } from 'zod'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const isoDateSchema = z.string().refine(isCalendarDate, '[internal] expected a calendar date')

export const rfqInterpretationBlockingStatusSchema = z.enum([
  'invalid_output',
  'missing_sku',
  'missing_quantity',
  'missing_date',
  'missing_sku_evidence',
  'missing_quantity_evidence',
  'missing_date_evidence',
  'invalid_evidence',
  'ambiguous_date',
  'low_confidence',
  'prompt_injection',
  'sku_mismatch',
])

export type RfqInterpretationBlockingStatus = z.infer<typeof rfqInterpretationBlockingStatusSchema>

export const rfqInterpretationSchema = z.object({
  sku: z.string().min(1).nullable(),
  quantity: z.number().int().positive().nullable(),
  deliveryDate: isoDateSchema.nullable(),
  dateStatus: z.enum(['exact', 'ambiguous', 'missing']).default('exact'),
  skuEvidence: z.string().min(1).max(240).nullable(),
  quantityEvidence: z.string().min(1).max(240).nullable(),
  dateEvidence: z.string().min(1).max(240).nullable(),
  confidence: z.number().min(0).max(1),
  instructionsDetected: z.boolean(),
  promptInjectionDetected: z.boolean().optional().default(false),
  blockedReason: rfqInterpretationBlockingStatusSchema.nullable().default(null),
  status: z.enum(['ready', 'blocked']).default('ready'),
  blockingStatuses: z.array(rfqInterpretationBlockingStatusSchema).max(12).default([]),
}).strict()

export type RfqInterpretation = z.infer<typeof rfqInterpretationSchema>

export type RfqInterpretationContext = {
  sourceText?: string
  expectedSku?: string | null
  minimumConfidence?: number
}

export type RfqInterpretationValidation =
  | {
      ok: true
      status: 'ready'
      reason: null
      interpretation: RfqInterpretation
      blockingStatuses: []
    }
  | {
      ok: false
      status: 'blocked'
      reason: RfqInterpretationBlockingStatus
      interpretation: RfqInterpretation | null
      blockingStatuses: RfqInterpretationBlockingStatus[]
      issues: string[]
    }

function uniqueStatuses(statuses: RfqInterpretationBlockingStatus[]): RfqInterpretationBlockingStatus[] {
  return [...new Set(statuses)]
}

function hasExactEvidence(sourceText: string | undefined, evidence: string | null): boolean {
  return Boolean(evidence && (!sourceText || sourceText.includes(evidence)))
}

function hasQuantityEvidence(evidence: string, quantity: number): boolean {
  return new RegExp(`(?<!\\d)${String(quantity).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?!\\d)`).test(evidence)
}

function validateParsedInterpretation(
  interpretation: RfqInterpretation,
  context: RfqInterpretationContext,
): RfqInterpretationValidation {
  const statuses: RfqInterpretationBlockingStatus[] = [...interpretation.blockingStatuses]
  const issues: string[] = []
  const add = (status: RfqInterpretationBlockingStatus, issue: string) => {
    if (!statuses.includes(status)) statuses.push(status)
    issues.push(issue)
  }

  if (!interpretation.sku) add('missing_sku', 'sku is required')
  if (!interpretation.quantity) add('missing_quantity', 'quantity is required')
  if (interpretation.dateStatus === 'missing' || !interpretation.deliveryDate) add('missing_date', 'an exact delivery date is required')
  if (interpretation.dateStatus === 'ambiguous') add('ambiguous_date', 'requested date is ambiguous')
  if (!interpretation.skuEvidence) add('missing_sku_evidence', 'sku evidence is required')
  if (!interpretation.quantityEvidence) add('missing_quantity_evidence', 'quantity evidence is required')
  if (!interpretation.dateEvidence) add('missing_date_evidence', 'date evidence is required')
  if (interpretation.skuEvidence && !hasExactEvidence(context.sourceText, interpretation.skuEvidence)) add('invalid_evidence', 'sku evidence is not an exact source span')
  if (interpretation.quantityEvidence && !hasExactEvidence(context.sourceText, interpretation.quantityEvidence)) add('invalid_evidence', 'quantity evidence is not an exact source span')
  if (interpretation.dateEvidence && !hasExactEvidence(context.sourceText, interpretation.dateEvidence)) add('invalid_evidence', 'date evidence is not an exact source span')
  if (interpretation.sku && interpretation.skuEvidence && !interpretation.skuEvidence.toLocaleLowerCase().includes(interpretation.sku.toLocaleLowerCase())) add('invalid_evidence', 'sku evidence does not contain the extracted sku')
  if (interpretation.quantity && interpretation.quantityEvidence && !hasQuantityEvidence(interpretation.quantityEvidence, interpretation.quantity)) add('invalid_evidence', 'quantity evidence does not contain the extracted quantity')
  if (interpretation.deliveryDate && interpretation.dateEvidence && !interpretation.dateEvidence.includes(interpretation.deliveryDate)) add('invalid_evidence', 'date evidence does not contain the extracted date')
  if (context.expectedSku && interpretation.sku && interpretation.sku.toLocaleLowerCase() !== context.expectedSku.toLocaleLowerCase()) add('sku_mismatch', 'sku does not match the inbound subject')
  if (interpretation.instructionsDetected || interpretation.promptInjectionDetected) add('prompt_injection', 'prompt injection was detected')
  if (interpretation.blockedReason) add(interpretation.blockedReason, 'the interpretation reported a blocking status')

  const minimumConfidence = context.minimumConfidence ?? 0.8
  if (interpretation.confidence < minimumConfidence) add('low_confidence', 'confidence is below the approval threshold')
  if (interpretation.status === 'ready' && interpretation.blockingStatuses.length > 0) add('invalid_output', 'ready status cannot carry blocking statuses')
  if (interpretation.status === 'blocked' && statuses.length === 0) add('invalid_output', 'blocked status requires a blocking status')

  const blockingStatuses = uniqueStatuses(statuses)
  if (blockingStatuses.length > 0) {
    return { ok: false, status: 'blocked', reason: blockingStatuses[0] ?? 'invalid_output', interpretation, blockingStatuses, issues }
  }
  return { ok: true, status: 'ready', reason: null, interpretation: { ...interpretation, status: 'ready', blockingStatuses: [] }, blockingStatuses: [] }
}

export function validateRfqInterpretation(value: unknown, context: RfqInterpretationContext | string = {}): RfqInterpretationValidation {
  const parsed = rfqInterpretationSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      status: 'blocked',
      reason: 'invalid_output',
      interpretation: null,
      blockingStatuses: ['invalid_output'],
      issues: parsed.error.issues.map((issue) => issue.path.join('.') || issue.message),
    }
  }
  const normalizedContext: RfqInterpretationContext = typeof context === 'string' ? { sourceText: context } : context
  return validateParsedInterpretation(parsed.data, normalizedContext)
}

export const validateRfqInterpretationOutput = validateRfqInterpretation
