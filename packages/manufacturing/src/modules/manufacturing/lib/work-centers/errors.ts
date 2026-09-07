import { z } from 'zod'

/**
 * Stable machine-readable Work Centre error codes. `code` is what clients and
 * the OpenAPI error envelope key off; `error` carries the localized message.
 */
export const WORK_CENTER_ERROR_CODES = [
  'work_center_not_found',
  'work_center_code_conflict',
  'work_center_restore_code_conflict',
  'resource_not_found',
  'resource_inactive',
  'resource_membership_limit_exceeded',
  'resource_lookup_forbidden',
  'optional_provider_unavailable',
  'work_center_undo_forbidden',
  'work_center_redo_forbidden',
  'optimistic_lock_conflict',
] as const

export const workCenterErrorCodeSchema = z.enum(WORK_CENTER_ERROR_CODES)
export type WorkCenterErrorCode = (typeof WORK_CENTER_ERROR_CODES)[number]

const STATUS_BY_CODE: Record<WorkCenterErrorCode, number> = {
  work_center_not_found: 404,
  work_center_code_conflict: 409,
  work_center_restore_code_conflict: 409,
  resource_not_found: 404,
  resource_inactive: 422,
  resource_membership_limit_exceeded: 422,
  resource_lookup_forbidden: 403,
  optional_provider_unavailable: 503,
  work_center_undo_forbidden: 403,
  work_center_redo_forbidden: 403,
  optimistic_lock_conflict: 409,
}

/** Translation key backing each code's user-facing message. */
export const WORK_CENTER_ERROR_TRANSLATION_KEYS: Record<WorkCenterErrorCode, string> = {
  work_center_not_found: 'manufacturing.workCenters.errors.workCenterNotFound',
  work_center_code_conflict: 'manufacturing.workCenters.errors.codeConflict',
  work_center_restore_code_conflict: 'manufacturing.workCenters.errors.restoreCodeConflict',
  resource_not_found: 'manufacturing.workCenters.errors.resourceNotFound',
  resource_inactive: 'manufacturing.workCenters.errors.resourceInactive',
  resource_membership_limit_exceeded: 'manufacturing.workCenters.errors.membershipLimitExceeded',
  resource_lookup_forbidden: 'manufacturing.workCenters.errors.resourceLookupForbidden',
  optional_provider_unavailable: 'manufacturing.workCenters.errors.providerUnavailable',
  work_center_undo_forbidden: 'manufacturing.workCenters.errors.undoForbidden',
  work_center_redo_forbidden: 'manufacturing.workCenters.errors.redoForbidden',
  optimistic_lock_conflict: 'manufacturing.workCenters.errors.optimisticLockConflict',
}

/**
 * Domain failure carrying a stable code and its HTTP status. `details` holds
 * scoped technical identifiers only — never a resource name, capacity or any
 * other peer-owned value, because these errors are logged and returned to a
 * caller who may lack `resources.view`.
 */
export class WorkCenterDomainError extends Error {
  readonly code: WorkCenterErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: WorkCenterErrorCode, details?: Record<string, unknown>) {
    super(`[internal] ${code}`)
    this.name = 'WorkCenterDomainError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

export function isWorkCenterDomainError(error: unknown): error is WorkCenterDomainError {
  return error instanceof WorkCenterDomainError
}

export function workCenterErrorStatus(code: WorkCenterErrorCode): number {
  return STATUS_BY_CODE[code]
}
