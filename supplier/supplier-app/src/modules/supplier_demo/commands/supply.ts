import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { conflict, notFound, badRequest, CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { MessageChannelLink } from '@open-mercato/core/modules/communication_channels/data/entities'
import {
  SupplyCase,
  SupplyMessage,
  SupplierProductionSlot,
  type SupplyCaseStatus,
  type SupplyMessageDeliveryStatus,
  type SupplierProductionAllocation,
} from '../data/entities'
import { emitSupplierDemoEvent } from '../events'
import { resolveMailboxActor, sendSupplyMail, SupplierDemoMailboxError } from '../lib/mailbox'
import { composeCommitmentConfirmation, composeSupplyProposal } from '../lib/compose'
import { planBaselineCommitment, replan, type ReplanMovedAllocation } from '../lib/planner'
import { evaluate } from '../lib/policy'
import { resolveSupplyRecipient } from '../lib/recipient'
import { isAutoNegotiationEnabled, isAutoSupplyProposalEnabled, isAutoSupplyReplyEnabled } from '../lib/toggles'
import { HELD_REVISION_REASONS, parseNegotiationRecord } from '../lib/negotiation-record'
import { parseSupplierAgentConfig } from '../lib/agent/config'

type Scope = { tenantId: string; organizationId: string }

function maxNegotiationTurns(): number {
  const config = parseSupplierAgentConfig()
  return config.ok ? config.config.maxNegotiationTurns : 3
}

type Shortfall = {
  catalogVariantId: string
  requiredQuantity: number
  reservedQuantity: number
  shortfallQuantity: number
}

type OpenInput = {
  salesOrderId: string
  orderNumber: string
  shortfalls: Shortfall[]
  trigger?: 'wms_shortfall' | 'manual_disruption'
}

type ReportDisruptionInput = {
  salesOrderId: string
  availableQuantity: number
}

type SalesOrderLineRow = {
  kind: string
  product_variant_id: string | null
  quantity: string | number
}

type HubDeliveryInput = {
  messageId?: string
  externalMessageId?: string | null
  channelLinkId?: string | null
  conversationId?: string | null
  channelId?: string | null
  providerKey?: string | null
  channelType?: string | null
  direction?: string | null
  transient?: boolean
  error?: string | null
  status?: string | null
}

type CommandContainer = CommandRuntimeContext['container']

function requireScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  return { tenantId, organizationId }
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
}

