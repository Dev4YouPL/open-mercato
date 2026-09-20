import { z } from 'zod'

const weekdayValues = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const isoDateSchema = z.string().refine(validIsoDate, 'expected a valid ISO date')

export const dateExpressionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('iso'), date: isoDateSchema }).strict(),
  z.object({ type: z.literal('weekday'), weekday: z.enum(weekdayValues), which: z.enum(['this', 'next']) }).strict(),
  z.object({ type: z.literal('original_date') }).strict(),
  z.object({ type: z.literal('week'), offset: z.union([z.literal(0), z.literal(1), z.literal(2)]) }).strict(),
  z.object({ type: z.literal('asap') }).strict(),
  z.object({ type: z.literal('unspecified') }).strict(),
])

const trancheSchema = z.object({
  quantity: z.number().int().positive().nullable(),
  quantityIsRemainder: z.boolean(),
  date: dateExpressionSchema,
  evidence: z.array(z.string().min(1).max(200)).min(1).max(3),
}).strict()

export const replyIntentSchema = z.object({
  kind: z.enum(['counter_split', 'partial_with_remainder', 'accept_all', 'accept_partial', 'reject', 'question_only', 'unsupported_request', 'unclear']),
  tranches: z.array(trancheSchema).max(5),
  conditions: z.array(z.enum(['when_restocked', 'subject_to_confirmation', 'price_change_requested', 'other'])).max(4),
  instructionsDetected: z.boolean(),
  language: z.enum(['pl', 'en', 'other']),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(400),
}).strict()

export type DateExpression = z.infer<typeof dateExpressionSchema>
export type ReplyIntent = z.infer<typeof replyIntentSchema>

// What the model actually returns. Structured-output modes reject or mishandle discriminated unions and the
// string/array size keywords, so the wire shape is flat and unconstrained; every bound below is enforced by the
// validator instead, and the union is rebuilt in code. The internal ReplyIntent above stays the app's contract.
// The wire shape the model fills in: flat fields instead of a discriminated union for the date, every object
// `.strict()` so the emitted JSON Schema declares `additionalProperties: false`, and no size keywords — the
// bounds are enforced by replyIntentFromWire below. The internal ReplyIntent above stays the app's contract.
export const replyIntentWireSchema = z.object({
  kind: z.enum(['counter_split', 'partial_with_remainder', 'accept_all', 'accept_partial', 'reject', 'question_only', 'unsupported_request', 'unclear']),
  tranches: z.array(z.object({
    // 0 marks the tranche the mail calls "the rest"; code computes that quantity.
    quantity: z.number(),
    quantityIsRemainder: z.boolean(),
    dateKind: z.enum(['iso', 'weekday', 'original_date', 'week', 'asap', 'unspecified']),
    dateIso: z.string(),
    weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'none']),
    weekdayWhich: z.enum(['this', 'next', 'none']),
    weekOffset: z.number(),
    evidence: z.array(z.string()),
  }).strict()),
  conditions: z.array(z.enum(['when_restocked', 'subject_to_confirmation', 'price_change_requested', 'other'])),
  instructionsDetected: z.boolean(),
  language: z.enum(['pl', 'en', 'other']),
  confidence: z.number(),
  summary: z.string(),
}).strict()

export type ReplyIntentWire = z.infer<typeof replyIntentWireSchema>

type WireTranche = ReplyIntentWire['tranches'][number]

function wireTranches(wire: ReplyIntentWire): WireTranche[] {
  return wire.tranches
}

function dateExpressionFromWire(tranche: WireTranche): DateExpression | null {
  if (tranche.dateKind === 'iso') return tranche.dateIso && validIsoDate(tranche.dateIso) ? { type: 'iso', date: tranche.dateIso } : null
  if (tranche.dateKind === 'weekday') {
    if (tranche.weekday === 'none') return null
    return { type: 'weekday', weekday: tranche.weekday, which: tranche.weekdayWhich === 'next' ? 'next' : 'this' }
  }
  if (tranche.dateKind === 'week') {
    const offset = tranche.weekOffset ?? 0
    return offset === 0 || offset === 1 || offset === 2 ? { type: 'week', offset } : null
  }
  if (tranche.dateKind === 'original_date') return { type: 'original_date' }
  if (tranche.dateKind === 'asap') return { type: 'asap' }
  return { type: 'unspecified' }
}

