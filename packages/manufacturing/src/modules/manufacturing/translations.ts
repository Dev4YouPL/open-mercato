import { WORK_CENTER_ENTITY_ID } from './lib/work-centers/entity-ids'

/**
 * Fields the Translation Manager may translate. Only the Work Centre's own
 * free-text fields qualify — `code` is an operator-facing identifier and
 * membership is scalar ids owned by another module.
 */
export const translatableFields: Record<string, string[]> = {
  [WORK_CENTER_ENTITY_ID]: ['name', 'description'],
}

export default translatableFields
