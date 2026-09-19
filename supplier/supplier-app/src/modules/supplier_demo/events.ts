import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'supplier_demo.supply_case.opened', label: 'Supply case opened', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.proposal_ready', label: 'Supply proposal ready', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.proposal_queued', label: 'Supply proposal queued', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.proposal_delivered', label: 'Supply proposal delivered', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.attention_required', label: 'Supply case attention required', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.reply_received', label: 'Supply reply received', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.commitment_updated', label: 'Supply commitment updated', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.confirmation_queued', label: 'Supply confirmation queued', entity: 'supply_case', category: 'lifecycle' },
  { id: 'supplier_demo.supply_case.resolved', label: 'Supply case resolved', entity: 'supply_case', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'supplier_demo', events })
export const emitSupplierDemoEvent = eventsConfig.emit
export type SupplierDemoEventId = typeof events[number]['id']

export default eventsConfig
