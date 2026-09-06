/**
 * Platform entity ids for the BOM aggregate. Kept free of server-only imports
 * so backend commands and browser forms can share one source of truth.
 *
 * Engineering metadata belongs to the BOM family, not to its revision or its
 * lines (spec US-BOM-30), so custom fields are keyed by the family record.
 */
export const BOM_ENTITY_ID = 'manufacturing:manufacturing_bom'
export const BOM_REVISION_ENTITY_ID = 'manufacturing:manufacturing_bom_revision'
export const BOM_LINE_ENTITY_ID = 'manufacturing:manufacturing_bom_line'
