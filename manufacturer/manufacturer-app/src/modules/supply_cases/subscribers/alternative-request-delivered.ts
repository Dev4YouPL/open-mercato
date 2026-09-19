import type { EntityManager } from '@mikro-orm/postgresql'
import type { SupplyCasesStore } from '../data/repositories'
import { markAlternativeRequestDelivered } from '../lib/sourcing/alternativeRequest'
import { signalCaseWorkflow } from '../lib/workflow/phaseSignals'
import { ALTERNATIVE_REQUEST_DELIVERED_SIGNAL } from '../workflows'

export const metadata = {
  event: 'communication_channels.message.sent',
  persistent: true,
  id: 'supply_cases:alternative-request-delivered',
}

type DeliveryPayload = {
  channelLinkId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: DeliveryPayload, ctx: ResolverContainer & { container?: ResolverContainer }) {
  const channelLinkId = nonEmpty(payload.channelLinkId)
  const tenantId = nonEmpty(payload.tenantId)
  const organizationId = nonEmpty(payload.organizationId)
  if (!channelLinkId || !tenantId || !organizationId) return

  const container = ctx.container ?? ctx
  const em = container.resolve<EntityManager>('em').fork()
  const link = await em.findOne(
    'MessageChannelLink' as never,
    { id: channelLinkId, tenantId, organizationId, direction: 'outbound' } as never,
  ) as unknown as { channelMetadata?: Record<string, unknown> | null } | null
  const messageId = normalizeMessageId(link?.channelMetadata?.messageId)
  if (!messageId) return

  const store = container.resolve<SupplyCasesStore>('supplyCasesStore')
  const scope = { tenantId, organizationId }
  const correlation = await store.outboundCorrelations.findByRfcMessageId(scope, messageId)
  if (!correlation || correlation.phase !== 'ALTERNATIVE_SUPPLY_REQUEST') return
  const changed = await markAlternativeRequestDelivered(store, scope, correlation.caseId)
  if (!changed) return
  const supplyCase = await store.supplyCases.requireById(scope, correlation.caseId)
  await signalCaseWorkflow(container, scope, supplyCase.workflowInstanceId, ALTERNATIVE_REQUEST_DELIVERED_SIGNAL, {
    caseId: supplyCase.id,
    outboundCorrelationId: correlation.id,
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
