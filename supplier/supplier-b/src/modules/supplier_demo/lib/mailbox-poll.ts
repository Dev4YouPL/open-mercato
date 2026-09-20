import type { EntityManager } from '@mikro-orm/postgresql'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '@open-mercato/core/modules/communication_channels/lib/queue'
import { isHubPolledChannel } from '@open-mercato/core/modules/communication_channels/lib/polling-eligibility'
import type { PollChannelJobPayload } from '@open-mercato/core/modules/communication_channels/workers/poll-channel'
import { resolveMailboxPollChannel, SupplierDemoMailboxError } from './mailbox'

export type MailboxPollScope = { tenantId: string; organizationId: string }

export type MailboxPollResult = {
  queued: true
  requestedAt: string
  channelId: string
}

type MailboxPollDependencies = {
  enqueue?: (payload: PollChannelJobPayload) => Promise<void>
  now?: () => Date
}

export async function requestMailboxPoll(
  em: EntityManager,
  scope: MailboxPollScope,
  options: { env?: Record<string, string | undefined>; dependencies?: MailboxPollDependencies } = {},
): Promise<MailboxPollResult> {
  const channel = await resolveMailboxPollChannel({ em, env: options.env, expectedScope: scope })
  if (!channel.isActive) throw new SupplierDemoMailboxError('mailbox_disabled')
  if (channel.status === 'disconnected') throw new SupplierDemoMailboxError('mailbox_disconnected')
  if (channel.status === 'requires_reauth') throw new SupplierDemoMailboxError('mailbox_requires_reauth')
  if (!['connected', 'error'].includes(channel.status)) throw new SupplierDemoMailboxError('mailbox_disconnected')
  if (!isHubPolledChannel(channel.capabilities)) throw new SupplierDemoMailboxError('mailbox_not_polled')

  const payload: PollChannelJobPayload = {
    channelId: channel.id,
    scope,
    attempt: 1,
  }
  const enqueue = options.dependencies?.enqueue
    ?? (async (job: PollChannelJobPayload) => {
      await getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll).enqueue(job as unknown as Record<string, unknown>)
    })
  await enqueue(payload)

  return {
    queued: true,
    requestedAt: (options.dependencies?.now ?? (() => new Date()))().toISOString(),
    channelId: channel.id,
  }
}
