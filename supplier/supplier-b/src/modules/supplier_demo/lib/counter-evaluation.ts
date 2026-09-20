import { createHash, randomUUID } from 'node:crypto'
import type { SupplyCommitment, SupplierProductionAllocation, SupplierProductionSlot } from '../data/entities'
import { evaluate as evaluatePolicy, MAX_AUTO_APPROVED_SHIFT_HOURS, type SupplierPolicyDecision } from './policy'
import { negotiationOptionSchema, type NegotiationOption } from './negotiation-record'

export type CounterFailure = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'T1'

export type CounterEvaluationInput = {
  requested: SupplyCommitment[]
  current: SupplyCommitment[]
  originalDate: string | null
  warehouseReserved: number
  slots: SupplierProductionSlot[]
  caseOrderNumber: string
  negotiationTurn: number
  maxTurns: number
  today?: string
  // Additional cost already applied to the case (initial replan + earlier revisions); the policy limit is cumulative.
  cumulativeCost?: number
}

export type CounterRuleResult = { ok: true; failed: null } | { ok: false; failed: CounterFailure }

type PlannedOption = {
  feasible: boolean
  commitments: SupplyCommitment[]
  movedAllocations: Array<{
    orderNumber?: string
    quantity: number
    fromSlotId?: string
    fromDate: string
    toSlotId?: string
    toDate: string
    toStartsAt: string
    shiftHours: number
  }>
  incrementalCost: number
  maxShiftHours: number
  slaProtected: boolean
  highPriorityAllocationMoved: boolean
}

function dateOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : new Date(value).toISOString().slice(0, 10)
}

function sortCommitments(commitments: SupplyCommitment[]): SupplyCommitment[] {
  return commitments.map((entry) => ({ ...entry })).sort((left, right) => left.date.localeCompare(right.date) || left.quantity - right.quantity)
}

function totals(commitments: SupplyCommitment[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const entry of commitments) result.set(entry.date, (result.get(entry.date) ?? 0) + entry.quantity)
  return result
}

function sameCommitments(left: SupplyCommitment[], right: SupplyCommitment[]): boolean {
  const a = sortCommitments(left)
  const b = sortCommitments(right)
  return a.length === b.length && a.every((entry, index) => entry.date === b[index]?.date && entry.quantity === b[index]?.quantity)
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function validateCounterRules(input: Pick<CounterEvaluationInput, 'requested' | 'current' | 'originalDate' | 'slots' | 'negotiationTurn' | 'maxTurns'> & { today?: string }): CounterRuleResult {
  if (input.requested.length < 1 || input.requested.length > 5 || !input.requested.every((entry) => positiveInteger(entry.quantity) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))) return { ok: false, failed: 'C1' }
  if (new Set(input.requested.map((entry) => entry.date)).size !== input.requested.length) return { ok: false, failed: 'C2' }
  const requestedTotals = totals(input.requested)
  const currentTotal = [...totals(input.current).values()].reduce((sum, value) => sum + value, 0)
  const requestedTotal = [...requestedTotals.values()].reduce((sum, value) => sum + value, 0)
  if (requestedTotal !== currentTotal) return { ok: false, failed: 'C3' }
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  if (input.requested.some((entry) => entry.date < today)) return { ok: false, failed: 'C4' }
  const allowedDates = new Set([input.originalDate, ...input.slots.map((slot) => dateOf(slot.startsAt)).filter(Boolean)])
  if (input.requested.some((entry) => !allowedDates.has(entry.date))) return { ok: false, failed: 'C5' }
  if (sameCommitments(input.requested, input.current)) return { ok: false, failed: 'C6' }
  if (input.negotiationTurn >= input.maxTurns) return { ok: false, failed: 'T1' }
  return { ok: true, failed: null }
}

function allocationQuantity(allocations: SupplierProductionAllocation[] | undefined): number {
  return (allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.quantity ?? 0), 0)
}

