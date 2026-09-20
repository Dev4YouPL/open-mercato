import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { notFound, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SupplyCase, SupplyMessage, SupplierProductionSlot, type SupplyCommitment, type SupplierProductionAllocation } from '../data/entities'
import { emitSupplierDemoEvent } from '../events'
import { evaluateFeasibility } from '../lib/feasibility'
import { isAutoSupplyReplyEnabled } from '../lib/toggles'

type Scope = { tenantId: string; organizationId: string }
type SlotSnapshot = { slotId: string; allocations: SupplierProductionAllocation[] }
type AcceptanceUndoSnapshot = { caseId: string; acceptanceId: string; slots: SlotSnapshot[] }

// A confirmation in one of these states has not left the Supplier yet, so the acceptance can still be undone.
const UNDOABLE_CONFIRMATION_STATES = new Set(['pending', 'enqueue_failed'])

function scopeFrom(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  return { tenantId, organizationId }
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function asCommitments(value: unknown): SupplyCommitment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return typeof row.date === 'string' && typeof row.quantity === 'number'
      ? [{ date: row.date, quantity: row.quantity }]
      : []
  })
}

function payloadOf(message: SupplyMessage): Record<string, unknown> {
  const payload = message.envelopePayload?.payload
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function slotAllocations(slots: SupplierProductionSlot[]): SlotSnapshot[] {
  return slots.map((slot) => ({ slotId: slot.id, allocations: slot.allocations.map((allocation) => ({ ...allocation })) }))
}

async function loadSlots(em: EntityManager, scope: Scope, catalogVariantId: string, lock: boolean): Promise<SupplierProductionSlot[]> {
  return em.find(SupplierProductionSlot, {
    ...scope,
    catalogVariantId,
    deletedAt: null,
  }, { orderBy: { startsAt: 'asc' }, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) })
}

async function emit(scope: Scope, event: Parameters<typeof emitSupplierDemoEvent>[0], payload: Record<string, unknown>): Promise<void> {
  await emitSupplierDemoEvent(event, { ...scope, ...payload }, { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) })
}

type ApplyOutcome = {
  status: string
  confirmationMessageId?: string
  // Set when the case moved to needs_human; the attention event is emitted after commit.
  attentionReason?: string
}

function escalate(supplyCase: SupplyCase, reason: string): ApplyOutcome {
  supplyCase.status = 'needs_human'
  supplyCase.statusReason = reason
  return { status: supplyCase.status, attentionReason: reason }
}

const applyAcceptance: CommandHandler<Record<string, unknown>, { status: string; confirmationMessageId?: string }> = {
  id: 'supplier_demo.supply_case.apply_acceptance',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const caseId = typeof rawInput.caseId === 'string' ? rawInput.caseId : null
    const acceptanceId = typeof rawInput.supplyMessageId === 'string' ? rawInput.supplyMessageId : null
    if (!caseId || !acceptanceId) return null
    const em = entityManager(ctx)
    const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: caseId, ...scope, deletedAt: null }, undefined, scope)
    if (!supplyCase) return null
    const slots = await loadSlots(em, scope, supplyCase.catalogVariantId, false)
    const before: AcceptanceUndoSnapshot = { caseId, acceptanceId, slots: slotAllocations(slots) }
    return { before }
  },
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const caseId = typeof rawInput.caseId === 'string' ? rawInput.caseId : null
    const supplyMessageId = typeof rawInput.supplyMessageId === 'string' ? rawInput.supplyMessageId : null
    if (!caseId || !supplyMessageId) throw new CrudHttpError(422, { error: 'Case and acceptance are required' })
    const replyEnabled = await isAutoSupplyReplyEnabled(ctx.container, scope.tenantId)
    // The slot rows are locked with PESSIMISTIC_WRITE, which needs an open transaction. Subscribers run commands
    // without one, so open it here unless the caller already did.
    const run = (em: EntityManager) => applyInTransaction(em, scope, caseId, supplyMessageId, replyEnabled)
    const outcome = ctx.transactionalEm
      ? await run(ctx.transactionalEm as EntityManager)
      : await entityManager(ctx).transactional((em) => run(em as EntityManager))
    if (outcome.attentionReason) {
      await emit(scope, 'supplier_demo.supply_case.attention_required', { caseId, status: outcome.status, reason: outcome.attentionReason })
    }
    if (outcome.confirmationMessageId) {
      await emit(scope, 'supplier_demo.supply_case.commitment_updated', { caseId, confirmationMessageId: outcome.confirmationMessageId, supplyMessageId: outcome.confirmationMessageId })
    }
    return { status: outcome.status, ...(outcome.confirmationMessageId ? { confirmationMessageId: outcome.confirmationMessageId } : {}) }
  },
  async undo({ logEntry, ctx }) {
    return undoAcceptance(logEntry, ctx)
  },
}