// Rebuilds the internal intent and enforces the bounds the wire schema deliberately leaves out.
export function replyIntentFromWire(wire: ReplyIntentWire): { ok: true; intent: ReplyIntent } | { ok: false; issues: string[] } {
  const issues: string[] = []
  const source = wireTranches(wire)
  if (source.length > 5) issues.push('at most 5 tranches are allowed')
  if (wire.conditions.length > 4) issues.push('at most 4 conditions are allowed')
  if (!(wire.confidence >= 0 && wire.confidence <= 1)) issues.push('confidence must be between 0 and 1')
  if (!wire.summary.trim() || wire.summary.length > 400) issues.push('summary must be 1-400 characters')
  const tranches = source.map((tranche) => {
    const date = dateExpressionFromWire(tranche)
    if (!date) issues.push(`tranche date ${tranche.dateKind} is incomplete`)
    const evidence = tranche.evidence.map((entry) => entry.trim()).filter(Boolean).slice(0, 3).map((entry) => entry.slice(0, 200))
    if (!evidence.length) issues.push('every tranche needs at least one evidence span')
    // The wire carries 0 for the remainder because the model must never compute it; the internal shape uses null.
    const quantity = tranche.quantityIsRemainder ? null : tranche.quantity
    if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0)) issues.push('a quantity must be a positive integer')
    return { quantity, quantityIsRemainder: tranche.quantityIsRemainder, date: date ?? { type: 'unspecified' as const }, evidence }
  })
  if (issues.length) return { ok: false, issues }
  const parsed = replyIntentSchema.safeParse({
    kind: wire.kind,
    tranches,
    conditions: wire.conditions,
    instructionsDetected: wire.instructionsDetected,
    language: wire.language,
    confidence: wire.confidence,
    summary: wire.summary.trim(),
  })
  return parsed.success ? { ok: true, intent: parsed.data } : { ok: false, issues: parsed.error.issues.map((issue) => issue.message) }
}
export type ReplyIntentTranche = ReplyIntent['tranches'][number]

export type ReplyIntentValidationCode =
  | 'interpretation_invalid_output'
  | 'interpretation_inconsistent'
  | 'interpretation_flagged'
  | 'interpretation_ungrounded'

export type ReplyIntentValidationResult = {
  ok: true
  intent: ReplyIntent
  checks: {
    schema: 'pass'
    consistency: 'pass'
    grounding: 'pass'
    rules: string[]
  }
} | {
  ok: false
  code: ReplyIntentValidationCode
  rule?: 'IC1' | 'IC2' | 'IC3' | 'IC5' | 'GR1' | 'GR2' | 'GR3' | 'GR4'
  issues: string[]
}

function quantityToken(value: number): RegExp {
  return new RegExp(`(?<!\\d)${String(value).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?!\\d)`)
}

const weekdayEvidenceTokens: Record<typeof weekdayValues[number], string[]> = {
  mon: ['mon', 'monday', 'poniedział', 'pon'],
  tue: ['tue', 'tuesday', 'wtorek', 'wtork'],
  wed: ['wed', 'wednesday', 'środa', 'środę', 'środ'],
  thu: ['thu', 'thursday', 'czwartek', 'czwart'],
  fri: ['fri', 'friday', 'piątek', 'piątk'],
  sat: ['sat', 'saturday', 'sobota', 'sobot'],
  sun: ['sun', 'sunday', 'niedziela', 'niedziel'],
}

