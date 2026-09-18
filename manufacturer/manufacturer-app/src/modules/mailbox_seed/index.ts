import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'mailbox_seed',
  title: 'Mailbox Seed',
  version: '0.1.0',
  description: 'Idempotently connects the configured IMAP mailbox during initialization.',
  author: 'Manufacturer App',
  license: 'UNLICENSED',
  requires: ['auth', 'communication_channels', 'channel_imap'],
}

export default metadata
