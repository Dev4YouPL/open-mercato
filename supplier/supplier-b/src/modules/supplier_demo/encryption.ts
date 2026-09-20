import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'supplier_demo:supply_case',
    fields: [{ field: 'recipient_email' }, { field: 'customer_snapshot' }],
  },
  {
    entityId: 'supplier_demo:supply_message',
    fields: [{ field: 'recipient_email' }, { field: 'sender_email' }, { field: 'body_excerpt' }, { field: 'interpretation_record' }],
  },
  {
    entityId: 'supplier_demo:supplier_rfq',
    fields: [{ field: 'sender_email' }, { field: 'recipient_email' }, { field: 'raw_body' }, { field: 'interpretation_record' }, { field: 'reply_body' }],
  },
]

export default defaultEncryptionMaps
