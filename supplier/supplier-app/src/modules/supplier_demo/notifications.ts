import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'supplier_demo.supply_case.attention_required',
    module: 'supplier_demo',
    channels: ['in_app'],
    titleKey: 'supplier_demo.notifications.supplyCaseAttention.title',
    bodyKey: 'supplier_demo.notifications.supplyCaseAttention.body',
    icon: 'triangle-alert',
    severity: 'warning',
    category: 'supply',
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
