import { createModuleEvents } from "@open-mercato/shared/modules/events";

export type BomReleasedEventPayload = {
  id: string
  tenantId: string
  organizationId: string
  outputVariantId: string
  revision: string
  isIncomplete: boolean
}

const events = [
    {
        id: 'manufacturing.bom.created',
        label: 'BOM Created',
        entity: 'bom',
        category: 'crud'
    },
    {
        id: 'manufacturing.bom.updated',
        label: 'BOM Updated',
        entity: 'bom',
        category: 'crud',
    },
    {
        id: 'manufacturing.bom.deleted',
        label: 'BOM Deleted',
        entity: 'bom',
        category: 'crud',
    },
    {
        id: 'manufacturing.bom_item.created',
        label: 'BOM Item Created',
        entity: 'bom_item',
        category: 'crud',
    },
    {
        id: 'manufacturing.bom.released',
        label: 'BOM Released',
        entity: 'bom',
        category: 'lifecycle',
    },
    {
        id: 'manufacturing.bom_item.updated',
        label: 'BOM Item Updated',
        entity: 'bom_item',
        category: 'crud',
    },
    {
        id: 'manufacturing.bom_item.deleted',
        label: 'BOM Item Deleted',
        entity: 'bom_item',
        category: 'crud',
    },
] as const

export const eventsConfig = createModuleEvents({
    moduleId: 'manufacturing',
    events
})

export const emitManufacturingEvent = eventsConfig.emit

export type ManufacturingEventId = (typeof events)[number]['id']

export default eventsConfig