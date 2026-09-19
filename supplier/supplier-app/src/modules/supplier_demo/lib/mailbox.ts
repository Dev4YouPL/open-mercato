import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  SendAsUserActor,
  SendAsUserInput,
  SendAsUserResult,
} from '@open-mercato/core/modules/communication_channels/lib/send-as-user'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { z } from 'zod'

const mailboxEnvironmentSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
})

const mailboxInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
  html: z.string().trim().optional(),
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
})

export type MailboxErrorCode =
  | 'mailbox_channel_id_missing'
  | 'mailbox_user_id_missing'
  | 'mailbox_configuration_invalid'
  | 'mailbox_user_not_found'
  | 'mailbox_not_configured'
  | 'mailbox_disconnected'
  | 'mailbox_provider_unsupported'
  | 'mailbox_send_failed'

export class SupplierDemoMailboxError extends Error {
  readonly code: MailboxErrorCode

  constructor(code: MailboxErrorCode) {
    super(code)
    this.name = 'SupplierDemoMailboxError'
    this.code = code
  }
}

export type MailboxActor = SendAsUserActor & {
  channelId: string
  providerKey: string
  fromAddress?: string
}

type MailboxEnvironment = Record<string, string | undefined>

type ResolveMailboxActorInput = {
  em: EntityManager
  env?: MailboxEnvironment
  expectedScope?: { tenantId: string; organizationId: string }
}

export type SupplyMailInput = {
  to: string
  subject: string
  body: string
  html?: string
  channelMetadata?: Record<string, unknown>
}

type SendAsUser = (
  container: AppContainer,
  actor: SendAsUserActor,
  input: SendAsUserInput,
) => Promise<SendAsUserResult>

function readMailboxEnvironment(env: MailboxEnvironment): { channelId: string; userId: string } {
  if (!env.SUPPLIER_DEMO_MAILBOX_CHANNEL_ID?.trim()) {
    throw new SupplierDemoMailboxError('mailbox_channel_id_missing')
  }
  if (!env.SUPPLIER_DEMO_MAILBOX_USER_ID?.trim()) {
    throw new SupplierDemoMailboxError('mailbox_user_id_missing')
  }

  const parsed = mailboxEnvironmentSchema.safeParse({
    channelId: env.SUPPLIER_DEMO_MAILBOX_CHANNEL_ID,
    userId: env.SUPPLIER_DEMO_MAILBOX_USER_ID,
  })
  if (!parsed.success) {
    throw new SupplierDemoMailboxError('mailbox_configuration_invalid')
  }
  return parsed.data
}

export async function resolveMailboxActor({ em, env = process.env, expectedScope }: ResolveMailboxActorInput): Promise<MailboxActor> {
  const configured = readMailboxEnvironment(env)
  const user = await findOneWithDecryption(
    em,
    User,
    { id: configured.userId, deletedAt: null },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!user?.tenantId) {
    throw new SupplierDemoMailboxError('mailbox_user_not_found')
  }

  const scope = {
    tenantId: user.tenantId,
    organizationId: user.organizationId ?? null,
  }
  if (expectedScope && (scope.tenantId !== expectedScope.tenantId || scope.organizationId !== expectedScope.organizationId)) {
    throw new SupplierDemoMailboxError('mailbox_not_configured')
  }
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: configured.channelId,
      userId: configured.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!channel) {
    throw new SupplierDemoMailboxError('mailbox_not_configured')
  }
  if (!channel.isActive || channel.status !== 'connected') {
    throw new SupplierDemoMailboxError('mailbox_disconnected')
  }
  if (channel.providerKey !== 'imap') {
    throw new SupplierDemoMailboxError('mailbox_provider_unsupported')
  }

  return {
    userId: configured.userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    channelId: channel.id,
    providerKey: channel.providerKey,
    fromAddress: channel.externalIdentifier ?? undefined,
    auth: null,
  }
}

export async function sendSupplyMail(
  container: AppContainer,
  input: SupplyMailInput,
  options: { actor?: MailboxActor; env?: MailboxEnvironment } = {},
): Promise<Extract<SendAsUserResult, { ok: true }>> {
  const parsed = mailboxInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new SupplierDemoMailboxError('mailbox_send_failed')
  }

  const actor = options.actor ?? await resolveMailboxActor({
    em: container.resolve('em') as EntityManager,
    env: options.env,
  })
  const sendAsUser = container.resolve('communicationChannelsSendAsUser') as SendAsUser
  const result = await sendAsUser(container, actor, {
    userChannelId: actor.channelId,
    to: [parsed.data.to],
    subject: parsed.data.subject,
    body: parsed.data.html
      ? { plain: parsed.data.body, html: parsed.data.html }
      : { plain: parsed.data.body },
    channelMetadata: parsed.data.channelMetadata,
  })
  if (!result.ok) {
    throw new SupplierDemoMailboxError('mailbox_send_failed')
  }
  return result
}
