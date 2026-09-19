import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { conflict, notFound, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SupplyCase, SupplyMessage } from '../data/entities'
import { emitSupplierDemoEvent } from '../events'
import { parseInboundSupplyText } from '../lib/envelope-parse'
import { loadHubInboundRecord } from '../lib/hub-inbound'
import { validateInboundEnvelope } from '../lib/inbound-validation'
import { stripEnvelopeAddresses } from '../lib/envelope'
import { resolveSupplyRecipient } from '../lib/recipient'
import { isAutoSupplyReplyEnabled } from '../lib/toggles'

type Scope = { tenantId: string; organizationId: string }

export const INBOUND_UNTRUSTED_CAP = 20

function scopeFrom(ctx: CommandRuntimeContext): Scope | null {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  return tenantId && organizationId ? { tenantId, organizationId } : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function correlationFromSubject(subject: string): string | null {
  const match = subject.match(/\[(SC-[^\]]+)\]/i)
  return match?.[1] ?? null
}

// Mail from these senders is recorded for visibility only: no body excerpt, capped per case, never notified.
const UNTRUSTED_STATUSES = new Set(['untrusted_sender', 'sender_not_case_partner'])

// Supplier events are enqueued and delivered after the command transaction commits.
async function emitAfterCommit(event: Parameters<typeof emitSupplierDemoEvent>[0], payload: Record<string, unknown>): Promise<void> {
  await emitSupplierDemoEvent(event, payload, { persistent: true, ...({ deliverInline: false } as Record<string, unknown>) })
}

function eventPayload(scope: Scope, caseId: string, reason: string, supplyMessageId?: string): Record<string, unknown> {
  return { ...scope, caseId, reason, ...(supplyMessageId ? { supplyMessageId } : {}) }
}

