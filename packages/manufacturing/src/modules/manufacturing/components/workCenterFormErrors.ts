import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors"
import {
  WORK_CENTER_ERROR_TRANSLATION_KEYS,
  type WorkCenterErrorCode,
} from "../lib/work-centers/errors"

type Translate = (key: string, fallback?: string) => string

/** Codes that belong to a specific form field rather than the form as a whole. */
const FIELD_BY_CODE: Partial<Record<WorkCenterErrorCode, string>> = {
  work_center_code_conflict: "code",
  work_center_restore_code_conflict: "code",
  resource_not_found: "resourceIds",
  resource_inactive: "resourceIds",
  resource_membership_limit_exceeded: "resourceIds",
}

export function readWorkCenterErrorCode(error: unknown): WorkCenterErrorCode | null {
  if (!error || typeof error !== "object") return null
  const candidate = (error as { code?: unknown; body?: { code?: unknown } })
  const code = typeof candidate.code === "string" ? candidate.code : candidate.body?.code
  if (typeof code !== "string") return null
  return code in WORK_CENTER_ERROR_TRANSLATION_KEYS ? (code as WorkCenterErrorCode) : null
}

/**
 * Turns a stable API error code into a localized CrudForm error, attaching it
 * to the field that caused it where one exists. Anything unrecognised is
 * rethrown untouched so the optimistic-lock conflict body still reaches the
 * shared conflict bar.
 */
export function toWorkCenterFormError(error: unknown, t: Translate): unknown {
  const code = readWorkCenterErrorCode(error)
  if (!code || code === "optimistic_lock_conflict") return error
  const message = t(WORK_CENTER_ERROR_TRANSLATION_KEYS[code], code)
  const field = FIELD_BY_CODE[code]
  return createCrudFormError(message, field ? { [field]: message } : undefined)
}
