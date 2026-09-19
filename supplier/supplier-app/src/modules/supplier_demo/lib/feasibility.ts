import type { SupplyCommitment } from '../data/entities'

export type FeasibilityRule = 'F1' | 'F2' | 'F3' | 'F4' | 'F5'

export type FeasibilitySlot = {
  date: string
  capacityQuantity: number
  // Quantity already booked by other orders; the case's own allocation is excluded by the caller.
  allocatedQuantity: number
}

export type FeasibilityInput = {
  proposed: SupplyCommitment[]
  accepted: SupplyCommitment[]
  cancelled: SupplyCommitment[]
  // Original delivery date and the quantity already reserved in the warehouse on it.
  // That part of a tranche comes from stock, so only the rest needs production capacity.
  originalDate?: string | null
  warehouseReserved?: number
  // When provided, F5 checks that the accepted production fits the slot capacity.
  slots?: FeasibilitySlot[]
  // ISO date (YYYY-MM-DD); when provided, F4 rejects accepted tranches dated before it.
  today?: string
}

export type FeasibilityResult =
  | { ok: true; production: SupplyCommitment[]; freedCapacity: SupplyCommitment[] }
  | { ok: false; rule: FeasibilityRule; reason: `acceptance_infeasible_${FeasibilityRule}`; freedCapacity: [] }

function fail(rule: FeasibilityRule): FeasibilityResult {
  return { ok: false, rule, reason: `acceptance_infeasible_${rule}`, freedCapacity: [] }
}

function totals(commitments: SupplyCommitment[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const commitment of commitments) result.set(commitment.date, (result.get(commitment.date) ?? 0) + commitment.quantity)
  return result
}

function hasDuplicateDates(commitments: SupplyCommitment[]): boolean {
  return new Set(commitments.map((commitment) => commitment.date)).size !== commitments.length
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function productionQuantity(date: string, quantity: number, originalDate: string | null | undefined, warehouseReserved: number): number {
  return Math.max(0, quantity - (date === originalDate ? warehouseReserved : 0))
}

export function evaluateFeasibility(input: FeasibilityInput): FeasibilityResult {
  // F1 — at least one accepted tranche; every quantity is a positive integer.
  if (!input.accepted.length) return fail('F1')
  if (![...input.accepted, ...input.cancelled].every((entry) => isPositiveInteger(entry.quantity))) return fail('F1')

  // F2 — every accepted and cancelled date was proposed; no date repeats within a list.
  const proposed = totals(input.proposed)
  if (hasDuplicateDates(input.accepted) || hasDuplicateDates(input.cancelled)) return fail('F2')
  if (![...input.accepted, ...input.cancelled].every((entry) => proposed.has(entry.date))) return fail('F2')

  // F3 — for every proposed date: accepted + cancelled == proposed.
  const accepted = totals(input.accepted)
  const cancelled = totals(input.cancelled)
  for (const [date, quantity] of proposed) {
    if ((accepted.get(date) ?? 0) + (cancelled.get(date) ?? 0) !== quantity) return fail('F3')
  }

  // F4 — no accepted tranche is dated in the past.
  if (input.today && input.accepted.some((entry) => entry.date < input.today!)) return fail('F4')

  const reserved = Math.max(0, input.warehouseReserved ?? 0)
  const production = input.accepted
    .map((entry) => ({ date: entry.date, quantity: productionQuantity(entry.date, entry.quantity, input.originalDate, reserved) }))
    .filter((entry) => entry.quantity > 0)

  // F5 — each tranche's production fits the free capacity of the slot on that date.
  if (input.slots) {
    for (const entry of production) {
      const slot = input.slots.find((candidate) => candidate.date === entry.date)
      if (!slot || slot.capacityQuantity - slot.allocatedQuantity < entry.quantity) return fail('F5')
    }
  }

  const freedCapacity: SupplyCommitment[] = []
  for (const [date, quantity] of proposed) {
    const freed = productionQuantity(date, quantity, input.originalDate, reserved)
      - productionQuantity(date, accepted.get(date) ?? 0, input.originalDate, reserved)
    if (freed > 0) freedCapacity.push({ date, quantity: freed })
  }

  return { ok: true, production, freedCapacity }
}

export const checkFeasibility = evaluateFeasibility
