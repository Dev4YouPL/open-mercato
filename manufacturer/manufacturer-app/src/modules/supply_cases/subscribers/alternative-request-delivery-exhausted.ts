import type { EntityManager } from '@mikro-orm/postgresql'
import type { SupplyCasesStore } from '../data/repositories'

export const metadata = {
  event: 'communication_channels.message.delivery_exhausted',
  persistent: true,
  id: 'supply_cases:alternative-request-delivery-exhausted',
}

type Payload = { messageId?: unknown; tenantId?: unknown; organizationId?: unknown }
type Resolver = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: Payload, ctx: Resolver & { container?: Resolver }) {
  const messageId = nonEmpty(payload.messageId)
  const tenantId = nonEmpty(payload.tenantId)
  const organizationId = nonEmpty(payload.organizationId)
  if (!messageId || !tenantId || !organizationId) return
  const container = ctx.container ?? ctx
  const em = container.resolve<EntityManager>('em').fork()
  const link = await em.findOne('MessageChannelLink' as never, {
    messageId, tenantId, organizationId, direction: 'outbound',
  } as never) as unknown as { channelMetadata?: Record<string, unknown> | null } | null
  const rfcMessageId = normalizeMessageId(link?.channelMetadata?.messageId)
  if (!rfcMessageId) return
  const scope = { tenantId, organizationId }
  const store = container.resolve<SupplyCasesStore>('supplyCasesStore')
  const correlation = await store.outboundCorrelations.findByRfcMessageId(scope, rfcMessageId)
  if (!correlation || correlation.phase !== 'ALTERNATIVE_SUPPLY_REQUEST') return
  const supplyCase = await store.supplyCases.findById(scope, correlation.caseId)
  if (!supplyCase || supplyCase.status !== 'SENDING_ALTERNATIVE_REQUEST') return
  await store.supplyCases.update(scope, supplyCase.id, { status: 'NEEDS_ATTENTION', needsAttentionReason: 'DELIVERY_FAILED' })
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
