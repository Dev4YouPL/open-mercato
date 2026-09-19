import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveMailboxActor } from '../mailbox'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const findOne = findOneWithDecryption as unknown as {
  mockReset: () => void
  mockResolvedValueOnce: (value: unknown) => void
}
const em = {} as EntityManager
const validEnvironment = {
  SUPPLIER_DEMO_MAILBOX_CHANNEL_ID: '11111111-1111-4111-8111-111111111111',
  SUPPLIER_DEMO_MAILBOX_USER_ID: '22222222-2222-4222-8222-222222222222',
}

describe('resolveMailboxActor', () => {
  beforeEach(() => { findOne.mockReset() })

  it('rejects missing mailbox environment values with typed errors', async () => {
    await expect(resolveMailboxActor({ em, env: {} })).rejects.toMatchObject({
      code: 'mailbox_channel_id_missing',
    })
  })

  it('rejects a channel outside the mailbox user scope as not configured', async () => {
    findOne.mockResolvedValueOnce({ tenantId: 'tenant-a', organizationId: 'org-a' } as never)
    findOne.mockResolvedValueOnce(null)

    await expect(resolveMailboxActor({ em, env: validEnvironment })).rejects.toMatchObject({
      code: 'mailbox_not_configured',
    })
  })

  it('rejects a disconnected channel with a typed error', async () => {
    findOne.mockResolvedValueOnce({ tenantId: 'tenant-a', organizationId: 'org-a' } as never)
    findOne.mockResolvedValueOnce({
      id: validEnvironment.SUPPLIER_DEMO_MAILBOX_CHANNEL_ID,
      providerKey: 'imap',
      userId: validEnvironment.SUPPLIER_DEMO_MAILBOX_USER_ID,
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      isActive: true,
      status: 'disconnected',
    } as never)

    await expect(resolveMailboxActor({ em, env: validEnvironment })).rejects.toMatchObject({
      code: 'mailbox_disconnected',
    })
  })
})
