/**
 * The auto-apply bar. Kept out of the decision itself so the decision stays a
 * pure function of its inputs and every test states the policy it exercises.
 */

export type TriageConfig = {
  /** Minimum agent confidence an auto-applied triage must clear. */
  confidenceThreshold: number
}

export const CONFIDENCE_THRESHOLD_ENV_KEY = 'OM_SUPPLY_CASES_TRIAGE_CONFIDENCE'

/**
 * Deliberately high: a wrong correlation attaches a supplier's numbers to the
 * wrong case, and the fallback costs one human glance at a list the human was
 * going to see anyway.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8

type EnvSource = Record<string, string | undefined>

/**
 * An unparseable or out-of-range value falls back to the default rather than
 * disabling the bar: a typo in a deployment variable must never widen what is
 * auto-applied.
 */
export function resolveTriageConfig(env: EnvSource = process.env): TriageConfig {
  const raw = env[CONFIDENCE_THRESHOLD_ENV_KEY]
  if (raw === undefined) return { confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD }
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD }
  }
  return { confidenceThreshold: parsed }
}