function commandContext(container: CommandContainer, scope: Scope): CommandRuntimeContext {
  return {
    container,
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

async function emitAfterCommit(event: Parameters<typeof emitSupplierDemoEvent>[0], payload: Record<string, unknown>): Promise<void> {
  await emitSupplierDemoEvent(event, payload, {
    persistent: true,
    ...({ deliverInline: false } as Record<string, unknown>),
  })
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

async function loadOrder(ctx: CommandRuntimeContext, scope: Scope, orderId: string): Promise<SalesOrder | null> {
  const em = entityManager(ctx)
  return findOneWithDecryption(em, SalesOrder, {
    id: orderId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
}

async function loadVariant(ctx: CommandRuntimeContext, scope: Scope, variantId: string): Promise<{ sku: string; name: string }> {
  const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
  const result = await queryEngine.query(E.catalog.catalog_product_variant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { id: { $eq: variantId } },
    fields: ['id', 'sku', 'name'],
    page: { page: 1, pageSize: 1 },
  })
  const row = result.items?.[0] as Record<string, unknown> | undefined
  return { sku: asString(row?.sku) ?? variantId, name: asString(row?.name) ?? variantId }
}

function asValidDate(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === 'string' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function productionSlots(em: EntityManager, scope: Scope, variantId: string): Promise<SupplierProductionSlot[]> {
  return em.find(SupplierProductionSlot, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    catalogVariantId: variantId,
    deletedAt: null,
  }, { orderBy: { startsAt: 'asc' } })
}

type ProductionSlotUndoSnapshot = {
  slotId: string
  allocations: SupplierProductionAllocation[]
}

type OpenSupplyCaseUndoSnapshot = {
  productionSlots: ProductionSlotUndoSnapshot[]
}

function copyAllocations(allocations: SupplierProductionAllocation[]): SupplierProductionAllocation[] {
  return allocations.map((allocation) => ({ ...allocation }))
}

async function applyReplanSlotMoves(
  em: EntityManager,
  scope: Scope,
  movedAllocations: ReplanMovedAllocation[],
): Promise<void> {
  for (const move of movedAllocations) {
    if (!move.fromSlotId || !move.toSlotId) continue
    const source = await em.findOne(SupplierProductionSlot, {
      id: move.fromSlotId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    const target = await em.findOne(SupplierProductionSlot, {
      id: move.toSlotId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!source || !target) continue
    const allocation = source.allocations.find((candidate) => candidate.orderNumber === move.orderNumber)
    if (!allocation) continue
    source.allocations = source.allocations.filter((candidate) => candidate !== allocation)
    target.allocations = [...target.allocations, { ...allocation }]
    source.updatedAt = new Date()
    target.updatedAt = new Date()
  }
}

function senderAddress(): string {
  return process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS?.trim() ?? ''
}

async function resolveSenderAddress(em: EntityManager, scope: Scope): Promise<string> {
  try {
    const actor = await resolveMailboxActor({ em, expectedScope: scope })
    return asString(actor.fromAddress) ?? senderAddress()
  } catch (error) {
    if (error instanceof SupplierDemoMailboxError) return senderAddress()
    throw error
  }
}

function isBlockingMailboxError(error: SupplierDemoMailboxError): boolean {
  return ['mailbox_channel_id_missing', 'mailbox_user_id_missing', 'mailbox_configuration_invalid', 'mailbox_user_not_found', 'mailbox_not_configured'].includes(error.code)
}

function scopePayload(scope: Scope, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId, ...extra }
}

const openSupplyCase: CommandHandler<Record<string, unknown>, { caseId: string; status: SupplyCaseStatus; created: boolean }> = {
  id: 'supplier_demo.supply_case.open_from_shortfall',
  isUndoable: true,
  async prepare(_rawInput, ctx) {
    const scope = requireScope(ctx)
    const input = _rawInput as unknown as OpenInput
    if (!Array.isArray(input.shortfalls)) return null
    const shortfall = input.shortfalls?.[0]
    if (!shortfall || typeof shortfall.catalogVariantId !== 'string') return null
    const slots = await productionSlots(entityManager(ctx), scope, shortfall.catalogVariantId)
    return {
      before: {
        productionSlots: slots.map((slot) => ({
          slotId: slot.id,
          allocations: copyAllocations(slot.allocations),
        })),
      },
    }
  },
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const input = rawInput as unknown as OpenInput
    if (!input.salesOrderId || !input.orderNumber || !Array.isArray(input.shortfalls)) throw badRequest('Invalid shortfall input')
    if (!(await isAutoSupplyProposalEnabled(ctx.container, scope.tenantId)) && input.trigger !== 'manual_disruption') {
      return { caseId: '', status: 'detected', created: false }
    }

    const em = entityManager(ctx)
    const existing = await findOneWithDecryption(em, SupplyCase, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      salesOrderId: input.salesOrderId,
      deletedAt: null,
    }, undefined, scope)
    if (existing) {
      const pendingMessage = await findOneWithDecryption(em, SupplyMessage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplyCaseId: existing.id,
        deliveryStatus: 'pending',
        deletedAt: null,
      }, undefined, scope)
      if (existing.status === 'proposal_ready' && pendingMessage) {
        await emitAfterCommit('supplier_demo.supply_case.proposal_ready', scopePayload(scope, {
          caseId: existing.id,
          supplyMessageId: pendingMessage.id,
          correlationId: existing.correlationId,
        }))
      }
      return { caseId: existing.id, status: existing.status, created: false }
    }

    const order = await loadOrder(ctx, scope, input.salesOrderId)
    const shortfall = input.shortfalls[0]
    if (!shortfall) throw badRequest('Shortfall is required')
    const variant = await loadVariant(ctx, scope, shortfall.catalogVariantId)
    const expectedDeliveryAt = asValidDate(order?.expectedDeliveryAt)
    const customerSnapshot = order?.customerSnapshot as Record<string, unknown> | null | undefined
    const recipient = resolveSupplyRecipient(customerSnapshot)
    const sender = await resolveSenderAddress(em, scope)
    let status: SupplyCaseStatus
    let reason: string | null
    let baselineCommitment = [] as SupplyCase['baselineCommitment']
    let currentCommitment = [] as SupplyCase['currentCommitment']
    let originalCommitment = [] as SupplyCase['originalCommitment']
    let planSummary: Record<string, unknown> | null = null
    let riskLevel: string | null = null
    let policyDecision: string | null = null
    let additionalCost: string | null = null
    let movedAllocations: ReplanMovedAllocation[] = []
    if (!order) {
      status = 'escalated'
      reason = 'order_not_found'
    } else if (!expectedDeliveryAt) {
      status = 'escalated'
      reason = 'missing_delivery_date'
    } else if (input.shortfalls.length > 1) {
      status = 'escalated'
      reason = 'multi_sku'
    } else {
      const slots = await productionSlots(em, scope, shortfall.catalogVariantId)
      const plan = planBaselineCommitment({
        requiredQuantity: asNumber(shortfall.requiredQuantity),
        reservedQuantity: asNumber(shortfall.reservedQuantity),
        expectedDeliveryAt,
        slots: slots.map((slot) => ({ startsAt: slot.startsAt, capacityQuantity: slot.capacityQuantity, allocations: slot.allocations })),
      })
      baselineCommitment = plan.ok ? plan.commitments : []
      const replanned = plan.ok
        ? replan({
          requiredQuantity: asNumber(shortfall.requiredQuantity),
          reservedQuantity: asNumber(shortfall.reservedQuantity),
          expectedDeliveryAt,
          baselineCommitment,
          currency: asString(order?.currencyCode) ?? 'PLN',
          slots: slots.map((slot) => ({
            id: slot.id,
            startsAt: slot.startsAt,
            capacityQuantity: slot.capacityQuantity,
            allocations: slot.allocations,
          })),
        })
        : null
      currentCommitment = replanned?.commitments ?? baselineCommitment
      if (replanned) {
        movedAllocations = replanned.movedAllocations
        planSummary = {
          movedAllocations: replanned.movedAllocations.map((move) => ({ orderNumber: move.orderNumber, shiftHours: move.shiftHours })),
          incrementalCost: replanned.incrementalCost,
          currency: replanned.currency,
          slaProtected: replanned.slaProtected,
        }
        riskLevel = replanned.highPriorityAllocationMoved || !replanned.slaProtected ? 'high' : 'low'
        policyDecision = evaluate({
          maxShiftHours: replanned.maxShiftHours,
          slaProtected: replanned.slaProtected,
          incrementalCost: replanned.incrementalCost,
          highPriorityAllocationMoved: replanned.highPriorityAllocationMoved,
        })
        additionalCost = String(replanned.incrementalCost)
      }
      status = !plan.ok
        ? 'escalated'
        : policyDecision === 'human_required'
          ? 'escalated'
          : recipient.ok ? 'proposal_ready' : 'blocked_recipient'
      reason = !plan.ok
        ? plan.reason
        : policyDecision === 'human_required'
          ? 'policy_human_required'
          : recipient.ok ? null : recipient.reason
      originalCommitment = [{ quantity: asNumber(shortfall.requiredQuantity), date: expectedDeliveryAt.toISOString().slice(0, 10) }]
    }
    const correlationId = `SC-${input.orderNumber}`
    const messageId = `MSG-${randomUUID()}`
    const composed = composeSupplyProposal({
      messageId,
      correlationId,
      orderNumber: input.orderNumber,
      sku: variant.sku,
      sender,
      recipient: recipient.ok ? recipient.email : '',
      commitments: currentCommitment,
    })

    const created = await em.transactional(async (transactionalEm) => {
      const supplyCaseId = randomUUID()
      const supplyMessageId = randomUUID()
      const supplyCase = transactionalEm.create(SupplyCase, {
        id: supplyCaseId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        correlationId,
        salesOrderId: input.salesOrderId,
        orderNumber: input.orderNumber,
        customerEntityId: asString(order?.customerEntityId),
        customerSnapshot: customerSnapshot ?? null,
        customerDisplayName: asString((customerSnapshot?.customer as Record<string, unknown> | undefined)?.displayName),
        recipientEmail: recipient.ok ? recipient.email : null,
        catalogVariantId: shortfall.catalogVariantId,
        sku: variant.sku,
        trigger: input.trigger ?? 'wms_shortfall',
        status,
        statusReason: reason,
        originalCommitment,
        baselineCommitment,
        currentCommitment,
        planSummary,
        riskLevel,
        policyDecision,
        additionalCost,
        currencyCode: asString(order?.currencyCode) ?? 'PLN',
        negotiationTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const message = transactionalEm.create(SupplyMessage, {
        id: supplyMessageId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplyCaseId: supplyCase.id,
        businessMessageId: messageId,
        senderEmail: sender || null,
        recipientEmail: recipient.ok ? recipient.email : null,
        subject: composed.subject,
        envelopePayload: composed.storedEnvelope,
        deliveryStatus: 'pending',
        direction: 'outbound',
        messageType: 'SUPPLY_PROPOSAL',
        duplicateCount: 0,
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      // Only a plan the Supplier policy auto-approved changes the production schedule. A human_required plan is
      // stored as a proposal (plan_summary/current_commitment) and must not move slots until someone approves it.
      if (policyDecision === 'auto_approved') {
        await applyReplanSlotMoves(transactionalEm, scope, movedAllocations)
      }
      transactionalEm.persist([supplyCase, message])
      await transactionalEm.flush()
      return { supplyCase, message }
    })

    await emitAfterCommit('supplier_demo.supply_case.opened', scopePayload(scope, { caseId: created.supplyCase.id, correlationId }))
    if (status === 'proposal_ready') {
      await emitAfterCommit('supplier_demo.supply_case.proposal_ready', scopePayload(scope, { caseId: created.supplyCase.id, supplyMessageId: created.message.id, correlationId }))
    } else if (status === 'blocked_recipient' || status === 'escalated') {
      await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: created.supplyCase.id, status, reason }))
    }
    return { caseId: created.supplyCase.id, status, created: true }
  },
  async undo({ ctx, logEntry }) {
    const scope = requireScope(ctx)
    const undoPayload = extractUndoPayload<{ before?: OpenSupplyCaseUndoSnapshot }>(logEntry)
    const snapshot = undoPayload?.before
    if (!snapshot?.productionSlots?.length) return
    const em = entityManager(ctx)
    for (const slotSnapshot of snapshot.productionSlots) {
      const slot = await em.findOne(SupplierProductionSlot, {
        id: slotSnapshot.slotId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!slot) continue
      slot.allocations = copyAllocations(slotSnapshot.allocations)
      slot.updatedAt = new Date()
    }
    await em.flush()
  },
}

const sendSupplyMessage: CommandHandler<Record<string, unknown>, { deliveryStatus: SupplyMessageDeliveryStatus; caseStatus: SupplyCaseStatus }> = {
  id: 'supplier_demo.supply_message.send',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const supplyMessageId = asString(rawInput.supplyMessageId)
    if (!supplyMessageId) throw badRequest('Supply message is required')
    const em = entityManager(ctx)
    const message = await findOneWithDecryption(em, SupplyMessage, { id: supplyMessageId, ...scope, deletedAt: null }, undefined, scope)
    if (!message) throw notFound('Supply message not found')
    const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: message.supplyCaseId, ...scope, deletedAt: null }, undefined, scope)
    if (!supplyCase) throw notFound('Supply case not found')
    const isProposal = message.messageType === 'SUPPLY_PROPOSAL'
    const isConfirmation = message.messageType === 'SUPPLY_COMMITMENT_CONFIRMED'
    const expectedCaseStatus = isProposal ? 'proposal_ready' : 'commitment_updated'
    const isNegotiationRevision = isProposal && Boolean(message.inReplyToBusinessId)
    const isHeldRevision = isNegotiationRevision && supplyCase.status === 'needs_human' && ['auto_proposal_disabled_send', 'auto_negotiation_disabled_send'].includes(supplyCase.statusReason ?? '')
    if ((!isProposal && !isConfirmation) || (!isHeldRevision && supplyCase.status !== expectedCaseStatus) || message.deliveryStatus !== 'pending') {
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }
    if (!(await (isProposal ? isAutoSupplyProposalEnabled(ctx.container, scope.tenantId) : isAutoSupplyReplyEnabled(ctx.container, scope.tenantId)))) {
      if (isProposal) {
        const counter = message.inReplyToBusinessId
          ? await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, businessMessageId: message.inReplyToBusinessId, direction: 'inbound', messageType: 'SUPPLY_COUNTER_PROPOSAL', deletedAt: null }, undefined, scope)
          : null
        if (counter?.negotiationRecord) {
          const record = parseNegotiationRecord(counter.negotiationRecord)
          record.dispatch = { ...record.dispatch, state: 'held', heldReason: 'auto_proposal_disabled_send', handoffCheckedAt: new Date().toISOString() }
          counter.negotiationRecord = record
        }
        supplyCase.status = 'needs_human'
        supplyCase.statusReason = 'auto_proposal_disabled_send'
        message.deliveryStatus = 'pending'
        await em.flush()
        await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason: supplyCase.statusReason, supplyMessageId: message.id }))
      } else if (isConfirmation) {
        supplyCase.status = 'needs_human'
        supplyCase.statusReason = 'auto_reply_disabled_send'
        await em.flush()
        await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason: supplyCase.statusReason }))
      }
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }
    if (isNegotiationRevision && !(await isAutoNegotiationEnabled(ctx.container, scope.tenantId))) {
      const counter = await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, businessMessageId: message.inReplyToBusinessId, direction: 'inbound', messageType: 'SUPPLY_COUNTER_PROPOSAL', deletedAt: null }, undefined, scope)
      if (counter?.negotiationRecord) {
        const record = parseNegotiationRecord(counter.negotiationRecord)
        // Keep the recorded authorisation source (auto or human); a hold never changes who approved the revision.
        record.dispatch = { ...record.dispatch, state: 'held', heldReason: 'auto_negotiation_disabled_send', handoffCheckedAt: new Date().toISOString() }
        counter.negotiationRecord = record
      }
      supplyCase.status = 'needs_human'
      supplyCase.statusReason = 'auto_negotiation_disabled_send'
      message.deliveryStatus = 'pending'
      await em.flush()
      await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason: supplyCase.statusReason, supplyMessageId: message.id }))
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }
    const recipient = message.recipientEmail
    const allowlistResult = resolveSupplyRecipient({ customer: { primaryEmail: recipient } })
    if (!allowlistResult.ok) {
      message.deliveryStatus = 'pending'
      supplyCase.status = 'blocked_recipient'
      supplyCase.statusReason = allowlistResult.reason
      await em.flush()
      await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason: allowlistResult.reason }))
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }
    let mailboxActor
    try {
      mailboxActor = await resolveMailboxActor({ em, expectedScope: scope })
    } catch (error) {
      const reason = error instanceof SupplierDemoMailboxError ? error.code : 'mailbox_not_configured'
      const blocked = error instanceof SupplierDemoMailboxError && isBlockingMailboxError(error)
      supplyCase.status = blocked ? 'blocked_recipient' : 'send_failed'
      supplyCase.statusReason = reason
      message.deliveryStatus = blocked ? 'pending' : 'enqueue_failed'
      message.lastError = reason
      await em.flush()
      await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason }))
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }

    message.deliveryStatus = 'sending'
    message.attempts += 1
    message.lastError = null
    await em.flush()

    const composed = isProposal
      ? composeSupplyProposal({
        messageId: message.businessMessageId,
        correlationId: supplyCase.correlationId,
        orderNumber: supplyCase.orderNumber,
        sku: supplyCase.sku,
        sender: asString(mailboxActor.fromAddress) ?? senderAddress(),
        recipient: allowlistResult.email,
        commitments: supplyCase.currentCommitment,
        inReplyToMessageId: message.inReplyToBusinessId ?? undefined,
        negotiationTurn: message.inReplyToBusinessId ? supplyCase.negotiationTurn : undefined,
        maxNegotiationTurns: message.inReplyToBusinessId ? maxNegotiationTurns() : undefined,
      })
      : composeCommitmentConfirmation({
        messageId: message.businessMessageId,
        correlationId: supplyCase.correlationId,
        orderNumber: supplyCase.orderNumber,
        sku: supplyCase.sku,
        sender: asString(mailboxActor.fromAddress) ?? senderAddress(),
        recipient: allowlistResult.email,
        inReplyToMessageId: message.inReplyToBusinessId ?? '',
        confirmedCommitments: supplyCase.acceptedCommitment ?? [],
        cancelledCommitments: supplyCase.cancelledCommitment ?? [],
      })
    // A confirmation answers the acceptance and a revised proposal answers the counter: both go out as a reply in
    // that inbound mail's thread.
    const acceptance = (isConfirmation || isNegotiationRevision) && message.inReplyToBusinessId
      ? await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, businessMessageId: message.inReplyToBusinessId, direction: 'inbound', deletedAt: null }, undefined, scope)
      : null
    message.senderEmail = (asString(mailboxActor.fromAddress) ?? senderAddress()) || null
    message.subject = composed.subject
    message.envelopePayload = composed.storedEnvelope
    message.bodyExcerpt = composed.plain.split('\n\n')[0]?.slice(0, 8000) ?? null
    let result: Awaited<ReturnType<typeof sendSupplyMail>>
    try {
      result = await sendSupplyMail(ctx.container, {
        to: allowlistResult.email,
        subject: composed.subject,
        body: composed.plain,
        html: composed.html,
        inReplyTo: acceptance?.rfcMessageId ?? undefined,
        references: acceptance?.rfcMessageId ? [acceptance.rfcMessageId] : undefined,
        parentMessageId: acceptance?.hubMessageId ?? undefined,
        channelMetadata: {
        supplierDemoBusinessMessageId: message.businessMessageId,
        supplierDemoCaseId: supplyCase.id,
        correlationId: supplyCase.correlationId,
      },
      }, { actor: mailboxActor })
    } catch (error) {
      const reason = error instanceof SupplierDemoMailboxError ? error.code : 'mailbox_send_failed'
      message.deliveryStatus = 'enqueue_failed'
      message.lastError = reason
      supplyCase.status = 'send_failed'
      supplyCase.statusReason = reason
      await em.flush()
      await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason }))
      return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
    }
    message.deliveryStatus = 'queued_in_hub'
    message.commMessageId = result.messageId
    message.commThreadId = result.threadId
    message.commChannelId = result.channelId
    message.queuedAt = new Date()
    supplyCase.status = isProposal ? 'proposal_queued' : 'confirmation_queued'
    if (isNegotiationRevision && message.inReplyToBusinessId) {
      const counter = await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, businessMessageId: message.inReplyToBusinessId, direction: 'inbound', messageType: 'SUPPLY_COUNTER_PROPOSAL', deletedAt: null }, undefined, scope)
      if (counter?.negotiationRecord) {
        const record = parseNegotiationRecord(counter.negotiationRecord)
        record.dispatch = { ...record.dispatch, state: 'handed_off', revisedProposalMessageId: message.id, handoffCheckedAt: new Date().toISOString(), heldReason: null }
        counter.negotiationRecord = record
      }
    }
    await em.flush()
    await emitAfterCommit(isProposal ? 'supplier_demo.supply_case.proposal_queued' : 'supplier_demo.supply_case.confirmation_queued', scopePayload(scope, { caseId: supplyCase.id, supplyMessageId: message.id, commMessageId: result.messageId }))
    return { deliveryStatus: message.deliveryStatus, caseStatus: supplyCase.status }
  },
}

