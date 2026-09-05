import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  WORK_CENTER_ERROR_TRANSLATION_KEYS,
  isWorkCenterDomainError,
  type WorkCenterErrorCode,
} from './errors'

/**
 * Maps a Work Centre domain failure onto the transport contract the CRUD
 * factory understands: `{ error, code }` with the documented status.
 *
 * An error that is already a `CrudHttpError` passes through untouched — that is
 * how the canonical `optimistic_lock_conflict` body from
 * `enforceCommandOptimisticLockWithGuards` reaches the shared conflict bar with
 * its `currentUpdatedAt`/`expectedUpdatedAt` fields intact.
 */
export async function toWorkCenterHttpError(error: unknown): Promise<unknown> {
  if (isCrudHttpError(error)) return error
  if (!isWorkCenterDomainError(error)) return error
  const message = await localizeWorkCenterErrorCode(error.code)
  return new CrudHttpError(error.status, { error: message, code: error.code }, { cause: error })
}

async function localizeWorkCenterErrorCode(code: WorkCenterErrorCode): Promise<string> {
  const key = WORK_CENTER_ERROR_TRANSLATION_KEYS[code]
  try {
    const { translate } = await resolveTranslations()
    return translate(key, code)
  } catch {
    // Translation resolution is unavailable outside a request (scripts, workers).
    // The stable machine-readable code still travels in `code`.
    return code
  }
}

/**
 * Wraps an async command phase so every Work Centre domain failure leaves the
 * command as a localized HTTP error. Applied once per handler rather than at
 * each throw site, so the domain code stays transport-agnostic.
 */
export function withLocalizedWorkCenterErrors<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args)
    } catch (error) {
      throw await toWorkCenterHttpError(error)
    }
  }
}
