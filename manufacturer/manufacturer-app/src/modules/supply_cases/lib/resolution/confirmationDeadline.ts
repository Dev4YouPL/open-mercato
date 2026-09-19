import type { SupplyCase } from '../../data/types'

export type ConfirmationDeadlineStatus = 'WITHIN' | 'EXPIRED'

export const CONFIRMATION_WINDOW_ENV_KEY = 'OM_SUPPLY_CASES_CONFIRMATION_WINDOW_MS'

/** Three days, matching the reply-wait timeout already used for the inbound workflow (`P3D`). */
export const DEFAULT_CONFIRMATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

type EnvSource = Record<string, string | undefined>

/**
 * An unparseable or non-positive override falls back to the default rather
 * than disabling the window: a typo in a deployment variable must never make
 * every case time out immediately, nor never at all.
 */
export function resolveConfirmationWindowMs(env: EnvSource = process.env): number {
  const raw = env[CONFIRMATION_WINDOW_ENV_KEY]
  if (raw === undefined) return DEFAULT_CONFIRMATION_WINDOW_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONFIRMATION_WINDOW_MS
  return parsed
}

/**
 * App-owned timeout, because the workflow engine parses `signalConfig.timeout`
 * but never reads it back (no sweeper exists). Counted from `updatedAt` at the
 * moment the case entered `WAITING_FOR_SUPPLIER_CONFIRMATIONS` — the caller is
 * responsible for only invoking this while the case is still in that status,
 * since `updatedAt` advances on every later write.
 */
export function evaluateConfirmationDeadline(
  supplyCase: SupplyCase,
  now: string,
  windowMs: number,
): ConfirmationDeadlineStatus {
  const elapsedMs = Date.parse(now) - Date.parse(supplyCase.updatedAt)
  return elapsedMs >= windowMs ? 'EXPIRED' : 'WITHIN'
}
