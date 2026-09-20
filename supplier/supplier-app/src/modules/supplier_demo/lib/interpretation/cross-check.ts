import type { SupplyCommitment } from '../../data/entities'
import type { ReplyIntent } from './reply-intent'
import { resolveDateExpression } from './resolve'

export type InterpretationCrossCheck = {
  ok: boolean
  explicit: Array<{ quantity: number; date: string }>
  extracted: Array<{ quantity: number; date: string }>
  reason: 'match' | 'quantity_mismatch' | 'date_mismatch' | 'unresolved_date' | 'no_explicit_pairs'
}

const weekdayTokens: Array<{ names: string[]; weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' }> = [
  { names: ['monday', 'mon', 'poniedział', 'pon'], weekday: 'mon' },
  { names: ['tuesday', 'tue', 'wtorek', 'wtork'], weekday: 'tue' },
  { names: ['wednesday', 'wed', 'środa', 'środę', 'środ'], weekday: 'wed' },
  { names: ['thursday', 'thu', 'czwartek', 'czwart'], weekday: 'thu' },
  { names: ['friday', 'fri', 'piątek', 'piątk'], weekday: 'fri' },
  { names: ['saturday', 'sat', 'sobota', 'sobot'], weekday: 'sat' },
  { names: ['sunday', 'sun', 'niedziela', 'niedziel'], weekday: 'sun' },
]

function sortedPairs(value: Array<{ quantity: number; date: string }>): Array<{ quantity: number; date: string }> {
  return [...value].sort((left, right) => left.date.localeCompare(right.date) || left.quantity - right.quantity)
}

function samePairs(left: Array<{ quantity: number; date: string }>, right: Array<{ quantity: number; date: string }>): boolean {
  const a = sortedPairs(left)
  const b = sortedPairs(right)
  return a.length === b.length && a.every((entry, index) => entry.quantity === b[index]?.quantity && entry.date === b[index]?.date)
}

function extractedDates(text: string): Array<{ index: number; expression: ReplyIntent['tranches'][number]['date'] }> {
  const dates: Array<{ index: number; expression: ReplyIntent['tranches'][number]['date'] }> = []
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
    dates.push({ index: match.index ?? 0, expression: { type: 'iso', date: match[1] } })
  }
  const lower = text.toLocaleLowerCase()
  weekdayTokens.forEach(({ names, weekday }) => names.forEach((name) => {
    let start = 0
    while (start < lower.length) {
      const index = lower.indexOf(name, start)
      if (index < 0) break
      const before = lower.slice(Math.max(0, index - 12), index)
      dates.push({ index, expression: { type: 'weekday', weekday, which: /\b(next|następ|przyszł)/i.test(before) ? 'next' : 'this' } })
      start = index + name.length
    }
  }))
  return dates
    .sort((left, right) => left.index - right.index || (left.expression.type === 'weekday' && right.expression.type === 'weekday' ? right.expression.weekday.length - left.expression.weekday.length : 0))
    .filter((entry, index, all) => index === 0 || entry.index !== all[index - 1]?.index)
}

// Every number outside a date is a candidate quantity. Quantities the buyer quotes back from our own proposal are
// NOT filtered out: a counter usually repeats them ("400 on Wednesday, 100 on Saturday"), and dropping them left
// the extractor with nothing to compare, so the cross-check could never agree. An extra quoted number now produces
// a mismatch, which sends the case to a human — the safe direction.
function extractedQuantities(text: string): Array<{ index: number; quantity: number }> {
  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => ({ index: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
  return [...text.matchAll(/\b\d+\b/g)].flatMap((match) => {
    const index = match.index ?? 0
    if (dates.some((date) => index >= date.index && index < date.end)) return []
    const quantity = Number(match[0])
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return []
    return [{ index, quantity }]
  })
}

export function deterministicCrossCheck(input: {
  text: string
  intent: ReplyIntent
  currentCommitment: SupplyCommitment[]
  originalCommitment: SupplyCommitment[]
  today: string
}): InterpretationCrossCheck {
  const explicitIntent = input.intent.tranches.filter((tranche) => !tranche.quantityIsRemainder && tranche.quantity !== null)
  const explicit = explicitIntent.flatMap((tranche) => {
    const resolved = resolveDateExpression({ expression: tranche.date, today: input.today, originalDate: input.originalCommitment[0]?.date ?? null })
    return resolved.ok && resolved.value.kind === 'exact' ? [{ quantity: tranche.quantity as number, date: resolved.value.date }] : []
  })
  if (explicit.length !== explicitIntent.length) return { ok: false, explicit, extracted: [], reason: 'unresolved_date' }
  const quantities = extractedQuantities(input.text).sort((left, right) => left.index - right.index)
  const dates = extractedDates(input.text)
  const extracted = quantities.slice(0, dates.length).flatMap((quantity, index) => {
    const date = dates[index]
    if (!date) return []
    const resolved = resolveDateExpression({ expression: date.expression, today: input.today, originalDate: input.originalCommitment[0]?.date ?? null })
    return resolved.ok && resolved.value.kind === 'exact' ? [{ quantity: quantity.quantity, date: resolved.value.date }] : []
  })
  if (explicit.length === 0 || extracted.length === 0) return { ok: false, explicit, extracted, reason: 'no_explicit_pairs' }
  const quantitiesMatch = sortedPairs(explicit).map((entry) => entry.quantity).join(',') === sortedPairs(extracted).map((entry) => entry.quantity).join(',')
  if (!quantitiesMatch) return { ok: false, explicit, extracted, reason: 'quantity_mismatch' }
  return { ok: samePairs(explicit, extracted), explicit, extracted, reason: samePairs(explicit, extracted) ? 'match' : 'date_mismatch' }
}