function consistencyIssues(intent: ReplyIntent): { rule: 'IC1' | 'IC2' | 'IC3' | 'IC5'; issues: string[] } | null {
  const remainderTranches = intent.tranches.filter((tranche) => tranche.quantityIsRemainder)
  if (remainderTranches.length > 1 || remainderTranches.some((tranche) => tranche.quantity !== null)) {
    return { rule: 'IC1', issues: ['at most one remainder tranche is allowed and its quantity must be null'] }
  }
  const negotiable = intent.kind === 'counter_split' || intent.kind === 'partial_with_remainder'
  if (negotiable && !intent.tranches.some((tranche) => !tranche.quantityIsRemainder && tranche.quantity !== null)) {
    return { rule: 'IC2', issues: ['a negotiable intent requires an explicit tranche'] }
  }
  if (intent.kind === 'partial_with_remainder' && remainderTranches.length !== 1) {
    return { rule: 'IC3', issues: ['partial_with_remainder requires exactly one remainder tranche'] }
  }
  if (intent.instructionsDetected || intent.language === 'other') {
    return { rule: 'IC5', issues: ['instruction-like output or unsupported language is non-negotiable'] }
  }
  return null
}

function groundingIssues(intent: ReplyIntent, text: string): { rule: 'GR1' | 'GR2' | 'GR3' | 'GR4'; issues: string[] } | null {
  for (const tranche of intent.tranches) {
    if (tranche.quantityIsRemainder && tranche.quantity !== null) return { rule: 'GR4', issues: ['remainder quantity must be computed by code'] }
    for (const evidence of tranche.evidence) {
      if (!text.includes(evidence)) return { rule: 'GR1', issues: [`evidence span is not present: ${evidence}`] }
    }
    if (!tranche.quantityIsRemainder && tranche.quantity !== null && !tranche.evidence.some((evidence) => quantityToken(tranche.quantity!).test(evidence))) {
      return { rule: 'GR2', issues: [`quantity ${tranche.quantity} is not grounded in its evidence`] }
    }
    if (tranche.date.type === 'iso') {
      const isoDate = tranche.date.date
      if (!tranche.evidence.some((evidence) => evidence.includes(isoDate))) {
        return { rule: 'GR3', issues: [`date ${isoDate} is not grounded in its evidence`] }
      }
    }
    if (tranche.date.type === 'weekday') {
      const tokens = weekdayEvidenceTokens[tranche.date.weekday]
      if (!tranche.evidence.some((evidence) => tokens.some((token) => evidence.toLocaleLowerCase().includes(token)))) {
        return { rule: 'GR3', issues: [`weekday ${tranche.date.weekday} is not grounded in its evidence`] }
      }
    }
  }
  return null
}

export function validateReplyIntent(raw: unknown, sanitizedText: string): ReplyIntentValidationResult {
  // The model returns the flat wire shape; older records and tests may still hold the internal one.
  const wire = replyIntentWireSchema.safeParse(raw)
  const rebuilt = wire.success ? replyIntentFromWire(wire.data) : null
  const parsed = rebuilt
    ? rebuilt.ok
      ? { success: true as const, data: rebuilt.intent }
      : { success: false as const, error: { issues: rebuilt.issues.map((message) => ({ message })) } }
    : replyIntentSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, code: 'interpretation_invalid_output', issues: parsed.error.issues.map((issue) => issue.message) }
  const consistency = consistencyIssues(parsed.data)
  if (consistency) {
    return {
      ok: false,
      code: consistency.rule === 'IC5' ? 'interpretation_flagged' : 'interpretation_inconsistent',
      rule: consistency.rule,
      issues: consistency.issues,
    }
  }
  const grounding = groundingIssues(parsed.data, sanitizedText)
  if (grounding) return { ok: false, code: 'interpretation_ungrounded', rule: grounding.rule, issues: grounding.issues }
  return {
    ok: true,
    intent: parsed.data,
    checks: { schema: 'pass', consistency: 'pass', grounding: 'pass', rules: ['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'GR1', 'GR2', 'GR3', 'GR4'] },
  }
}

export const validateReplyIntentOutput = validateReplyIntent
