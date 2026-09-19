import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SupplierDemoMailboxError, type MailboxPollChannel } from '../mailbox'

const resolveMailboxPollChannel = jest.fn<(input: unknown) => Promise<MailboxPollChannel>>()

jest.mock('../mailbox', () => {
  const actual = jest.requireActual<typeof import('../mailbox')>('../mailbox')
  return { ...actual, resolveMailboxPollChannel: (input: unknown) => resolveMailboxPollChannel(input) }
})
jest.mock('@open-mercato/core/modules/communication_channels/lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { poll: 'communication-channels-poll' },
  getCommunicationChannelsQueue: () => ({ enqueue: async () => undefined }),
}))

import { requestMailboxPoll } from '../mailbox-poll'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const polled = { realtimePush: false }

function channel(overrides: Partial<MailboxPollChannel> = {}): MailboxPollChannel {
  return { id: 'channel-1', isActive: true, status: 'connected', capabilities: polled, ...overrides }
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    return error instanceof SupplierDemoMailboxError ? error.code : 'unexpected'
  }
}

describe('supplier mailbox poll-now pre-checks', () => {
  beforeEach(() => {
    resolveMailboxPollChannel.mockReset()
  })

  it.each(['connected', 'error'])('enqueues exactly one hub poll job for a %s channel', async (status) => {
    resolveMailboxPollChannel.mockResolvedValue(channel({ status }))
    const enqueue = jest.fn(async (_job: unknown) => undefined)
    const result = await requestMailboxPoll({} as EntityManager, scope, { dependencies: { enqueue } })
    expect(result).toMatchObject({ queued: true, channelId: 'channel-1' })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith({ channelId: 'channel-1', scope, attempt: 1 })
  })

  it.each([
    ['mailbox_disabled', channel({ isActive: false })],
    ['mailbox_disconnected', channel({ status: 'disconnected' })],
    ['mailbox_requires_reauth', channel({ status: 'requires_reauth' })],
    ['mailbox_not_polled', channel({ capabilities: { realtimePush: true } })],
  ])('refuses with %s and enqueues nothing', async (code, resolved) => {
    resolveMailboxPollChannel.mockResolvedValue(resolved)
    const enqueue = jest.fn(async (_job: unknown) => undefined)
    expect(await codeOf(requestMailboxPoll({} as EntityManager, scope, { dependencies: { enqueue } }))).toBe(code)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('propagates a missing mailbox configuration', async () => {
    resolveMailboxPollChannel.mockRejectedValue(new SupplierDemoMailboxError('mailbox_not_configured'))
    expect(await codeOf(requestMailboxPoll({} as EntityManager, scope))).toBe('mailbox_not_configured')
  })
})
