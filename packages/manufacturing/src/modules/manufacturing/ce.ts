import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { BOM_ENTITY_ID } from './lib/bom/entity-ids'

/**
 * Registers the BOM family as a custom-field host so engineering metadata can
 * be attached without extending the aggregate schema. No fields ship by
 * default — the definitions are tenant-owned, and P1.4a only guarantees the
 * family-level attachment point (spec US-BOM-30).
 */
export const entities: CustomEntitySpec[] = [
  {
    id: BOM_ENTITY_ID,
    label: 'BOM',
    description: 'Custom attributes for bill-of-materials families',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
