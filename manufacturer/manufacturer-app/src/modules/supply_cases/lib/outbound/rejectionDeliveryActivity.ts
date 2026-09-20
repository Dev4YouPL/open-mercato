import type { EntityManager } from '@mikro-orm/postgresql'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type { OutboundCorrelation } from '../../data/types'

type Resolver = { resolve: <T = unknown>(name: string) => T }

export async function resolveSupplyRejectionCorrelation(
  payload: { channelLinkId?: unknown; messageId?: unknown; tenantId?: unknown; organizationId?: unknown },
  container: Resolver,
): Promise<{ scope: StoreScope; store: SupplyCasesStore; correlation: OutboundCorrelation } | null> {
  const tenantId = nonEmpty(payload.tenantId)
  const organizationId = nonEmpty(payload.organizationId)
  if (!tenantId || !organizationId) return null
  const channelLinkId = nonEmpty(payload.channelLinkId)
  const messageId = nonEmpty(payload.messageId)
  if (!channelLinkId && !messageId) return null
  const em = container.resolve<EntityManager>('em').fork()
  const link = await em.findOne(
    'MessageChannelLink' as never,
    channelLinkId
      ? { id: channelLinkId, tenantId, organizationId, direction: 'outbound' }
      : { messageId, tenantId, organizationId, direction: 'outbound' },
  ) as unknown as { channelMetadata?: Record<string, unknown> | null } | null
  const rfcMessageId = normalizeMessageId(link?.channelMetadata?.messageId)
  if (!rfcMessageId) return null
  const scope = { tenantId, organizationId }
  const store = container.resolve<SupplyCasesStore>('supplyCasesStore')
  const correlation = await store.outboundCorrelations.findByRfcMessageId(scope, rfcMessageId)
  if (!correlation || correlation.phase !== 'SUPPLY_REJECTION') return null
  return { scope, store, correlation }
}

export async function recordSupplyRejectionDeliveryActivity(
  resolved: { scope: StoreScope; store: SupplyCasesStore; correlation: OutboundCorrelation },
  status: 'success' | 'error',
  sourceEventId: string,
): Promise<void> {
  const supplyCase = await resolved.store.supplyCases.findById(resolved.scope, resolved.correlation.caseId)
  if (!supplyCase) return
  const delivered = status === 'success'
  await resolved.store.activities.appendIfAbsent(resolved.scope, {
    tenantId: resolved.scope.tenantId,
    organizationId: resolved.scope.organizationId,
    caseId: supplyCase.id,
    caseCorrelationId: supplyCase.correlationId,
    kind: 'decision_recorded',
    status,
    actorType: 'system',
    actorRef: null,
    titleKey: delivered
      ? 'supply_cases.activity.primaryProposalRejectionDelivered'
      : 'supply_cases.activity.primaryProposalRejectionDeliveryFailed',
    detailKey: delivered
      ? 'supply_cases.activity.primaryProposalRejectionDeliveredDetail'
      : 'supply_cases.activity.primaryProposalRejectionDeliveryFailedDetail',
    params: { correlationId: supplyCase.correlationId },
    occurredAt: new Date().toISOString(),
    sourceEventId,
    sourceOccurrenceId: resolved.correlation.businessMessageId ?? resolved.correlation.rfcMessageId,
    evidenceType: 'case',
    evidenceId: supplyCase.id,
    technicalRefType: null,
    technicalRefId: null,
    dedupeKey: `case:${supplyCase.id}:supply-rejection:${delivered ? 'delivered' : 'failed'}`,
    groupKey: `case:${supplyCase.id}`,
  })
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeMessageId(value: unknown): string | null {
  const raw = nonEmpty(value)
  if (!raw) return null
  return raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
}
