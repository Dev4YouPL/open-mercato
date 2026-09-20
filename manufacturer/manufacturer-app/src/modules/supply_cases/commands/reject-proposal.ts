import { z } from 'zod'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { buildSupplyRejectionBody, buildSupplyRejectionEnvelope, readSupplyProposalSource } from '../lib/outbound/supplyRejection'
import { sendSupplierMessage, type SupplierOutboundPorts } from '../lib/outbound/sendSupplierMessage'
import { normalizeEmailOrNull } from '../lib/email/normalizeEmail'
import { VersionConflictError } from '../data/errors'
import { requireDecisionFeature, resolvePorts, resolveScope } from './sourcing'

export const REJECT_PRIMARY_PROPOSAL_COMMAND_ID = 'supply_cases.sourcing.reject_primary_proposal'

const inputSchema = z.object({
  caseId: z.string().min(1),
  expectedUpdatedAt: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  resend: z.boolean().optional().default(false),
  scope: z.object({ tenantId: z.string().min(1), organizationId: z.string().min(1) }).strict().optional(),
}).strict()

export type RejectPrimaryProposalResult = {
  status: 'rejected' | 'already_rejected'
  caseId: string
  businessMessageId: string
  outboundCorrelationId: string
}

const rejectPrimaryProposal: CommandHandler<Record<string, unknown>, RejectPrimaryProposalResult> = {
  id: REJECT_PRIMARY_PROPOSAL_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    await requireDecisionFeature(ctx, scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const supplyCase = await store.supplyCases.requireById(scope, input.caseId)
    const existing = (await store.outboundCorrelations.list(scope, { where: { caseId: supplyCase.id, phase: 'SUPPLY_REJECTION' } }))[0]
    if (existing && !input.resend) {
      if (!existing.businessMessageId) throw new CrudHttpError(422, { error: 'rejection_business_message_id_missing' })
      return { status: 'already_rejected', caseId: supplyCase.id, businessMessageId: existing.businessMessageId, outboundCorrelationId: existing.id }
    }
    if (existing && supplyCase.updatedAt !== input.expectedUpdatedAt) throw new CrudHttpError(409, { error: 'stale_supply_case' })
    if (supplyCase.supplier1Email === null) throw new CrudHttpError(422, { error: 'primary_supplier_missing' })
    if (!supplyCase.supplier1Proposal || typeof supplyCase.supplier1Proposal !== 'object') throw new CrudHttpError(422, { error: 'primary_proposal_missing' })
    const proposalMessages = (await store.inboundMessages.list(scope, { where: { caseId: supplyCase.id } }))
      .filter((message) => message.messageIntent === 'SUPPLY_PROPOSAL' && message.senderEmail === supplyCase.supplier1Email)
      .sort((left, right) => Date.parse(right.receivedAt ?? right.createdAt) - Date.parse(left.receivedAt ?? left.createdAt))
    const sourceMessage = proposalMessages[0]
    if (!sourceMessage) throw new CrudHttpError(422, { error: 'primary_proposal_source_missing' })
    const source = readSupplyProposalSource(sourceMessage, supplyCase)
    if (!source) throw new CrudHttpError(422, { error: 'primary_proposal_envelope_missing_or_invalid' })
    let lockedCase
    try {
      lockedCase = await store.supplyCases.compareAndSwap(scope, supplyCase.id, input.expectedUpdatedAt, {
        needsAttentionReason: supplyCase.needsAttentionReason,
      })
    } catch (error) {
      if (error instanceof VersionConflictError) throw new CrudHttpError(409, { error: 'stale_supply_case' })
      throw error
    }

    const ports = resolvePorts(ctx, store)
    const channel = await ports.loadOutboundChannel(scope)
    const sender = normalizeEmailOrNull(channel?.externalIdentifier ?? '')
    const recipient = normalizeEmailOrNull(supplyCase.supplier1Email)
    if (!sender || !recipient) throw new CrudHttpError(422, { error: 'trusted_mail_identity_missing' })
    if (recipient !== normalizeEmailOrNull(sourceMessage.senderEmail)) throw new CrudHttpError(422, { error: 'proposal_sender_mismatch' })

    const rejection = buildSupplyRejectionEnvelope({
      correlationId: source.proposal.correlationId,
      sender,
      recipient,
      sku: supplyCase.sku,
      inReplyToMessageId: source.proposal.messageId,
      reason: input.reason,
      messageId: existing?.businessMessageId ?? undefined,
    })
    const result = await sendRejection(ports, scope, lockedCase.id, rejection, source.sourceRfcMessageId, input.resend)
    if (result.status === 'blocked') throw new CrudHttpError(422, { error: `rejection_send_blocked:${result.reason}` })
    if (result.status === 'failed') throw new CrudHttpError(502, { error: 'rejection_send_failed' })
    if (!result.businessMessageId) throw new CrudHttpError(422, { error: 'rejection_business_message_id_missing' })

    await store.activities.appendIfAbsent(scope, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      caseId: supplyCase.id,
      caseCorrelationId: supplyCase.correlationId,
      kind: 'decision_recorded',
      status: 'waiting',
      actorType: ctx.systemActor ? 'system' : 'user',
      actorRef: ctx.auth?.sub ?? null,
      titleKey: 'supply_cases.activity.primaryProposalRejectionQueued',
      detailKey: 'supply_cases.activity.primaryProposalRejectionQueuedDetail',
      params: { correlationId: supplyCase.correlationId },
      occurredAt: new Date().toISOString(),
      sourceEventId: REJECT_PRIMARY_PROPOSAL_COMMAND_ID,
      sourceOccurrenceId: result.businessMessageId,
      evidenceType: 'case',
      evidenceId: supplyCase.id,
      technicalRefType: null,
      technicalRefId: null,
      dedupeKey: `case:${supplyCase.id}:supply-rejection:queued`,
      groupKey: `case:${supplyCase.id}`,
    })
    return {
      status: result.status === 'already_requested' ? 'already_rejected' : 'rejected',
      caseId: supplyCase.id,
      businessMessageId: result.businessMessageId,
      outboundCorrelationId: result.correlationId,
    }
  },
}

async function sendRejection(
  ports: SupplierOutboundPorts,
  scope: StoreScope,
  caseId: string,
  envelope: ReturnType<typeof buildSupplyRejectionEnvelope>,
  sourceRfcMessageId: string,
  resend: boolean,
) {
  return sendSupplierMessage(ports, scope, {
    caseId,
    phase: 'SUPPLY_REJECTION',
    recipientEmail: envelope.recipient,
    subject: `Re: [${envelope.correlationId}] Delivery update — ${envelope.payload.sku}`,
    body: buildSupplyRejectionBody({ envelope, reason: envelope.payload.reason }),
    inReplyTo: sourceRfcMessageId,
    references: [sourceRfcMessageId],
    businessMessageId: envelope.messageId,
  }, { resend })
}

registerCommand(rejectPrimaryProposal)
export default rejectPrimaryProposal
