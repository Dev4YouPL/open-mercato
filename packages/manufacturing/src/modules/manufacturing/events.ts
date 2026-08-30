import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'manufacturing.bom.created', label: 'BOM Created', entity: 'bom', category: 'crud', clientBroadcast: true },
  { id: 'manufacturing.bom.updated', label: 'BOM Updated', entity: 'bom', category: 'crud', clientBroadcast: true },
  { id: 'manufacturing.bom.deleted', label: 'BOM Deleted', entity: 'bom', category: 'crud', clientBroadcast: true },
  {
    id: 'manufacturing.bom_line.created',
    label: 'BOM Line Created',
    entity: 'bom_line',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'manufacturing.bom_line.updated',
    label: 'BOM Line Updated',
    entity: 'bom_line',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'manufacturing.bom_line.deleted',
    label: 'BOM Line Deleted',
    entity: 'bom_line',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'manufacturing.bom_line.reordered',
    label: 'BOM Line Reordered',
    entity: 'bom_line',
    category: 'crud',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'manufacturing', events })
export const emitManufacturingEvent = eventsConfig.emit
export type ManufacturingEventId = (typeof events)[number]['id']
export default eventsConfig
