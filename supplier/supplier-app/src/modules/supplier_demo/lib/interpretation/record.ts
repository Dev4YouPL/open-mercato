import type { ReplyIntent } from './reply-intent'

export type InterpretationOutcome =
  | 'pending'
  | 'blocked'
  | 'failed'
  | 'display_only'
  | 'flagged'
  | 'ungrounded'
  | 'low_confidence'
  | 'counter_created'
  | 'superseded'
  | 'cap_reached'

export type InterpretationUsage = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  known: boolean
  partial: boolean
}

export type InterpretationAttempt = {
  attemptNo: number
  runId: string
  startedAt: string
  leaseExpiresAt: string
  finishedAt: string | null
  latencyMs: number | null
  configuredProvider: string
  configuredModel: string
  effectiveProvider: string | null
  effectiveModel: string | null
  promptVersion: string
  systemPromptHash: string | null
  inputHash: string
  modelInput: Record<string, unknown> | null
  usage: InterpretationUsage
  providerRequestCount: number
  outcome: null | 'ok' | 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_output' | 'refusal' | 'missing_config' | 'principal_missing' | 'cancelled'
  errorCode: string | null
  output: ReplyIntent | null
  auditState: 'claimed' | 'prepared' | 'complete' | 'incomplete'
}

export type InterpretationRecord = {
  version: 1
  eligibility: { eligible: boolean; reason: string }
  sanitizer: {
    version: 's1'
    inputChars: number
    outputChars: number
    prescan: { hit: boolean; rules: string[] }
  }
  attempts: InterpretationAttempt[]
  intent: ReplyIntent | null
  checks: {
    schema: 'pass' | 'fail'
    consistency: string
    grounding: string
    confidenceOk: boolean
  }
  resolution: {
    today: string
    tranches: Array<{
      quantity: number
      date: string
      source: 'explicit' | 'remainder'
      expression: string
      placement: 'exact' | 'window_earliest' | 'asap' | 'unplaceable'
    }>
  } | null
  outcome: InterpretationOutcome
  derivedCounterMessageId: string | null
}

export function createInterpretationRecord(input: {
  eligible: boolean
  reason: string
  inputChars?: number
  outputChars?: number
  prescanHit?: boolean
  prescanRules?: string[]
}): InterpretationRecord {
  return {
    version: 1,
    eligibility: { eligible: input.eligible, reason: input.reason },
    sanitizer: {
      version: 's1',
      inputChars: input.inputChars ?? 0,
      outputChars: input.outputChars ?? 0,
      prescan: { hit: input.prescanHit ?? false, rules: input.prescanRules ?? [] },
    },
    attempts: [],
    intent: null,
    checks: { schema: 'fail', consistency: 'not_run', grounding: 'not_run', confidenceOk: false },
    resolution: null,
    outcome: 'pending',
    derivedCounterMessageId: null,
  }
}

export function parseInterpretationRecord(value: unknown): InterpretationRecord {
  if (!value || typeof value !== 'object') return createInterpretationRecord({ eligible: false, reason: 'missing_record' })
  const candidate = value as Partial<InterpretationRecord>
  const base = createInterpretationRecord({ eligible: true, reason: 'recorded' })
  return {
    ...base,
    ...candidate,
    eligibility: candidate.eligibility ?? base.eligibility,
    sanitizer: candidate.sanitizer ?? base.sanitizer,
    attempts: Array.isArray(candidate.attempts) ? candidate.attempts : [],
    checks: candidate.checks ?? base.checks,
    resolution: candidate.resolution ?? null,
    outcome: candidate.outcome ?? 'pending',
    derivedCounterMessageId: candidate.derivedCounterMessageId ?? null,
  }
}
