import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'supplier_demo:supply_case',
    fields: [{ field: 'recipient_email' }, { field: 'customer_snapshot' }],
  },
  {
    entityId: 'supplier_demo:supply_message',
    fields: [{ field: 'recipient_email' }, { field: 'sender_email' }, { field: 'body_excerpt' }],
  },
]

export default defaultEncryptionMaps