const trackSupplyDelivery: CommandHandler<Record<string, unknown>, { matched: boolean; deliveryStatus?: SupplyMessageDeliveryStatus }> = {
  id: 'supplier_demo.supply_message.track_delivery',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const input = rawInput as unknown as HubDeliveryInput
    const communicationMessageId = asString(input.messageId)
    const em = entityManager(ctx)
    const message = communicationMessageId
      ? await findOneWithDecryption(em, SupplyMessage, { commMessageId: communicationMessageId, ...scope, deletedAt: null }, undefined, scope)
      : null
    if (!message) return { matched: false }
    const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: message.supplyCaseId, ...scope, deletedAt: null }, undefined, scope)
    if (!supplyCase) return { matched: false }
    if (input.transient === true) {
      message.lastError = typeof input.error === 'string' ? input.error.slice(0, 500) : null
      await em.flush()
      return { matched: true, deliveryStatus: message.deliveryStatus }
    }
    const confirmation = message.messageType === 'SUPPLY_COMMITMENT_CONFIRMED'
    // The case only moves while it is still waiting for this message's delivery. A late or replayed hub event
    // (for example the proposal's .sent arriving after the acceptance) must never regress a case that moved on.
    const awaitingThisDelivery = supplyCase.status === (confirmation ? 'confirmation_queued' : 'proposal_queued')
    const failed = input.status === 'failed' || input.status === 'delivery_failed' || Boolean(input.error)
    if (failed) {
      message.deliveryStatus = 'delivery_failed'
      message.lastError = asString(input.error)
      if (awaitingThisDelivery) {
        supplyCase.status = 'send_failed'
        supplyCase.statusReason = 'delivery_failed'
      }
      await em.flush()
      if (awaitingThisDelivery) {
        await emitAfterCommit('supplier_demo.supply_case.attention_required', scopePayload(scope, { caseId: supplyCase.id, status: supplyCase.status, reason: 'delivery_failed' }))
      }
      return { matched: true, deliveryStatus: message.deliveryStatus }
    }
    message.deliveryStatus = 'delivered'
    message.lastError = null
    message.deliveredAt ??= new Date()
    if (awaitingThisDelivery) {
      supplyCase.status = confirmation ? 'resolved' : 'proposal_delivered'
      if (confirmation) supplyCase.resolvedAt = new Date()
    }
    await em.flush()
    if (awaitingThisDelivery) {
      await emitAfterCommit(confirmation ? 'supplier_demo.supply_case.resolved' : 'supplier_demo.supply_case.proposal_delivered', scopePayload(scope, { caseId: supplyCase.id, supplyMessageId: message.id }))
    }
    return { matched: true, deliveryStatus: message.deliveryStatus }
  },
}

