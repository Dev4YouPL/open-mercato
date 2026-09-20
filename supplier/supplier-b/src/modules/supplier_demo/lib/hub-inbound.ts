import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ExternalMessage, MessageChannelLink } from '@open-mercato/core/modules/communication_channels/data/entities'
import { Message } from '@open-mercato/core/modules/messages/data/entities'

export type HubInboundEvent = {
  channelLinkId?: unknown
  messageId?: unknown
  externalMessageId?: unknown
  channelId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export type HubInboundRecord = {
  link: MessageChannelLink
  message: Message
  externalMessage: ExternalMessage | null
  transportSender: string | null
  transportRecipient: string | null
  rfcMessageId: string | null
  body: string
  bodyFormat: 'text' | 'markdown' | 'html'
  subject: string
  threadId: string | null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadString(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  return stringValue(payload?.[key])
}

export async function loadHubInboundRecord(
  em: EntityManager,
  event: HubInboundEvent,
  scope: { tenantId: string; organizationId: string },
): Promise<HubInboundRecord | null> {
  const channelLinkId = stringValue(event.channelLinkId)
  if (!channelLinkId) return null
  const link = await findOneWithDecryption(em, MessageChannelLink, {
    id: channelLinkId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, undefined, scope)
  if (!link) return null
  const message = await findOneWithDecryption(em, Message, {
    id: link.messageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
  if (!message) return null
  const externalMessage = link.externalMessageId
    ? await findOneWithDecryption(em, ExternalMessage, {
      id: link.externalMessageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, undefined, scope)
    : null
  const channelPayload = link.channelPayload ?? {}
  const sender = stringValue(externalMessage?.senderIdentifier)
    ?? payloadString(channelPayload, 'from')
    ?? payloadString(channelPayload, 'sender')
  const recipient = payloadString(channelPayload, 'to') ?? payloadString(channelPayload, 'recipient')
  const rfcMessageId = payloadString(channelPayload, 'messageId')
    ?? payloadString(channelPayload, 'rfcMessageId')
    ?? payloadString(channelPayload, 'message_id')
  return {
    link,
    message,
    externalMessage,
    transportSender: sender,
    transportRecipient: recipient,
    rfcMessageId,
    body: message.body ?? payloadString(channelPayload, 'text') ?? '',
    bodyFormat: message.bodyFormat ?? (link.channelContentType === 'text/html' ? 'html' : 'text'),
    subject: message.subject ?? payloadString(channelPayload, 'subject') ?? '',
    threadId: message.threadId ?? null,
  }
}
