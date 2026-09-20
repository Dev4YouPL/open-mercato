import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runAiAgentObject } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SupplierRfq, SupplyCase } from '../data/entities'
import { emitSupplierDemoEvent } from '../events'
import { SUPPLIER_RFQ_INTERPRETER_AGENT_ID, supplierRfqInterpretationSchema, type SupplierRfqInterpretation } from '../ai-agents'
import { loadHubInboundRecord } from '../lib/hub-inbound'
import { normalizeInboundText } from '../lib/envelope-parse'
import { classifyRfqInbound } from '../lib/rfq/inbound'
import { validateRfqInterpretation } from '../lib/rfq/interpretation'
import { buildRfqOffer, resolveRfqFacts } from '../lib/rfq-facts'
import { composeRfqOfferReply } from '../lib/rfq/offer-reply'
import { sendSupplyMail } from '../lib/mailbox'

type Scope = { tenantId: string; organizationId: string }

function scopeFrom(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  return { tenantId, organizationId }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function versionOf(value: unknown): Date {
  const version = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(version.getTime())) throw new CrudHttpError(422, { error: 'updatedAt is required', code: 'updated_at_required' })
  return version
}

function allowlisted(sender: string, env: Record<string, string | undefined>): boolean {
  const normalized = sender.trim().toLowerCase()
  const self = env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS?.trim().toLowerCase()
  const partnerEmails = (env.SUPPLIER_DEMO_PARTNER_EMAILS ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  return Boolean(normalized && normalized !== self && partnerEmails.includes(normalized))
}

function historyEntry(action: string, details: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: randomUUID(), action, at: new Date().toISOString(), ...details }
}

async function emitRfqEvent(event: string, scope: Scope, rfqId: string): Promise<void> {
  await emitSupplierDemoEvent(event as never, { ...scope, rfqId }, { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) })
}

const receiveRfq: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.rfq.receive_inbound',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const em = (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager
    const hub = await loadHubInboundRecord(em, rawInput, scope)
    if (!hub || !hub.link.id) return { recorded: false, ignoredReason: 'hub_rows_missing' }
    const existing = await findOneWithDecryption(em, SupplierRfq, { ...scope, channelLinkId: hub.link.id, deletedAt: null }, undefined, scope)
    if (existing) return { recorded: false, ignoredReason: 'duplicate_event', rfqId: existing.id }
    const sender = hub.transportSender?.trim().toLowerCase() ?? ''
    if (!allowlisted(sender, process.env)) return { recorded: false, ignoredReason: 'sender_not_allowlisted' }
    const normalizedBody = normalizeInboundText(hub.body, hub.bodyFormat)
    const candidate = classifyRfqInbound({ subject: hub.subject, body: normalizedBody, senderEmail: sender, allowlistedSenderEmails: (process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? '').split(',').map((value) => value.trim()).filter(Boolean), selfSenderEmail: process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS })
    if (!candidate.accepted) return { recorded: false, ignoredReason: candidate.reason }
    const existingCase = await findOneWithDecryption(em, SupplyCase, { ...scope, correlationId: candidate.correlationId, deletedAt: null }, undefined, scope)
    if (existingCase) return { recorded: false, ignoredReason: 'existing_supply_case' }
    const duplicateRfc = hub.rfcMessageId
      ? await findOneWithDecryption(em, SupplierRfq, { ...scope, rfcMessageId: hub.rfcMessageId, deletedAt: null }, undefined, scope)
      : null
    if (duplicateRfc) return { recorded: false, ignoredReason: 'duplicate_rfc_message', rfqId: duplicateRfc.id }
    const now = new Date()
    const rfq = em.create(SupplierRfq, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      correlationId: candidate.correlationId,
      subject: hub.subject,
      senderEmail: sender,
      recipientEmail: hub.transportRecipient,
      rfcMessageId: hub.rfcMessageId,
      threadId: hub.threadId,
      channelLinkId: hub.link.id,
      channelId: asString(rawInput.channelId),
      bodyFormat: hub.bodyFormat,
      rawBody: candidate.body,
      sku: candidate.sku,
      status: 'pending_interpretation',
      interpretationStatus: 'pending',
      operatorDecision: 'pending',
      sendStatus: 'not_sent',
      history: [historyEntry('received', { sender: 'allowlisted', source: 'communication_channels' })],
      createdAt: now,
      updatedAt: now,
    })
    em.persist(rfq)
    try {
      await em.flush()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/supplier_demo_rfqs_(?:channel_link|rfc_message)_uq/i.test(message)) return { recorded: false, ignoredReason: 'duplicate_race' }
      throw error
    }
    await emitRfqEvent('supplier_demo.rfq.received', scope, rfq.id)
    return { recorded: true, rfqId: rfq.id, status: rfq.status }
  },
}

