import { z } from 'zod'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, forbidden } from '@open-mercato/shared/lib/crud/errors'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { isSupplyStoreError, RecordNotFoundError } from '../data/errors'
import { emitSupplyCasesEvent } from '../events'
import { resolveCurrentAlternativeOfferCorrelation, validateAlternativeOffer } from '../lib/resolution/offer'

export const RECORD_ALTERNATIVE_OFFER_COMMAND_ID = 'supply_cases.offer.record_alternative'

const scopeSchema = z.object({ tenantId: z.string().min(1), organizationId: z.string().min(1) }).strict()
const inputSchema = z.object({ inboundMessageId: z.string().min(1), scope: scopeSchema.optional() }).strict()

export type RecordAlternativeOfferResult = {
  status: 'recorded' | 'already_recorded' | 'needs_attention'
  caseId: string | null
  offerHash: string | null
  reason: string | null
}

const command: CommandHandler<Record<string, unknown>, RecordAlternativeOfferResult> = {
  id: RECORD_ALTERNATIVE_OFFER_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const message = await store.inboundMessages.findById(scope, input.inboundMessageId)
    if (!message) throw new RecordNotFoundError('InboundMessage', input.inboundMessageId)
    const caseId = message.caseId
    if (!caseId) {
      return { status: 'needs_attention', caseId, offerHash: null, reason: 'OFFER_INVALID' }
    }
    const supplyCase = await store.supplyCases.requireById(scope, caseId)
    const extraction = message.extraction
    if (
      message.messageIntent !== 'ALTERNATIVE_SUPPLY_OFFER'
      || message.triageOutcome !== 'AUTO_APPLIED'
      || message.triageDisposition !== 'AUTO_APPLIED'
      || message.candidateIndexes.length !== 1
      || !extraction
      || extraction.intent !== 'ALTERNATIVE_SUPPLY_OFFER'
      || extraction.correlation.kind !== 'EXISTING_CASE'
      || !extraction.sku
      || !extraction.price
    ) return markNeedsAttention(store, scope, supplyCase.id, 'OFFER_INVALID')
    const correlations = await store.outboundCorrelations.list(scope)
    const correlation = resolveCurrentAlternativeOfferCorrelation(message, correlations)
    if (!correlation) return markNeedsAttention(store, scope, supplyCase.id, 'MISSING_DATA')
    const commitmentQuantity = extraction.commitments.reduce((total: number, item) => total + item.quantity, 0)
    const validation = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: message.senderEmail,
      sku: extraction.sku,
      sourceInboundMessageId: message.id,
      sourceRfcMessageId: message.rfcMessageId,
      sourceOutboundCorrelationId: correlation.id,
      requestedQuantity: commitmentQuantity,
      offeredQuantity: commitmentQuantity,
      commitments: extraction.commitments.map((item) => ({ quantity: item.quantity, date: item.date })),
      priceTotal: extraction.price,
      recordedAt: message.receivedAt ?? message.createdAt,
    })
    if (!validation.ok) return markNeedsAttention(store, scope, supplyCase.id, validation.reason)
    try {
      const recorded = await store.supplyCases.recordAlternativeOfferIfAbsent(scope, supplyCase.id, supplyCase.updatedAt, validation.offer)
      if (recorded.status === 'recorded') {
        await emitSupplyCasesEvent('supply_cases.alternative_offer.received', {
          caseId: supplyCase.id,
          inboundMessageId: message.id,
          offerHash: validation.offer.offerHash,
          status: recorded.status,
          occurredAt: validation.offer.recordedAt,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
      }
      return { status: recorded.status, caseId: supplyCase.id, offerHash: validation.offer.offerHash, reason: null }
    } catch (error) {
      if (isSupplyStoreError(error) && error.code === 'offer_conflict') return markNeedsAttention(store, scope, supplyCase.id, 'OFFER_CONFLICT')
      throw error
    }
  },
}

registerCommand(command)
export default command

async function markNeedsAttention(store: SupplyCasesStore, scope: StoreScope, caseId: string, reason: 'OFFER_INVALID' | 'MISSING_DATA' | 'OFFER_CONFLICT') {
  const current = await store.supplyCases.requireById(scope, caseId)
  await store.supplyCases.compareAndSwap(scope, caseId, current.updatedAt, { status: 'NEEDS_ATTENTION', needsAttentionReason: reason })
  return { status: 'needs_attention' as const, caseId, offerHash: null, reason }
}

function resolveScope(ctx: CommandRuntimeContext, requested: StoreScope | undefined): StoreScope {
  if (ctx.systemActor) {
    if (!requested) throw badRequest('scope_required')
    return requested
  }
  if (requested) throw forbidden('scope_not_allowed')
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null
  if (!tenantId || !organizationId) throw badRequest('organization_scope_required')
  return { tenantId, organizationId }
}
