import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
  type ConnectCredentialChannelInput,
  type ConnectCredentialChannelResult,
} from '@open-mercato/core/modules/communication_channels/commands/connect-credential-channel'

const configSchema = z.object({
  userEmail: z.string().email(),
  address: z.string().email(),
  password: z.string().min(1),
  imapHost: z.string().min(1).default('imap.mail.ovh.net'),
  imapPort: z.coerce.number().int().positive().default(993),
  smtpHost: z.string().min(1).default('smtp.mail.ovh.net'),
  smtpPort: z.coerce.number().int().positive().default(587),
})

type AuthServiceLike = {
  findUserByEmailAndTenant: (email: string, tenantId: string) => Promise<User | null>
}

function readConfig() {
  return configSchema.parse({
    userEmail: process.env.OM_SEED_IMAP_USER_EMAIL,
    address: process.env.OM_SEED_IMAP_ADDRESS,
    password: process.env.OM_SEED_IMAP_PASSWORD,
    imapHost: process.env.OM_SEED_IMAP_HOST,
    imapPort: process.env.OM_SEED_IMAP_PORT,
    smtpHost: process.env.OM_SEED_SMTP_HOST,
    smtpPort: process.env.OM_SEED_SMTP_PORT,
  })
}

export const setup: ModuleSetupConfig = {
  async seedDefaults({ container, tenantId, organizationId }) {
    if (process.env.OM_SEED_IMAP_ENABLED !== 'true') return
    const config = readConfig()

    const authService = container.resolve<AuthServiceLike>('authService')
    const user = await authService.findUserByEmailAndTenant(config.userEmail, tenantId)
    if (!user) {
      throw new Error('[internal] IMAP seed user was not found in the initialized tenant')
    }
    if (user.organizationId && user.organizationId !== organizationId) return

    const commandBus = container.resolve<CommandBus>('commandBus')
    const input: ConnectCredentialChannelInput = {
      providerKey: 'imap',
      displayName: 'Zimbra OVH',
      credentials: {
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapTls: 'tls',
        imapUser: config.address,
        imapPassword: config.password,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpTls: 'starttls',
        smtpUser: config.address,
        smtpPassword: config.password,
        fromAddress: config.address,
      },
      pollIntervalSeconds: 10,
      userId: user.id,
      scope: { tenantId, organizationId },
    }

    const { result } = await commandBus.execute<ConnectCredentialChannelInput, ConnectCredentialChannelResult>(
      COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
      {
        input,
        ctx: {
          container,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
          systemActor: true,
        },
      },
    )

    if (result.status !== 'connected') {
      throw new Error(`[internal] IMAP seed failed with status ${result.status}`)
    }
  },
}

export default setup
