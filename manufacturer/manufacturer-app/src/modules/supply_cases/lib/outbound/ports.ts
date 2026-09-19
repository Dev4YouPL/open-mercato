/**
 * Wiring for `sendSupplierMessage` — the half that knows about the platform.
 *
 * Kept apart from the decision so the decision stays testable without a
 * container, and so the two cross-module reads it performs are in one place:
 * the channel row, and the hub's in-process send facade.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import { resolveInboundGateConfig } from '../inbound/gateConfig'
import type {
  OutboundChannelRecord,
  SupplierOutboundPorts,
  SupplierOutboundTransportInput,
  SupplierOutboundTransportResult,
} from './sendSupplierMessage'

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }

type SendAsUserFacade = (
  container: unknown,
  actor: { userId: string; tenantId: string; organizationId: string | null },
  input: {
    userChannelId: string
    to: string[]
    subject: string
    body: { plain?: string; html?: string }
    inReplyTo?: string
    references?: string[]
    channelMetadata?: Record<string, unknown>
  },
) => Promise<
  | { ok: true; messageId: string; threadId: string; channelId: string; providerKey: string }
  | { ok: false; status: number; error: string }
>

/**
 * We send through the SAME mailbox we poll.
 *
 * This is not a convenience: the supplier replies to the address we sent from,
 * and a reply that lands in a mailbox the inbound gate does not read is a reply
 * that never reaches a case. So the outbound provider set is the inbound one,
 * and there is deliberately no second knob that could drift away from it.
 */
export function resolveOutboundProviderKeys(): ReadonlySet<string> {
  return resolveInboundGateConfig().allowedProviderKeys
}

export function buildSupplierOutboundPorts(
  container: ResolverContainer,
  store: SupplyCasesStore,
): SupplierOutboundPorts {
  return {
    outboundCorrelations: store.outboundCorrelations,

    async loadOutboundChannel(scope: StoreScope): Promise<OutboundChannelRecord | null> {
      const em = (container.resolve('em') as EntityManager).fork()
      const allowed = resolveOutboundProviderKeys()
      // The entity class belongs to `communication_channels`; it is read by
      // registry name so this module creates no cross-module ORM relationship.
      const rows = (await findWithDecryption(
        em,
        'CommunicationChannel' as never,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        } as never,
        undefined,
        scope,
      )) as unknown as OutboundChannelRecord[]

      const candidates = rows.filter((row) => allowed.has(String(row.providerKey).toLowerCase()))
      if (candidates.length === 0) return rows[0] ?? null
      // Prefer a channel that can actually send. Returning an unusable one when
      // no usable one exists is deliberate: it lets the decision report WHY
      // nothing can be sent instead of collapsing every cause into "no channel".
      return candidates.find(isSendable) ?? candidates[0]
    },

    async send(input: SupplierOutboundTransportInput): Promise<SupplierOutboundTransportResult> {
      const sendAsUser = container.resolve<SendAsUserFacade>('communicationChannelsSendAsUser')
      const result = await sendAsUser(
        container,
        {
          userId: input.actorUserId,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
        },
        {
          userChannelId: input.channelId,
          to: [input.to],
          subject: input.subject,
          body: { plain: input.body },
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
          ...(input.references && input.references.length > 0
            ? { references: [...input.references] }
            : {}),
          // The one key that carries our pre-minted identity to the adapter. The
          // hub strips only reply-targeting keys, so this survives to SMTP.
          channelMetadata: { messageId: input.rfcMessageId },
        },
      )

      if (!result.ok) return { ok: false, error: `${result.status}: ${result.error}` }
      return { ok: true, messageId: result.messageId, threadId: result.threadId }
    },
  }
}

function isSendable(channel: OutboundChannelRecord): boolean {
  return channel.isActive && channel.status === 'connected' && Boolean(channel.userId)
}
