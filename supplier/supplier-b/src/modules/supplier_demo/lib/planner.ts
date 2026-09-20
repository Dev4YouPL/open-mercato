import type { SupplyCommitment } from '../data/entities'

export type PlannerSlot = {
  id?: string
  date?: string | Date
  startsAt?: string | Date
  capacityQuantity?: number
  freeCapacity?: number
  allocations?: PlannerAllocation[]
}

export type PlannerAllocation = {
  orderNumber?: string
  quantity?: number
  priority?: 'normal' | 'high'
  slaDueAt?: string | Date
  shiftableHours?: number
  shiftCostPerHour?: number
}

export type BaselinePlan = {
  ok: true
  commitments: SupplyCommitment[]
} | {
  ok: false
  reason: 'no_capacity' | 'commitment_in_past'
}

export type ReplanMovedAllocation = {
  orderNumber: string
  quantity: number
  fromSlotId?: string
  fromDate: string
  toSlotId?: string
  toDate: string
  toStartsAt: string
  shiftHours: number
}

export type ReplanResult = {
  ok: true
  commitments: SupplyCommitment[]
  movedAllocations: ReplanMovedAllocation[]
  incrementalCost: number
  currency: string
  slaProtected: boolean
  maxShiftHours: number
  highPriorityAllocationMoved: boolean
}

function isoDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

function slotDate(slot: PlannerSlot): string | null {
  const value = slot.date ?? slot.startsAt
  return value ? isoDate(value) : null
}

function slotFreeCapacity(slot: PlannerSlot): number {
  if (typeof slot.freeCapacity === 'number') return Math.max(0, slot.freeCapacity)
  const allocated = (slot.allocations ?? []).reduce((total, allocation) => total + (allocation.quantity ?? 0), 0)
  return Math.max(0, (slot.capacityQuantity ?? 0) - allocated)
}

function cloneSlots(slots: PlannerSlot[]): PlannerSlot[] {
  return slots.map((slot) => ({
    ...slot,
    allocations: (slot.allocations ?? []).map((allocation) => ({ ...allocation })),
  }))
}

function commitmentQuantityOnDate(commitments: SupplyCommitment[], date: string): number {
  return commitments
    .filter((commitment) => commitment.date === date)
    .reduce((total, commitment) => total + commitment.quantity, 0)
}

function isBetterCommitment(candidate: SupplyCommitment[], baseline: SupplyCommitment[], expectedDate: string): boolean {
  const candidateOnOriginalDate = commitmentQuantityOnDate(candidate, expectedDate)
  const baselineOnOriginalDate = commitmentQuantityOnDate(baseline, expectedDate)
  return candidateOnOriginalDate > baselineOnOriginalDate
}

function replanCommitments(input: {
  requiredQuantity: number
  reservedQuantity: number
  expectedDate: string
  slots: PlannerSlot[]
}): SupplyCommitment[] | null {
  const shortfallQuantity = Math.max(0, input.requiredQuantity - input.reservedQuantity)
  let remaining = shortfallQuantity
  const commitments: SupplyCommitment[] = []

  for (const slot of input.slots) {
    const date = slotDate(slot)
    if (!date || date < input.expectedDate) continue
    const allocated = (slot.allocations ?? []).reduce((total, allocation) => total + (allocation.quantity ?? 0), 0)
    const reserved = date === input.expectedDate ? input.reservedQuantity : 0
    const available = Math.max(0, (slot.capacityQuantity ?? 0) - allocated - reserved)
    const quantity = Math.min(remaining, available)
    if (date === input.expectedDate && input.reservedQuantity > 0) {
      commitments.push({ quantity: input.reservedQuantity + quantity, date })
    } else if (quantity > 0) {
      commitments.push({ quantity, date })
    }
    remaining -= quantity
    if (remaining === 0) break
  }

  return remaining === 0 ? commitments : null
}

export function planBaselineCommitment(input: {
  requiredQuantity: number
  reservedQuantity: number
  expectedDeliveryAt: string | Date
  slots: PlannerSlot[]
  today?: string | Date
}): BaselinePlan {
  const shortfallQuantity = Math.max(0, input.requiredQuantity - input.reservedQuantity)
  if (shortfallQuantity === 0) return { ok: true, commitments: input.reservedQuantity > 0 ? [{ quantity: input.reservedQuantity, date: isoDate(input.expectedDeliveryAt) }] : [] }

  const today = isoDate(input.today ?? new Date())
  const expectedDate = isoDate(input.expectedDeliveryAt)
  if (expectedDate < today) return { ok: false, reason: 'commitment_in_past' }

  let remaining = shortfallQuantity
  const commitments: SupplyCommitment[] = input.reservedQuantity > 0
    ? [{ quantity: input.reservedQuantity, date: expectedDate }]
    : []
  const slots = input.slots
    .map((slot) => {
      const date = slotDate(slot)
      return date ? { date, freeCapacity: slotFreeCapacity(slot) } : null
    })
    .filter((slot): slot is { date: string; freeCapacity: number } => slot !== null && slot.date >= expectedDate)
    .sort((left, right) => left.date.localeCompare(right.date))

  const slot = slots.find((candidate) => candidate.freeCapacity >= remaining)
  if (slot) {
    commitments.push({ quantity: remaining, date: slot.date })
    remaining = 0
  }

  if (remaining > 0) return { ok: false, reason: 'no_capacity' }
  return { ok: true, commitments }
}