async function applyInTransaction(em: EntityManager, scope: Scope, caseId: string, supplyMessageId: string, replyEnabled: boolean): Promise<ApplyOutcome> {
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: caseId, ...scope, deletedAt: null }, undefined, scope)
  const acceptance = await findOneWithDecryption(em, SupplyMessage, { id: supplyMessageId, supplyCaseId: caseId, ...scope, direction: 'inbound', messageType: 'SUPPLY_ACCEPTANCE', validationStatus: 'valid', deletedAt: null }, undefined, scope)
  if (!supplyCase || !acceptance) throw notFound('Acceptance not found')
  if (acceptance.appliedAt) return { status: 'already_applied' }
  if (supplyCase.status !== 'reply_received') return { status: supplyCase.status }
  if (!replyEnabled) return escalate(supplyCase, 'auto_reply_disabled_apply')

  const payload = payloadOf(acceptance)
  const accepted = asCommitments(payload.acceptedCommitments)
  const cancelled = asCommitments(payload.cancelledCommitments)
  const originalDate = supplyCase.originalCommitment[0]?.date ?? null
  const warehouseReserved = supplyCase.baselineCommitment.find((entry) => entry.date === originalDate)?.quantity ?? 0

  // Lock the slots before evaluating F5 so a concurrent booking cannot overfill them.
  const slots = await loadSlots(em, scope, supplyCase.catalogVariantId, true)
  const feasibility = evaluateFeasibility({
    proposed: supplyCase.currentCommitment,
    accepted,
    cancelled,
    originalDate,
    warehouseReserved,
    today: isoDate(new Date()),
    slots: slots.map((slot) => ({
      date: isoDate(slot.startsAt),
      capacityQuantity: slot.capacityQuantity,
      allocatedQuantity: slot.allocations
        .filter((allocation) => allocation.orderNumber !== supplyCase.orderNumber)
        .reduce((total, allocation) => total + Number(allocation.quantity ?? 0), 0),
    })),
  })
  if (!feasibility.ok) return escalate(supplyCase, feasibility.reason)

  // Book only the production part of each accepted tranche; the warehouse-reserved part comes from stock.
  for (const entry of feasibility.production) {
    const slot = slots.find((candidate) => isoDate(candidate.startsAt) === entry.date)
    if (!slot) continue
    const others = slot.allocations.filter((allocation) => allocation.orderNumber !== supplyCase.orderNumber)
    slot.allocations = [...others, {
      orderNumber: supplyCase.orderNumber,
      quantity: entry.quantity,
      priority: 'normal',
      slaDueAt: entry.date,
      shiftableHours: 0,
      shiftCostPerHour: 0,
    }]
    slot.updatedAt = new Date()
  }

  const now = new Date()
  supplyCase.acceptedCommitment = accepted
  supplyCase.cancelledCommitment = cancelled
  supplyCase.freedCapacity = feasibility.freedCapacity.map((entry) => ({ ...entry }))
  supplyCase.status = 'commitment_updated'
  supplyCase.statusReason = null
  supplyCase.replyReceivedAt ??= acceptance.receivedAt ?? now
  supplyCase.commitmentUpdatedAt = now
  acceptance.appliedAt = now
  const confirmation = em.create(SupplyMessage, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    supplyCaseId: caseId,
    businessMessageId: `MSG-${randomUUID()}`,
    direction: 'outbound',
    messageType: 'SUPPLY_COMMITMENT_CONFIRMED',
    inReplyToBusinessId: acceptance.businessMessageId,
    senderEmail: null,
    recipientEmail: supplyCase.recipientEmail,
    subject: `[${supplyCase.correlationId}] Commitment confirmed — ${supplyCase.sku}`,
    envelopePayload: { schemaVersion: 1, messageId: '', correlationId: supplyCase.correlationId, messageType: 'SUPPLY_COMMITMENT_CONFIRMED', payload: { sku: supplyCase.sku, inReplyToMessageId: acceptance.businessMessageId, confirmedCommitments: accepted, cancelledCommitments: cancelled } },
    deliveryStatus: 'pending',
    duplicateCount: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(confirmation)
  await em.flush()
  return { status: supplyCase.status, confirmationMessageId: confirmation.id }
}

async function undoAcceptance(logEntry: Parameters<typeof extractUndoPayload>[0], ctx: CommandRuntimeContext): Promise<void> {
  const scope = scopeFrom(ctx)
  const snapshot = extractUndoPayload<{ before?: AcceptanceUndoSnapshot }>(logEntry)?.before
  if (!snapshot?.caseId || !Array.isArray(snapshot.slots)) throw new CrudHttpError(422, { error: 'Acceptance undo snapshot is unavailable' })
  const em = entityManager(ctx)
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: snapshot.caseId, ...scope, deletedAt: null }, undefined, scope)
  if (!supplyCase) throw notFound('Supply case not found')
  const confirmations = await findWithDecryption(em, SupplyMessage, { supplyCaseId: snapshot.caseId, ...scope, direction: 'outbound', messageType: 'SUPPLY_COMMITMENT_CONFIRMED', deletedAt: null }, undefined, scope)
  if (confirmations.some((confirmation) => !UNDOABLE_CONFIRMATION_STATES.has(confirmation.deliveryStatus))) {
    throw new CrudHttpError(409, { error: 'The commitment confirmation was already sent', code: 'confirmation_already_sent' })
  }
  for (const slotSnapshot of snapshot.slots) {
    const slot = await em.findOne(SupplierProductionSlot, { id: slotSnapshot.slotId, ...scope, deletedAt: null })
    if (!slot) continue
    slot.allocations = slotSnapshot.allocations.map((allocation) => ({ ...allocation }))
    slot.updatedAt = new Date()
  }
  for (const confirmation of confirmations) confirmation.deletedAt = new Date()
  const acceptance = await findOneWithDecryption(em, SupplyMessage, { id: snapshot.acceptanceId, ...scope, deletedAt: null }, undefined, scope)
  if (acceptance) acceptance.appliedAt = null
  supplyCase.status = 'needs_human'
  supplyCase.statusReason = 'acceptance_undone'
  supplyCase.acceptedCommitment = null
  supplyCase.cancelledCommitment = null
  supplyCase.freedCapacity = null
  supplyCase.commitmentUpdatedAt = null
  await em.flush()
}

registerCommand(applyAcceptance)
