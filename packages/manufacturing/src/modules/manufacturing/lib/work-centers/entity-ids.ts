/**
 * Platform entity ids for the Work Centre aggregate. Browser-safe: backend
 * commands, the CRUD route and client form metadata share one source of truth,
 * and package runtime code never reaches for the app-generated `E` registry.
 *
 * Parity with `yarn generate` output is an implementation acceptance test
 * (see `__tests__/entity-ids.test.ts`).
 */
export const WORK_CENTER_ENTITY_ID = 'manufacturing:manufacturing_work_center'
export const WORK_CENTER_RESOURCE_ENTITY_ID = 'manufacturing:manufacturing_work_center_resource'

/** Runtime entity id of the optional `resources` peer, resolved via `getEntityIds(false)`. */
export const RESOURCES_RESOURCE_ENTITY_ID = 'resources:resources_resource'

/** The peer feature a caller must hold before Manufacturing may read resources on their behalf. */
export const RESOURCES_VIEW_FEATURE = 'resources.view'

/** Upper bound on membership size, mirrored by the validator and the provider page size. */
export const WORK_CENTER_RESOURCE_LIMIT = 100