async function runInterpretation(input: { body: string; correlationId: string; sku: string; container: CommandRuntimeContext['container']; scope: Scope; rfqId: string }): Promise<SupplierRfqInterpretation> {
  const result = await runAiAgentObject({
    agentId: SUPPLIER_RFQ_INTERPRETER_AGENT_ID,
    input: JSON.stringify({ correlationId: input.correlationId, subjectSku: input.sku, mail: input.body }),
    authContext: { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId, userId: 'supplier-demo-system', features: ['supplier_demo.rfqs.manage'], isSuperAdmin: false },
    container: input.container,
    sessionId: input.rfqId,
    enableTools: false,
  } as never) as { mode?: string; object?: unknown }
  if (result.mode !== 'generate') throw new Error('[internal] RFQ interpreter must return object output')
  const parsed = supplierRfqInterpretationSchema.safeParse(result.object)
  if (!parsed.success) throw new Error('[internal] RFQ interpreter returned invalid output')
  return parsed.data
}

const interpretRfq: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.rfq.interpret',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const rfqId = asString(rawInput.rfqId)
    if (!rfqId) throw new CrudHttpError(422, { error: 'RFQ is required', code: 'rfq_required' })
    const em = (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager
    const rfq = await findOneWithDecryption(em, SupplierRfq, { ...scope, id: rfqId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
    if (!rfq) throw notFound('RFQ not found')
    if (['ready_for_approval', 'approved', 'rejected', 'sent'].includes(rfq.status)) return { rfqId, status: rfq.status }
    let interpretation: SupplierRfqInterpretation
    try {
      const supplied = rawInput.interpretation
      const parsed = supplierRfqInterpretationSchema.safeParse(supplied)
      interpretation = parsed.success ? parsed.data : await runInterpretation({ body: rfq.rawBody, correlationId: rfq.correlationId, sku: rfq.sku, container: ctx.container, scope, rfqId })
    } catch {
      rfq.status = 'needs_human'
      rfq.interpretationStatus = 'needs_human'
      rfq.lastError = 'interpretation_unavailable'
      rfq.history = [...rfq.history, historyEntry('interpretation_blocked', { reason: 'interpretation_unavailable' })]
      await em.flush()
      return { rfqId, status: rfq.status, reason: 'interpretation_unavailable' }
    }
    const validation = validateRfqInterpretation(interpretation, { sourceText: rfq.rawBody, expectedSku: rfq.sku })
    rfq.interpretationRecord = interpretation
    if (!validation.ok) {
      rfq.status = 'needs_human'
      rfq.interpretationStatus = 'needs_human'
      const reason = validation.blockingStatuses[0] ?? 'invalid_output'
      rfq.lastError = reason
      rfq.history = [...rfq.history, historyEntry('interpretation_blocked', { reason })]
      await em.flush()
      return { rfqId, status: rfq.status, reason }
    }
    const extracted = validation.interpretation
    if (!extracted?.sku || !extracted.quantity || !extracted.deliveryDate) throw new CrudHttpError(422, { error: 'RFQ interpretation is incomplete', code: 'interpretation_incomplete' })
    rfq.sku = extracted.sku
    rfq.requestedQuantity = extracted.quantity
    rfq.requestedDeliveryDate = extracted.deliveryDate
    const facts = await resolveRfqFacts(em, scope, { sku: extracted.sku, quantity: extracted.quantity, requestedDate: extracted.deliveryDate })
    const offer = buildRfqOffer({ correlationId: rfq.correlationId, sku: extracted.sku, quantity: extracted.quantity, requestedDate: extracted.deliveryDate, availability: facts.availability, price: facts.price })
    rfq.availabilitySnapshot = facts.availability
    rfq.priceSnapshot = facts.price
    rfq.computedOffer = offer.offer
    rfq.interpretationStatus = 'ready'
    rfq.status = offer.status === 'ready' ? 'ready_for_approval' : 'needs_human'
    rfq.lastError = offer.reason
    if (offer.offer) {
      const reply = composeRfqOfferReply({ correlationId: rfq.correlationId, sku: extracted.sku, quantity: extracted.quantity, deliveryDate: String(offer.offer.deliveryDate), unitPrice: Number(offer.offer.unitPrice), currency: String(offer.offer.currencyCode), inReplyToMessageId: rfq.rfcMessageId })
      rfq.replySubject = reply.subject
      rfq.replyBody = reply.body
    }
    rfq.history = [...rfq.history, historyEntry('interpreted', { status: rfq.status, offerStatus: offer.status })]
    await em.flush()
    return { rfqId, status: rfq.status, offerStatus: offer.status }
  },
}

const approveRfq: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.rfq.approve',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const rfqId = asString(rawInput.rfqId)
    if (!rfqId) throw new CrudHttpError(422, { error: 'RFQ is required', code: 'rfq_required' })
    const expected = versionOf(rawInput.updatedAt)
    const em = ctx.container.resolve('em') as EntityManager
    const result = await em.transactional(async (tx) => {
      const rfq = await findOneWithDecryption(tx, SupplierRfq, { ...scope, id: rfqId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (!rfq) throw notFound('RFQ not found')
      if (rfq.updatedAt.getTime() !== expected.getTime()) throw new CrudHttpError(409, { error: 'RFQ was changed by another user', code: 'optimistic_conflict' })
      if (rfq.status === 'approved' || rfq.status === 'send_held') return { rfqId, status: rfq.status }
      if (rfq.status !== 'ready_for_approval' || !rfq.computedOffer) throw new CrudHttpError(422, { error: 'RFQ is not ready for approval', code: 'rfq_not_approvable' })
      rfq.operatorDecision = 'approved'
      rfq.status = 'send_held'
      rfq.sendStatus = 'held'
      rfq.history = [...rfq.history, historyEntry('approved', { actor: ctx.auth?.sub ?? 'operator', sendStatus: 'held' })]
      await tx.flush()
      return { rfqId, status: rfq.status }
    })
    return result
  },
}

const rejectRfq: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.rfq.reject',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const rfqId = asString(rawInput.rfqId)
    if (!rfqId) throw new CrudHttpError(422, { error: 'RFQ is required', code: 'rfq_required' })
    const expected = versionOf(rawInput.updatedAt)
    const em = ctx.container.resolve('em') as EntityManager
    const rfq = await findOneWithDecryption(em, SupplierRfq, { ...scope, id: rfqId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
    if (!rfq) throw notFound('RFQ not found')
    if (rfq.updatedAt.getTime() !== expected.getTime()) throw new CrudHttpError(409, { error: 'RFQ was changed by another user', code: 'optimistic_conflict' })
    if (rfq.operatorDecision === 'rejected') return { rfqId, status: rfq.status }
    rfq.operatorDecision = 'rejected'
    rfq.status = 'rejected'
    rfq.sendStatus = 'not_sent'
    rfq.history = [...rfq.history, historyEntry('rejected', { actor: ctx.auth?.sub ?? 'operator' })]
    await em.flush()
    return { rfqId, status: rfq.status }
  },
}

const sendApprovedRfq: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.rfq.send_approved',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    const rfqId = asString(rawInput.rfqId)
    if (!rfqId) throw new CrudHttpError(422, { error: 'RFQ is required', code: 'rfq_required' })
    const em = ctx.container.resolve('em') as EntityManager
    const rfq = await findOneWithDecryption(em, SupplierRfq, { ...scope, id: rfqId, deletedAt: null }, undefined, scope)
    if (!rfq) throw notFound('RFQ not found')
    if (rfq.sendStatus === 'sent') return { rfqId, status: rfq.status, sendStatus: rfq.sendStatus }
    if (rfq.operatorDecision !== 'approved' || rfq.status !== 'send_held' || !rfq.replyBody || !rfq.replySubject) throw new CrudHttpError(422, { error: 'RFQ must be approved before sending', code: 'rfq_not_approved' })
    if (process.env.SUPPLIER_DEMO_RFQ_SEND_ENABLED?.trim().toLowerCase() !== 'true') throw new CrudHttpError(422, { error: 'RFQ sending is disabled', code: 'rfq_send_disabled' })
    const sent = await sendSupplyMail(ctx.container as never, { to: rfq.senderEmail, subject: rfq.replySubject, body: rfq.replyBody, inReplyTo: rfq.rfcMessageId ?? undefined, references: rfq.rfcMessageId ? [rfq.rfcMessageId] : undefined, parentMessageId: rfq.threadId ?? undefined, channelMetadata: { supplierRfqId: rfq.id, correlationId: rfq.correlationId } })
    rfq.status = 'sent'
    rfq.sendStatus = 'sent'
    rfq.history = [...rfq.history, historyEntry('sent', { messageId: sent.messageId })]
    await em.flush()
    return { rfqId, status: rfq.status, sendStatus: rfq.sendStatus }
  },
}

registerCommand(receiveRfq)
registerCommand(interpretRfq)
registerCommand(approveRfq)
registerCommand(rejectRfq)
registerCommand(sendApprovedRfq)