const retrySupplyCase: CommandHandler<Record<string, unknown>, { caseId: string; status: SupplyCaseStatus }> = {
  id: 'supplier_demo.supply_case.retry',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const caseId = asString(rawInput.caseId)
    const expectedUpdatedAt = rawInput.updatedAt instanceof Date ? rawInput.updatedAt : new Date(String(rawInput.updatedAt ?? ''))
    if (!caseId || Number.isNaN(expectedUpdatedAt.getTime())) throw badRequest('Case and updatedAt are required')
    const em = entityManager(ctx)
    const supplyCase = await findOneWithDecryption(em, SupplyCase, { id: caseId, ...scope, deletedAt: null }, undefined, scope)
    if (!supplyCase) throw notFound('Supply case not found')
    if (supplyCase.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw conflict('Supply case was changed by another user')
    if (supplyCase.status === 'reply_received') {
      // Recovers a lost reply_received event: re-drive the newest valid acceptance that was not applied yet.
      const acceptance = (await findWithDecryption(em, SupplyMessage, { supplyCaseId: caseId, ...scope, direction: 'inbound', messageType: 'SUPPLY_ACCEPTANCE', validationStatus: 'valid', appliedAt: null, deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope))[0]
      if (!acceptance) throw new CrudHttpError(422, { error: 'Supply case is not retryable', code: 'not_retryable' })
      await emitAfterCommit('supplier_demo.supply_case.reply_received', scopePayload(scope, { caseId: supplyCase.id, supplyMessageId: acceptance.id }))
      return { caseId: supplyCase.id, status: supplyCase.status }
    }
    if (supplyCase.status === 'counter_received') {
      // A stalled counter: settle an expired agent lease or re-emit the lost next step now (never a new model call
      // while one is still running).
      const counter = (await findWithDecryption(em, SupplyMessage, { supplyCaseId: caseId, ...scope, direction: 'inbound', messageType: 'SUPPLY_COUNTER_PROPOSAL', validationStatus: 'valid', deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope))[0]
      const record = counter?.negotiationRecord ? parseNegotiationRecord(counter.negotiationRecord) : null
      const running = record?.agent.attempts.find((attempt) => attempt.runId === record.agent.activeRunId && attempt.finishedAt === null)
      if (running && new Date(running.leaseExpiresAt).getTime() > Date.now()) {
        throw new CrudHttpError(422, { error: 'The counter is still being analysed', code: 'agent_running', retryAfter: running.leaseExpiresAt })
      }
      const commandBus = ctx.container.resolve('commandBus') as CommandBus
      await commandBus.execute('supplier_demo.supply_case.recover_counter_processing', { input: { caseId, lostEventAfterMs: 0 }, ctx })
      const after = await findOneWithDecryption(em.fork(), SupplyCase, { id: caseId, ...scope, deletedAt: null }, undefined, scope)
      return { caseId, status: after?.status ?? supplyCase.status }
    }
    if (supplyCase.status === 'needs_human' && HELD_REVISION_REASONS.has(supplyCase.statusReason ?? '')) {
      // A revision held at the hand-off by a switch: resend the same pending message with its original
      // authorisation once the switches are back on (no new revision, turn or cost).
      const proposalOn = await isAutoSupplyProposalEnabled(ctx.container, scope.tenantId)
      const negotiationOn = supplyCase.statusReason !== 'auto_negotiation_disabled_send'
        || await isAutoNegotiationEnabled(ctx.container, scope.tenantId)
      if (!proposalOn || !negotiationOn) {
        throw new CrudHttpError(422, { error: 'Turn the sending switch back on before retrying', code: supplyCase.statusReason ?? 'switch_disabled' })
      }
      const held = (await findWithDecryption(em, SupplyMessage, { supplyCaseId: caseId, ...scope, direction: 'outbound', messageType: 'SUPPLY_PROPOSAL', deliveryStatus: 'pending', deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope))[0]
      if (!held) throw new CrudHttpError(422, { error: 'No held proposal to resend', code: 'not_retryable' })
      supplyCase.status = 'proposal_ready'
      supplyCase.statusReason = null
      supplyCase.updatedAt = new Date()
      await em.flush()
      await emitAfterCommit('supplier_demo.supply_case.proposal_ready', scopePayload(scope, { caseId: supplyCase.id, supplyMessageId: held.id, correlationId: supplyCase.correlationId }))
      return { caseId: supplyCase.id, status: supplyCase.status }
    }
    const messages = await findWithDecryption(em, SupplyMessage, { supplyCaseId: caseId, ...scope, direction: 'outbound', messageType: { $in: ['SUPPLY_PROPOSAL', 'SUPPLY_COMMITMENT_CONFIRMED'] }, deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope)
    const message = messages.find((candidate) => ['pending', 'sending', 'enqueue_failed', 'delivery_failed'].includes(candidate.deliveryStatus)) ?? messages[0]
    if (!message) throw notFound('Supply message not found')
    if (!['blocked_recipient', 'send_failed'].includes(supplyCase.status)) {
      throw new CrudHttpError(422, { error: 'Supply case is not retryable', code: 'not_retryable' })
    }
    if (message.deliveryStatus === 'sending') {
      const links = await em.find(MessageChannelLink, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      const link = links.find((candidate) => candidate.channelMetadata?.supplierDemoBusinessMessageId === message.businessMessageId)
      if (link) {
        message.deliveryStatus = 'queued_in_hub'
        message.commMessageId = link.messageId
        supplyCase.status = message.messageType === 'SUPPLY_COMMITMENT_CONFIRMED' ? 'confirmation_queued' : 'proposal_queued'
        await em.flush()
        return { caseId: supplyCase.id, status: supplyCase.status }
      }
      message.deliveryStatus = 'enqueue_failed'
      message.lastError = 'send_state_unknown'
    }
    if (supplyCase.status === 'blocked_recipient') {
      // A case blocked by the allowlist is stored with recipientEmail = null, so re-evaluate the address from the
      // (decrypted) customer snapshot taken at case creation; fall back to the stored recipient for mailbox blocks.
      const snapshotCustomer = (supplyCase.customerSnapshot as { customer?: { primaryEmail?: unknown } } | null | undefined)?.customer
      const candidateEmail = typeof snapshotCustomer?.primaryEmail === 'string' && snapshotCustomer.primaryEmail.trim()
        ? snapshotCustomer.primaryEmail
        : supplyCase.recipientEmail
      const recipient = resolveSupplyRecipient({ customer: { primaryEmail: candidateEmail } })
      if (!recipient.ok) throw badRequest('Recipient is still not allowlisted')
      supplyCase.recipientEmail = recipient.email
      message.recipientEmail = recipient.email
    }
    message.deliveryStatus = 'pending'
    message.lastError = null
    const confirmation = message.messageType === 'SUPPLY_COMMITMENT_CONFIRMED'
    supplyCase.status = confirmation ? 'commitment_updated' : 'proposal_ready'
    supplyCase.statusReason = null
    await em.flush()
    await emitAfterCommit(confirmation ? 'supplier_demo.supply_case.commitment_updated' : 'supplier_demo.supply_case.proposal_ready', scopePayload(scope, { caseId: supplyCase.id, supplyMessageId: message.id, confirmationMessageId: confirmation ? message.id : undefined, correlationId: supplyCase.correlationId }))
    return { caseId: supplyCase.id, status: supplyCase.status }
  },
}

const reportSupplyDisruption: CommandHandler<ReportDisruptionInput, { caseId: string; status: SupplyCaseStatus }> = {
  id: 'supplier_demo.supply_case.report_disruption',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const salesOrderId = asString(rawInput.salesOrderId)
    const availableQuantity = asNumber(rawInput.availableQuantity)
    if (!salesOrderId || !Number.isInteger(availableQuantity) || availableQuantity < 0) {
      throw new CrudHttpError(422, { error: 'Available quantity must be a non-negative integer', code: 'invalid_quantity' })
    }

    const em = entityManager(ctx)
    const order = await loadOrder(ctx, scope, salesOrderId)
    if (!order) throw notFound('Sales order not found')
    if (order.status !== 'confirmed') {
      throw new CrudHttpError(422, { error: 'Only confirmed sales orders can report a disruption', code: 'order_not_confirmed' })
    }

    const existing = await findOneWithDecryption(
      em,
      SupplyCase,
      { salesOrderId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (existing) throw conflict('case_exists')

    const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
    const lineResult = await queryEngine.query<SalesOrderLineRow>(E.sales.sales_order_line, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters: { order_id: { $eq: order.id } },
      fields: ['id', 'kind', 'product_variant_id', 'quantity', 'line_number'],
      page: { page: 1, pageSize: 1000 },
    })
    const productLines = lineResult.items.filter((line) => line.kind === 'product' && typeof line.product_variant_id === 'string')
    const variants = new Set(productLines.map((line) => line.product_variant_id))
    if (productLines.length !== 1 || variants.size !== 1) {
      throw new CrudHttpError(422, { error: 'Only single-SKU orders are supported', code: 'multi_sku' })
    }

    const line = productLines[0]
    const catalogVariantId = line.product_variant_id
    if (!catalogVariantId) throw new CrudHttpError(422, { error: 'A product variant is required', code: 'multi_sku' })
    const requiredQuantity = Number(line.quantity)
    if (!Number.isInteger(requiredQuantity) || requiredQuantity <= 0 || availableQuantity >= requiredQuantity) {
      throw new CrudHttpError(422, { error: 'Available quantity must be below the ordered quantity', code: 'quantity_out_of_range' })
    }

    const commandBus = ctx.container.resolve('commandBus') as { execute: (id: string, options: { input: unknown; ctx: CommandRuntimeContext }) => Promise<{ result: unknown }> }
    let result: { result: unknown }
    try {
      result = await commandBus.execute('supplier_demo.supply_case.open_from_shortfall', {
        input: {
          salesOrderId: order.id,
          orderNumber: order.orderNumber,
          trigger: 'manual_disruption',
          shortfalls: [{
            catalogVariantId,
            requiredQuantity,
            reservedQuantity: availableQuantity,
            shortfallQuantity: requiredQuantity - availableQuantity,
          }],
        } satisfies OpenInput,
        ctx: commandContext(ctx.container, scope),
      })
    } catch (error) {
      if (isUniqueViolation(error, 'supplier_demo_supply_cases_order_uq')) throw conflict('case_exists')
      throw error
    }
    const opened = result.result as { caseId?: string; status?: SupplyCaseStatus }
    if (!opened.caseId || !opened.status) throw new CrudHttpError(500, { error: 'Supply case was not created' })
    return { caseId: opened.caseId, status: opened.status }
  },
}

registerCommand(openSupplyCase)
registerCommand(sendSupplyMessage)
registerCommand(trackSupplyDelivery)
registerCommand(retrySupplyCase)
registerCommand(reportSupplyDisruption)