export const planBaseline = planBaselineCommitment

export function replan(input: {
  requiredQuantity: number
  reservedQuantity: number
  expectedDeliveryAt: string | Date
  baselineCommitment: SupplyCommitment[]
  slots: PlannerSlot[]
  currency?: string
  maxShiftHours?: number
}): ReplanResult {
  const expectedDate = isoDate(input.expectedDeliveryAt)
  const workingSlots = cloneSlots(input.slots)
  const originalSlot = workingSlots
    .filter((slot) => slotDate(slot) === expectedDate)
    .sort((left, right) => String(left.id ?? '').localeCompare(String(right.id ?? '')))[0]
  const maxAllowedShiftHours = Math.min(4, input.maxShiftHours ?? 4)
  const movedAllocations: ReplanMovedAllocation[] = []
  // High-priority allocations are never moved. The policy flag below is raised only when such an allocation was
  // skipped AND the normal-priority moves could not improve the commitment, i.e. recovery would require touching
  // a high-priority order.
  let skippedHighPriorityAllocation = false

  if (originalSlot) {
    const originalAllocations = [...(originalSlot.allocations ?? [])]
      .filter((allocation) => (allocation.quantity ?? 0) > 0)
      .sort((left, right) => String(left.orderNumber ?? '').localeCompare(String(right.orderNumber ?? '')))
    const laterSlots = workingSlots
      .filter((slot) => {
        const date = slotDate(slot)
        return Boolean(date && date > expectedDate)
      })
      .sort((left, right) => {
        const dateOrder = String(slotDate(left)).localeCompare(String(slotDate(right)))
        return dateOrder || String(left.id ?? '').localeCompare(String(right.id ?? ''))
      })

    for (const allocation of originalAllocations) {
      const quantity = allocation.quantity ?? 0
      if (allocation.priority === 'high') {
        skippedHighPriorityAllocation = true
        continue
      }
      const shiftableHours = Math.max(0, allocation.shiftableHours ?? 0)
      if (shiftableHours <= 0 || !allocation.orderNumber) continue
      const target = laterSlots.find((slot) => slotFreeCapacity(slot) >= quantity)
      if (!target) continue
      const targetDate = slotDate(target)
      if (!targetDate) continue
      const shiftHours = Math.min(maxAllowedShiftHours, shiftableHours)
      if (shiftHours <= 0) continue
      originalSlot.allocations = (originalSlot.allocations ?? []).filter((candidate) => candidate !== allocation)
      target.allocations = [...(target.allocations ?? []), { ...allocation }]
      movedAllocations.push({
        orderNumber: allocation.orderNumber,
        quantity,
        fromSlotId: originalSlot.id,
        fromDate: expectedDate,
        toSlotId: target.id,
        toDate: targetDate,
        toStartsAt: target.startsAt ? new Date(target.startsAt).toISOString() : `${targetDate}T00:00:00.000Z`,
        shiftHours,
      })
    }
  }

  const replannedCommitment = replanCommitments({
    requiredQuantity: input.requiredQuantity,
    reservedQuantity: input.reservedQuantity,
    expectedDate,
    slots: workingSlots.sort((left, right) => String(slotDate(left)).localeCompare(String(slotDate(right)))),
  })
  const improved = replannedCommitment !== null && isBetterCommitment(replannedCommitment, input.baselineCommitment, expectedDate)
  if (!improved) {
    return {
      ok: true,
      commitments: input.baselineCommitment.map((commitment) => ({ ...commitment })),
      movedAllocations: [],
      incrementalCost: 0,
      currency: input.currency ?? 'PLN',
      slaProtected: true,
      maxShiftHours: 0,
      highPriorityAllocationMoved: skippedHighPriorityAllocation,
    }
  }

  const movedByOrderNumber = new Map(movedAllocations.map((move) => [move.orderNumber, move]))
  const slaProtected = movedAllocations.every((move) => {
    const allocation = input.slots
      .flatMap((slot) => slot.allocations ?? [])
      .find((candidate) => candidate.orderNumber === move.orderNumber)
    const dueAt = allocation?.slaDueAt ? new Date(allocation.slaDueAt) : null
    const endsAt = new Date(move.toStartsAt)
    return Boolean(dueAt && !Number.isNaN(dueAt.getTime()) && endsAt <= dueAt)
  })
  const incrementalCost = movedAllocations.reduce((total, move) => {
    const allocation = input.slots
      .flatMap((slot) => slot.allocations ?? [])
      .find((candidate) => candidate.orderNumber === move.orderNumber)
    return total + move.shiftHours * (allocation?.shiftCostPerHour ?? 0)
  }, 0)

  return {
    ok: true,
    commitments: replannedCommitment,
    movedAllocations: [...movedByOrderNumber.values()],
    incrementalCost,
    currency: input.currency ?? 'PLN',
    slaProtected,
    maxShiftHours: movedAllocations.reduce((maximum, move) => Math.max(maximum, move.shiftHours), 0),
    highPriorityAllocationMoved: false,
  }
}
