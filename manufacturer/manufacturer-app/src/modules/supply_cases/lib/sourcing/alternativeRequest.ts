import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type { CanonicalInitialOption } from '../../data/initial-impact'
import { buildSupplierOutboundPorts } from '../outbound/ports'
import { sendSupplierMessage, type SendSupplierMessageResult, type SupplierOutboundPorts } from '../outbound/sendSupplierMessage'

export type AlternativeRequestResult =
  | { status: 'pending_delivery'; result: Extract<SendSupplierMessageResult, { status: 'accepted' | 'already_requested' }> }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string }

export async function requestAlternativeSupplier(params: {
  store: SupplyCasesStore
  scope: StoreScope
  caseId: string
  option: CanonicalInitialOption
  ports: SupplierOutboundPorts
}): Promise<AlternativeRequestResult> {
  const { store, scope, caseId, option } = params
  const supplyCase = await store.supplyCases.requireById(scope, caseId)
  if (option.id !== 'CHECK_ALTERNATIVE_SUPPLIER') return { status: 'blocked', reason: 'OPTION_NOT_ALTERNATIVE_SUPPLIER' }
  if (!supplyCase.supplier2Email) return { status: 'blocked', reason: 'ALTERNATIVE_SUPPLIER_UNAVAILABLE' }
  const requestQuantity = option.supply.find((supply) => supply.source === 'SUPPLIER_2')?.quantity ?? 0
  if (requestQuantity <= 0) return { status: 'blocked', reason: 'NO_SHORTAGE_TO_REQUEST' }
  const result = await sendSupplierMessage(params.ports, scope, {
    caseId: supplyCase.id,
    phase: 'ALTERNATIVE_SUPPLY_REQUEST',
    recipientEmail: supplyCase.supplier2Email,
    subject: `RFQ ${supplyCase.correlationId}: ${supplyCase.sku}`,
    body: [
      `Prosimy o ofertę na ${requestQuantity} szt. ${supplyCase.sku}.`,
      `Wymagany termin dostawy: ${supplyCase.requiredDate}.`,
      'Prosimy o potwierdzenie dostępności, ceny i waluty.',
    ].join('\n'),
  })
  if (result.status === 'accepted' || result.status === 'already_requested') {
    return { status: 'pending_delivery', result }
  }
  if (result.status === 'blocked') return { status: 'blocked', reason: result.reason }
  return { status: 'failed', reason: result.error }
}

export async function markAlternativeRequestDelivered(
  store: SupplyCasesStore,
  scope: StoreScope,
  caseId: string,
): Promise<boolean> {
  const supplyCase = await store.supplyCases.findById(scope, caseId)
  if (!supplyCase || supplyCase.status !== 'SENDING_ALTERNATIVE_REQUEST') return false
  await store.supplyCases.update(scope, caseId, {
    status: 'WAITING_FOR_ALTERNATIVE_OFFER',
    needsAttentionReason: null,
  })
  return true
}

export function resolveDefaultOutboundPorts(container: { resolve: <T = unknown>(name: string) => T }, store: SupplyCasesStore) {
  return buildSupplierOutboundPorts(container, store)
}