const receiveInbound: CommandHandler<Record<string, unknown>, Record<string, unknown>> = {
  id: 'supplier_demo.supply_message.receive_inbound',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    if (!scope) return { recorded: false, ignoredReason: 'missing_scope' }
    const em = (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager
    const event = rawInput
    const configuredChannelId = process.env.SUPPLIER_DEMO_MAILBOX_CHANNEL_ID?.trim()
    if (configuredChannelId && stringValue(event.channelId) && configuredChannelId !== stringValue(event.channelId)) {
      return { recorded: false, ignoredReason: 'not_supplier_mailbox' }
    }
    const hub = await loadHubInboundRecord(em, event, scope)
    if (!hub) return { recorded: false, ignoredReason: 'hub_rows_missing' }
    const existingByLink = await findOneWithDecryption(em, SupplyMessage, {
      ...scope,
      hubChannelLinkId: hub.link.id,
      deletedAt: null,
    }, undefined, scope)
    // A redelivered hub event for a mail we already recorded is not a duplicate mail: ignore it without counting.
    if (existingByLink) return { recorded: false, ignoredReason: 'duplicate_event', supplyMessageId: existingByLink.id }

    const parsed = parseInboundSupplyText(hub.body, hub.bodyFormat)
    const foreignBlocks = parsed.blocks.filter((block) => block.envelope && !['SUPPLY_PROPOSAL', 'SUPPLY_COMMITMENT_CONFIRMED'].includes(block.envelope.messageType))
    const candidate = foreignBlocks.length === 1 ? foreignBlocks[0] : null
    const correlationId = candidate?.envelope?.correlationId ?? correlationFromSubject(hub.subject)
    if (!correlationId) return { recorded: false, ignoredReason: 'unmatched_inbound' }
    const supplyCase = await findOneWithDecryption(em, SupplyCase, {
      ...scope,
      correlationId,
      deletedAt: null,
    }, undefined, scope)
    if (!supplyCase) return { recorded: false, ignoredReason: 'unmatched_inbound' }
    const outbound = await findWithDecryption(em, SupplyMessage, {
      ...scope,
      supplyCaseId: supplyCase.id,
      direction: 'outbound',
      messageType: 'SUPPLY_PROPOSAL',
      deletedAt: null,
    }, { orderBy: { createdAt: 'desc' } }, scope)
    const latestProposalId = outbound[0]?.businessMessageId ?? null
    const validBusinessIds = new Set(
      (await findWithDecryption(em, SupplyMessage, {
        ...scope,
        supplyCaseId: supplyCase.id,
        direction: 'inbound',
        validationStatus: 'valid',
        deletedAt: null,
      }, undefined, scope)).map((message) => message.businessMessageId),
    )
    const validation = validateInboundEnvelope({
      envelope: candidate?.envelope ?? null,
      blockCount: foreignBlocks.length,
      schemaError: parsed.blocks.find((block) => block.schemaError)?.schemaError,
      transportSender: hub.transportSender,
      senderAllowlisted: resolveSupplyRecipient({ customer: { primaryEmail: hub.transportSender } }).ok,
      casePartner: supplyCase.recipientEmail,
      // Our own mailbox address, as recorded on the proposal we sent.
      transportRecipient: outbound[0]?.senderEmail ?? null,
      caseRecord: supplyCase,
      latestProposalId,
      validBusinessMessageIds: validBusinessIds,
    })
    const untrusted = UNTRUSTED_STATUSES.has(validation.status)
    if (untrusted) {
      const untrustedCount = await em.count(SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, direction: 'inbound', validationStatus: { $in: [...UNTRUSTED_STATUSES] }, deletedAt: null })
      if (untrustedCount >= INBOUND_UNTRUSTED_CAP) return { recorded: false, ignoredReason: 'inbound_cap_reached' }
    }
    if (validation.status === 'duplicate' && validation.envelope) {
      const original = await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, businessMessageId: validation.envelope.messageId, validationStatus: 'valid', deletedAt: null }, undefined, scope)
      if (original) {
        original.duplicateCount += 1
        await em.flush()
        return { recorded: false, ignoredReason: 'duplicate', supplyMessageId: original.id, duplicateCount: original.duplicateCount }
      }
    }
    const supplyMessage = em.create(SupplyMessage, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      supplyCaseId: supplyCase.id,
      businessMessageId: validation.status === 'valid' && validation.envelope ? validation.envelope.messageId : `INB-${hub.link.id}`,
      direction: 'inbound',
      messageType: validation.envelope?.messageType ?? null,
      validationStatus: validation.status,
      validationReason: validation.reason,
      envelopeMessageId: validation.envelope?.messageId ?? null,
      hubChannelLinkId: hub.link.id,
      hubExternalMessageId: hub.link.externalMessageId ?? null,
      hubMessageId: hub.message.id,
      rfcMessageId: hub.rfcMessageId,
      inReplyToBusinessId: validation.envelope && 'inReplyToMessageId' in validation.envelope.payload ? validation.envelope.payload.inReplyToMessageId : null,
      receivedAt: new Date(),
      senderEmail: hub.transportSender,
      recipientEmail: validation.envelope?.recipient ?? null,
      subject: hub.subject.slice(0, 500),
      envelopePayload: validation.envelope ? stripEnvelopeAddresses(validation.envelope) : {},
      bodyExcerpt: untrusted ? null : parsed.humanText.slice(0, 8000),
      deliveryStatus: 'delivered',
      duplicateCount: 0,
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(supplyMessage)
    if (validation.status === 'valid' && validation.envelope?.messageType === 'SUPPLY_COUNTER_PROPOSAL') {
      supplyCase.status = 'needs_human'
      supplyCase.statusReason = 'counter_proposal_received'
      supplyCase.updatedAt = new Date()
    }
    if (validation.status === 'valid' && validation.envelope?.messageType === 'SUPPLY_REJECTION') {
      supplyCase.status = 'needs_human'
      supplyCase.statusReason = 'rejection_received'
      supplyCase.updatedAt = new Date()
    }
    if (validation.status === 'valid' && validation.envelope?.messageType === 'SUPPLY_ACCEPTANCE') {
      supplyCase.status = 'reply_received'
      supplyCase.statusReason = null
      supplyCase.replyReceivedAt = supplyCase.replyReceivedAt ?? new Date()
      supplyCase.updatedAt = new Date()
    }
    await em.flush()
    if (validation.notify || supplyCase.status === 'needs_human') {
      await emitAfterCommit('supplier_demo.supply_case.attention_required', eventPayload(scope, supplyCase.id, supplyCase.status === 'needs_human' ? supplyCase.statusReason ?? validation.reason : validation.reason, supplyMessage.id))
    }
    if (validation.status === 'valid' && validation.envelope?.messageType === 'SUPPLY_ACCEPTANCE') {
      await emitAfterCommit('supplier_demo.supply_case.reply_received', eventPayload(scope, supplyCase.id, validation.reason, supplyMessage.id))
    }
    return {
      recorded: true,
      supplyMessageId: supplyMessage.id,
      caseId: supplyCase.id,
      validationStatus: validation.status,
    }
  },
}

