import type { SupplierProductionSlot, SupplyCommitment } from '../../data/entities'
import { buildCounterOptions } from '../counter-evaluation'
import type { DateExpression, ReplyIntent, ReplyIntentTranche } from './reply-intent'

export const DEFAULT_INTERPRETATION_HORIZON_DAYS = 21

export type ResolutionPlacement = 'exact' | 'window_earliest' | 'asap' | 'unplaceable'

export type ResolvedInterpretationTranche = {
  quantity: number
  date: string
  source: 'explicit' | 'remainder'
  expression: DateExpression['type']
  placement: ResolutionPlacement
}

export type ReplyResolution = {
  today: string
  tranches: ResolvedInterpretationTranche[]
}

export type ResolveReplyIntentInput = {
  intent: ReplyIntent
  today: string | Date
  currentCommitment: SupplyCommitment[]
  originalCommitment?: SupplyCommitment[]
  slots: SupplierProductionSlot[]
  caseOrderNumber?: string
  horizonDays?: number
}

export type ResolveReplyIntentResult = {
  ok: true
  commitments: SupplyCommitment[]
  resolution: ReplyResolution
} | {
  ok: false
  code: 'interpretation_date_unresolved' | 'interpretation_total_mismatch' | 'interpretation_duplicate_date'
  resolution?: ReplyResolution
}

type WeekdayExpression = Extract<DateExpression, { type: 'weekday' }>
type ResolvedExpression = { kind: 'exact'; date: string } | { kind: 'window'; start: string; end: string } | { kind: 'relative'; start: string; end: string }

function isoDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function weekdayIndex(value: WeekdayExpression['weekday']): number {
  return { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 }[value]
}

function mondayOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - day + 1)
  return value.toISOString().slice(0, 10)
}

function resolveExpression(input: { expression: DateExpression; today: string; originalDate?: string | null; horizonDays?: number }): ResolvedExpression | null {
  const expression = input.expression
  if (expression.type === 'iso') return { kind: 'exact', date: expression.date }
  if (expression.type === 'original_date') return input.originalDate ? { kind: 'exact', date: input.originalDate } : null
  if (expression.type === 'weekday') {
    const todayValue = new Date(`${input.today}T00:00:00.000Z`)
    const todayDay = todayValue.getUTCDay()
    const targetDay = weekdayIndex(expression.weekday)
    const currentDelta = (targetDay - todayDay + 7) % 7
    const delta = expression.which === 'this' ? currentDelta : currentDelta + 7
    return { kind: 'exact', date: addDays(input.today, delta) }
  }
  if (expression.type === 'week') {
    const start = addDays(mondayOfWeek(input.today), expression.offset * 7)
    return { kind: 'window', start, end: addDays(start, 4) }
  }
  return { kind: 'relative', start: input.today, end: addDays(input.today, input.horizonDays ?? DEFAULT_INTERPRETATION_HORIZON_DAYS) }
}

export function resolveDateExpression(input: { expression: DateExpression; today: string | Date; originalDate?: string | null; horizonDays?: number }): { ok: true; value: ResolvedExpression } | { ok: false; code: 'interpretation_date_unresolved' } {
  const today = isoDate(input.today)
  const value = resolveExpression({ ...input, today })
  if (!value) return { ok: false, code: 'interpretation_date_unresolved' }
  if (value.kind === 'exact' && value.date < today) return { ok: false, code: 'interpretation_date_unresolved' }
  return { ok: true, value }
}

function feasibleCommitment(commitments: SupplyCommitment[], input: ResolveReplyIntentInput): boolean {
  const options = buildCounterOptions({
    requested: commitments,
    current: input.currentCommitment,
    originalDate: input.originalCommitment?.[0]?.date ?? null,
    warehouseReserved: 0,
    slots: input.slots,
    caseOrderNumber: input.caseOrderNumber ?? '__reply_interpreter__',
    negotiationTurn: 0,
    maxTurns: 1,
    today: isoDate(input.today),
  })
  return options[0]?.feasible === true
}

function datesInRange(slots: SupplierProductionSlot[], start: string, end: string): string[] {
  return [...new Set(slots.map((slot) => slot.startsAt.toISOString().slice(0, 10)))]
    .filter((date) => date >= start && date <= end)
    .sort()
}