function planRequestedCommitment(input: {
  requested: SupplyCommitment[]
  originalDate: string | null
  warehouseReserved: number
  slots: SupplierProductionSlot[]
  caseOrderNumber: string
  // Only moves the Supplier policy can auto-approve: normal priority, declared shift window within the policy limit.
  restrictToPolicy?: boolean
}): PlannedOption {
  const working = input.slots.map((slot) => ({
    slot,
    allocations: slot.allocations.map((allocation) => ({ ...allocation })),
  }))
  // Capacity model (owner decision, same as the initial replan in lib/planner.ts): every unit shipped on a date uses
  // that day's slot capacity, including units already reserved in the warehouse on the original date. So the
  // Supplier never agrees to more on a day than its own planner would have offered.
  const requestedProduction = new Map(input.requested.map((entry) => [entry.date, entry.quantity]))
  const movedAllocations: PlannedOption['movedAllocations'] = []
  let highPriorityAllocationMoved = false
  let infeasible = false

  const slotForDate = (date: string) => working.find((candidate) => dateOf(candidate.slot.startsAt) === date)
  const freeCapacity = (candidate: typeof working[number]) => candidate.slot.capacityQuantity - allocationQuantity(candidate.allocations)
  const reservedAt = (date: string) => requestedProduction.get(date) ?? 0

  for (const [date, required] of [...requestedProduction.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const target = slotForDate(date)
    if (!target) {
      // A tranche fully covered by warehouse stock needs no production slot.
      if (required > 0) infeasible = true
      continue
    }
    let deficit = Math.max(0, required - freeCapacity(target))
    const sourceAllocations = target.allocations
      .filter((allocation) => allocation.orderNumber !== input.caseOrderNumber && Number(allocation.quantity ?? 0) > 0)
      // Same rule as the baseline replan: an allocation without a declared shift window is never moved.
      .filter((allocation) => Number(allocation.shiftableHours ?? 0) > 0)
      .filter((allocation) => !input.restrictToPolicy
        || (allocation.priority !== 'high' && Number(allocation.shiftableHours ?? 0) <= MAX_AUTO_APPROVED_SHIFT_HOURS))
      .sort((left, right) => (left.priority === right.priority ? String(left.orderNumber ?? '').localeCompare(String(right.orderNumber ?? '')) : left.priority === 'normal' ? -1 : 1))
    for (const allocation of sourceAllocations) {
      if (deficit <= 0) break
      const quantity = Number(allocation.quantity ?? 0)
      const destination = working
        .filter((candidate) => dateOf(candidate.slot.startsAt) > date)
        .sort((left, right) => dateOf(left.slot.startsAt).localeCompare(dateOf(right.slot.startsAt)) || left.slot.id.localeCompare(right.slot.id))
        .find((candidate) => freeCapacity(candidate) - reservedAt(dateOf(candidate.slot.startsAt)) >= quantity)
      if (!destination) continue
      target.allocations = target.allocations.filter((candidate) => candidate !== allocation)
      destination.allocations.push({ ...allocation })
      const fromDate = date
      const toDate = dateOf(destination.slot.startsAt)
      // The allocation's declared shift window, as in the baseline replan (not the calendar distance between slots).
      const shiftHours = Number(allocation.shiftableHours ?? 0)
      highPriorityAllocationMoved ||= allocation.priority === 'high'
      movedAllocations.push({ orderNumber: allocation.orderNumber, quantity, fromSlotId: target.slot.id, fromDate, toSlotId: destination.slot.id, toDate, toStartsAt: destination.slot.startsAt.toISOString(), shiftHours })
      deficit -= quantity
    }
    if (deficit > 0 || freeCapacity(target) < required) infeasible = true
  }

  const incrementalCost = movedAllocations.reduce((sum, move) => {
    const source = input.slots.flatMap((slot) => slot.allocations).find((allocation) => allocation.orderNumber === move.orderNumber)
    return sum + move.shiftHours * Number(source?.shiftCostPerHour ?? 0)
  }, 0)
  const slaProtected = movedAllocations.every((move) => {
    const source = input.slots.flatMap((slot) => slot.allocations).find((allocation) => allocation.orderNumber === move.orderNumber)
    const dueAt = source?.slaDueAt ? new Date(source.slaDueAt) : null
    return !dueAt || Number.isNaN(dueAt.getTime()) || new Date(move.toStartsAt) <= dueAt
  })
  return {
    feasible: !infeasible,
    commitments: sortCommitments(input.requested),
    movedAllocations,
    incrementalCost,
    maxShiftHours: movedAllocations.reduce((maximum, move) => Math.max(maximum, move.shiftHours), 0),
    slaProtected,
    highPriorityAllocationMoved,
  }
}

function fingerprint(plan: PlannedOption): string {
  return createHash('sha256').update(JSON.stringify({ commitments: plan.commitments, movedAllocations: plan.movedAllocations, incrementalCost: plan.incrementalCost, maxShiftHours: plan.maxShiftHours, slaProtected: plan.slaProtected, highPriorityAllocationMoved: plan.highPriorityAllocationMoved })).digest('hex')
}

function distance(left: SupplyCommitment[], right: SupplyCommitment[]): number {
  const a = totals(left)
  const b = totals(right)
  return [...new Set([...a.keys(), ...b.keys()])].reduce((sum, date) => sum + Math.abs((a.get(date) ?? 0) - (b.get(date) ?? 0)), 0)
}

function policyFor(plan: PlannedOption, cumulativeCost: number): SupplierPolicyDecision {
  if (!plan.feasible) return 'human_required'
  return evaluatePolicy({
    maxShiftHours: plan.maxShiftHours,
    slaProtected: plan.slaProtected,
    incrementalCost: cumulativeCost + plan.incrementalCost,
    highPriorityAllocationMoved: plan.highPriorityAllocationMoved,
  })
}

function option(id: NegotiationOption['id'], plan: PlannedOption, input: CounterEvaluationInput): NegotiationOption {
  return negotiationOptionSchema.parse({
    id,
    commitments: plan.commitments,
    feasible: plan.feasible,
    policyDecision: policyFor(plan, input.cumulativeCost ?? 0),
    incrementalCost: plan.incrementalCost,
    maxShiftHours: plan.maxShiftHours,
    slaProtected: plan.slaProtected,
    highPriorityAllocationMoved: plan.highPriorityAllocationMoved,
    movedAllocations: plan.movedAllocations,
    executionFingerprint: fingerprint(plan),
    distance: distance(plan.commitments, input.requested),
  })
}

// Greedy "closest feasible split": per requested date (ascending) take the largest quantity that still plans,
// carry the rest to the next requested date and finally to the earliest later slots. The whole split is
// re-planned at the end; a split that does not plan (or, within policy, is not auto-approvable) is dropped.
function closestAlternative(input: CounterEvaluationInput, restrictToPolicy: boolean): PlannedOption | null {
  const cumulativeCost = input.cumulativeCost ?? 0
  const acceptable = (plan: PlannedOption) => plan.feasible && (!restrictToPolicy || policyFor(plan, cumulativeCost) === 'auto_approved')
  const planFor = (requested: SupplyCommitment[]) => planRequestedCommitment({ ...input, requested, restrictToPolicy })
  const requested = sortCommitments(input.requested)
  const fixed: SupplyCommitment[] = []
  let carry = 0
  const placeLargest = (date: string, desired: number) => {
    for (let quantity = desired; quantity > 0; quantity -= 1) {
      if (acceptable(planFor([...fixed, { date, quantity }]))) {
        fixed.push({ date, quantity })
        return quantity
      }
    }
    return 0
  }
  for (const entry of requested) {
    const desired = entry.quantity + carry
    carry = desired - placeLargest(entry.date, desired)
  }
  const lastRequestedDate = requested.at(-1)?.date ?? ''
  const laterDates = [...new Set(input.slots.map((slot) => dateOf(slot.startsAt)))]
    .filter((date) => date > lastRequestedDate)
    .sort()
  for (const date of laterDates) {
    if (carry <= 0) break
    carry -= placeLargest(date, carry)
  }
  if (carry > 0 || fixed.length === 0) return null
  const plan = planFor(fixed)
  return acceptable(plan) ? plan : null
}

export function buildCounterOptions(input: CounterEvaluationInput): NegotiationOption[] {
  const options = [option('requested', planRequestedCommitment(input), input)]
  // An alternative is offered only when it is new: never the buyer's own request and never our current proposal
  // (re-sending the current proposal would burn a negotiation turn without changing anything).
  const isNew = (plan: PlannedOption) => !sameCommitments(plan.commitments, input.current)
    && options.every((candidate) => !sameCommitments(candidate.commitments, plan.commitments))
  const withinPolicy = closestAlternative(input, true)
  if (withinPolicy && isNew(withinPolicy)) options.push(option('alt_within_policy', withinPolicy, input))
  const bestEffort = closestAlternative(input, false)
  if (bestEffort && isNew(bestEffort)) options.push(option('alt_best_effort', bestEffort, input))
  return options.slice(0, 3)
}

export function evaluateCounter(input: CounterEvaluationInput): { evaluationId: string; rule: CounterRuleResult; options: NegotiationOption[]; reasonCodes: string[] } {
  const rule = validateCounterRules(input)
  if (!rule.ok) return { evaluationId: randomUUID(), rule, options: [], reasonCodes: [`counter_invalid_${rule.failed}`] }
  const options = buildCounterOptions(input)
  const requested = options[0]
  const hasWithinPolicy = options.some((candidate) => candidate.id === 'alt_within_policy')
  const hasBestEffort = options.some((candidate) => candidate.id === 'alt_best_effort')
  const reasonCodes = requested?.feasible
    ? requested.policyDecision === 'auto_approved' ? ['requested_feasible_within_policy'] : ['requested_needs_human_approval']
    : ['requested_infeasible_capacity', hasWithinPolicy ? 'alternative_closest_within_policy' : hasBestEffort ? 'alternative_best_effort_only' : 'no_feasible_option']
  return { evaluationId: randomUUID(), rule, options, reasonCodes }
}