registerCommand(receiveInbound)

const reopenSupplyCase: CommandHandler<Record<string, unknown>, { caseId: string; status: string }> = {
  id: 'supplier_demo.supply_case.reopen',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const scope = scopeFrom(ctx)
    if (!scope) throw new CrudHttpError(401, { error: 'Unauthorized' })
    const caseId = stringValue(rawInput.caseId)
    // The route passes a Date; String(Date) would drop the milliseconds and make every version check fail.
    const updatedAt = rawInput.updatedAt instanceof Date ? rawInput.updatedAt : new Date(String(rawInput.updatedAt ?? ''))
    if (!caseId || Number.isNaN(updatedAt.getTime())) throw new CrudHttpError(422, { error: 'Case and updatedAt are required' })
    const em = (ctx.transactionalEm ?? ctx.container.resolve('em')) as EntityManager
    const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...scope, id: caseId, deletedAt: null }, undefined, scope)
    if (!supplyCase) throw notFound('Supply case not found')
    if (supplyCase.updatedAt.getTime() !== updatedAt.getTime()) throw conflict('Supply case was changed by another user')
    if (supplyCase.status !== 'needs_human') throw new CrudHttpError(422, { error: 'Supply case is not waiting for a reopen', code: 'not_reopenable' })
    const reason = supplyCase.statusReason ?? ''
    // Reopen targets per the spec's "Reopen" rule: partner-driven and infeasible outcomes wait for a new reply;
    // a held apply or send resumes where it stopped, but only once the reply toggle is on again.
    const target = reason === 'auto_reply_disabled_apply'
      ? 'reply_received'
      : reason === 'auto_reply_disabled_send' ? 'commitment_updated' : 'proposal_delivered'
    if (target !== 'proposal_delivered' && !(await isAutoSupplyReplyEnabled(ctx.container, scope.tenantId))) {
      throw new CrudHttpError(422, { error: 'Turn the automatic reply processing back on before reopening', code: 'auto_reply_disabled' })
    }
    const acceptance = target === 'reply_received'
      ? (await findWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: caseId, direction: 'inbound', messageType: 'SUPPLY_ACCEPTANCE', validationStatus: 'valid', appliedAt: null, deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope))[0] ?? null
      : null
    const confirmation = target === 'commitment_updated'
      ? (await findWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: caseId, direction: 'outbound', messageType: 'SUPPLY_COMMITMENT_CONFIRMED', deliveryStatus: 'pending', deletedAt: null }, { orderBy: { createdAt: 'desc' } }, scope))[0] ?? null
      : null
    if (target === 'reply_received' && !acceptance) throw new CrudHttpError(422, { error: 'No unapplied acceptance to resume', code: 'not_reopenable' })
    if (target === 'commitment_updated' && !confirmation) throw new CrudHttpError(422, { error: 'No pending confirmation to resume', code: 'not_reopenable' })
    supplyCase.status = target
    supplyCase.statusReason = null
    supplyCase.updatedAt = new Date()
    await em.flush()
    if (acceptance) await emitAfterCommit('supplier_demo.supply_case.reply_received', { ...scope, caseId, supplyMessageId: acceptance.id })
    if (confirmation) await emitAfterCommit('supplier_demo.supply_case.commitment_updated', { ...scope, caseId, confirmationMessageId: confirmation.id })
    return { caseId, status: supplyCase.status }
  },
}

registerCommand(reopenSupplyCase)