function explicitTotal(tranches: ReplyIntentTranche[]): number {
  return tranches.reduce((total, tranche) => total + (tranche.quantityIsRemainder ? 0 : tranche.quantity ?? 0), 0)
}

function chooseDate(input: { expression: ResolvedExpression; quantity: number; resolved: SupplyCommitment[]; context: ResolveReplyIntentInput; afterDate?: string }): { date: string; placement: ResolutionPlacement } | null {
  if (input.expression.kind === 'exact') return { date: input.expression.date, placement: 'exact' }
  const today = isoDate(input.context.today)
  const lowerBound = input.expression.kind === 'relative'
    ? input.afterDate ? addDays(input.afterDate, 1) : today
    : input.expression.start
  const candidates = datesInRange(input.context.slots, lowerBound, input.expression.end)
  const candidate = candidates.find((date) => feasibleCommitment([...input.resolved, { quantity: input.quantity, date }], input.context))
  if (candidate) return { date: candidate, placement: input.expression.kind === 'window' ? 'window_earliest' : 'asap' }
  const fallback = input.expression.kind === 'window' ? input.expression.end : input.expression.end
  return { date: fallback < (isoDate(input.context.today)) ? isoDate(input.context.today) : fallback, placement: 'unplaceable' }
}

export function resolveReplyIntent(input: ResolveReplyIntentInput): ResolveReplyIntentResult {
  const today = isoDate(input.today)
  const originalDate = input.originalCommitment?.[0]?.date ?? null
  const remainderQuantity = input.currentCommitment.reduce((total, entry) => total + entry.quantity, 0) - explicitTotal(input.intent.tranches)
  // A remainder of zero is not a tranche: when the mail already names every quantity, a "rest" the model added on
  // top of them describes nothing and must not fail the whole reading.
  const tranchesToResolve = remainderQuantity <= 0
    ? input.intent.tranches.filter((tranche) => !tranche.quantityIsRemainder)
    : input.intent.tranches
  const remainderTranches = tranchesToResolve.filter((tranche) => tranche.quantityIsRemainder)
  const totalMismatch = remainderQuantity < 0 || (remainderTranches.length > 0 && remainderQuantity <= 0) || (remainderTranches.length === 0 && remainderQuantity !== 0)

  const resolved: ResolvedInterpretationTranche[] = []
  let lastExplicitDate: string | undefined
  for (const tranche of tranchesToResolve) {
    const expressionResult = resolveDateExpression({ expression: tranche.date, today, originalDate, horizonDays: input.horizonDays })
    if (!expressionResult.ok) return { ok: false, code: expressionResult.code }
    if (tranche.quantityIsRemainder && remainderQuantity <= 0) return { ok: false, code: 'interpretation_total_mismatch', resolution: { today, tranches: resolved } }
    const quantity = tranche.quantityIsRemainder ? remainderQuantity : tranche.quantity!
    const chosen = chooseDate({
      expression: expressionResult.value,
      quantity,
      resolved: resolved.map((entry) => ({ quantity: entry.quantity, date: entry.date })),
      context: input,
      afterDate: lastExplicitDate,
    })
    if (!chosen) return { ok: false, code: 'interpretation_date_unresolved' }
    if (chosen.date < today) return { ok: false, code: 'interpretation_date_unresolved' }
    if (resolved.some((entry) => entry.date === chosen.date)) return { ok: false, code: 'interpretation_duplicate_date' }
    resolved.push({ quantity, date: chosen.date, source: tranche.quantityIsRemainder ? 'remainder' : 'explicit', expression: tranche.date.type, placement: chosen.placement })
    if (!tranche.quantityIsRemainder) lastExplicitDate = !lastExplicitDate || chosen.date > lastExplicitDate ? chosen.date : lastExplicitDate
  }

  const commitments = resolved.map(({ quantity, date }) => ({ quantity, date })).sort((left, right) => left.date.localeCompare(right.date))
  const resolution = { today, tranches: resolved }
  if (totalMismatch || commitments.reduce((total, entry) => total + entry.quantity, 0) !== input.currentCommitment.reduce((total, entry) => total + entry.quantity, 0)) return { ok: false, code: 'interpretation_total_mismatch', resolution }
  return { ok: true, commitments, resolution }
}

export const resolveInterpretation = resolveReplyIntent
