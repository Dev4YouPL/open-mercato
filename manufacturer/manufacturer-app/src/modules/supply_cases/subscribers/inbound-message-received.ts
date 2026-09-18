/**
 * Persistent subscriber for `communication_channels.message.received`.
 *
 * It is a thin adapter on purpose: it resolves the platform records the gate
 * needs and hands them to `acceptInboundMessage`, which owns every decision.
 * No LLM call and no workflow start happen here — the triage agent (T-09) runs
 * off `supply_cases.inbound_message.accepted`, once the message is durable and
 * the sender has been proven authorized.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getSupplyCasesStore } from '../di'
import { emitSupplyCasesEvent } from '../events'
import {
  acceptInboundMessage,
  type AcceptInboundMessagePorts,
  type InboundMessageAuditEntry,
  type InboundTransportEventPayload,
} from '../lib/inbound/acceptInboundMessage'
import { resolveInboundGateConfig } from '../lib/inbound/gateConfig'
import type { ChannelLinkRecord, ChannelRecord } from '../lib/inbound/transportGate'
import type { StoreScope } from '../data/repositories'

const logger = createLogger('supply_cases').child({ component: 'inbound-transport-gate' })

export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'supply_cases:inbound-message-received',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  payload: InboundTransportEventPayload,
  ctx: SubscriberContext,
): Promise<void> {
  const injectedPorts = tryResolve<AcceptInboundMessagePorts>(ctx, 'supplyCasesInboundTransportPorts')
  if (injectedPorts) {
    await acceptInboundMessage(payload ?? {}, injectedPorts, resolveInboundGateConfig())
    return
  }

  // Forked so this event gets its own identity map and cannot observe another
  // handler's half-applied unit of work.
  const em = (ctx.resolve('em') as EntityManager).fork()
  const store = tryResolve<ReturnType<typeof getSupplyCasesStore>>(ctx, 'supplyCasesStore') ?? getSupplyCasesStore()
  const ports = buildPorts(em, store)

  await acceptInboundMessage(payload ?? {}, ports, resolveInboundGateConfig())
}

function buildPorts(em: EntityManager, store: ReturnType<typeof getSupplyCasesStore>): AcceptInboundMessagePorts {
  return {
    // The entity classes belong to `communication_channels`; this module reads
    // them by registry name rather than importing them, so no cross-module ORM
    // relationship is created.
    async loadChannelLink(scope: StoreScope, channelLinkId: string): Promise<ChannelLinkRecord | null> {
      return (await findOneWithDecryption(
        em,
        'MessageChannelLink' as never,
        { id: channelLinkId, tenantId: scope.tenantId, organizationId: scope.organizationId } as never,
        undefined,
        scope,
      )) as ChannelLinkRecord | null
    },

    async loadChannel(scope: StoreScope, channelId: string): Promise<ChannelRecord | null> {
      return (await findOneWithDecryption(
        em,
        'CommunicationChannel' as never,
        { id: channelId, tenantId: scope.tenantId, organizationId: scope.organizationId } as never,
        undefined,
        scope,
      )) as ChannelRecord | null
    },

    inboundMessages: store.inboundMessages,

    async emitAccepted(acceptedPayload) {
      await emitSupplyCasesEvent('supply_cases.inbound_message.accepted', acceptedPayload, { persistent: true })
    },

    audit(entry: InboundMessageAuditEntry) {
      if (entry.outcome === 'rejected') {
        // A rejection is an ordinary, expected outcome of an open mailbox. It is
        // logged with its reason and scope only — never with sender text or body
        // — so the audit trail cannot become a disclosure channel of its own.
        logger.warn('inbound message rejected by transport gate', entry)
        return
      }
      logger.info(`inbound message ${entry.outcome}`, entry)
    },
  }
}

function tryResolve<T>(ctx: SubscriberContext, name: string): T | null {
  try {
    return ctx.resolve<T>(name)
  } catch {
    return null
  }
}
