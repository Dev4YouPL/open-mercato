import { decideTriage } from '../lib/triage/applyTriage'
import { runInboundTriage, type InboundTriageResult } from '../lib/triage/runInboundTriage'
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  CONFIDENCE_THRESHOLD_ENV_KEY,
  resolveTriageConfig,
} from '../lib/triage/triageConfig'
import type { InboundCandidate } from '../lib/inbound/candidateList'
import type { InboundSignal } from '../data/inbound-signal'
import {
  LOW_CONFIDENCE_MESSAGE,
  MISSING_DATA_MESSAGE,
  NEW_SUPPLY_PROPOSAL,
  OUT_OF_RANGE_CANDIDATE,
  REPLY_TO_EXISTING_CASE,
  THREAD_CONTRADICTION,
  TWO_CANDIDATES,
  UNRELATED_CUSTOMER_MESSAGE,
  createFailingInvoker,
  createRecordingInvoker,
  type TriageFixture,
} from '../data/triage-fixtures'

/**
 * T-09b — the deterministic bar. TEST-003B and TEST-003D.
 *
 * Every case here goes through the real run wrapper first, so the decision is
 * taken on a signal that passed the same per-run contract production uses.
 */

async function triage(fixture: TriageFixture, raw: unknown = fixture.rawResult): Promise<InboundTriageResult> {
  return runInboundTriage({
    sanitizedBody: fixture.sanitizedBody,
    senderEmail: fixture.senderEmail,
    candidates: fixture.candidates,
    invoke: createRecordingInvoker(raw),
  })
}

describe('decideTriage auto-apply', () => {
  it('auto-applies a confident, complete new-case signal', async () => {
    const decision = decideTriage({
      result: await triage(NEW_SUPPLY_PROPOSAL),
      candidates: NEW_SUPPLY_PROPOSAL.candidates,
    })
    expect(decision.outcome).toBe('AUTO_APPLY')
    if (decision.outcome !== 'AUTO_APPLY') return
    expect(decision.disposition).toBe('AUTO_APPLIED')
    expect(decision.target).toEqual({ kind: 'NEW_CASE' })
  })

  it('resolves an auto-applied candidate to the case id the code held', async () => {
    const decision = decideTriage({
      result: await triage(REPLY_TO_EXISTING_CASE),
      candidates: REPLY_TO_EXISTING_CASE.candidates,
    })
    expect(decision.outcome).toBe('AUTO_APPLY')
    if (decision.outcome !== 'AUTO_APPLY') return
    expect(decision.target).toEqual({
      kind: 'EXISTING_CASE',
      candidateIndex: 0,
      caseId: REPLY_TO_EXISTING_CASE.candidates[0].caseId,
      correlationId: 'SC-001',
    })
  })

  it('auto-applies only at or above the threshold', async () => {
    const result = await triage(REPLY_TO_EXISTING_CASE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const atThreshold: InboundTriageResult = {
      ...result,
      signal: { ...result.signal, confidence: DEFAULT_CONFIDENCE_THRESHOLD } as InboundSignal,
    }
    const belowThreshold: InboundTriageResult = {
      ...result,
      signal: { ...result.signal, confidence: DEFAULT_CONFIDENCE_THRESHOLD - 0.01 } as InboundSignal,
    }
    expect(decideTriage({ result: atThreshold, candidates: REPLY_TO_EXISTING_CASE.candidates }).outcome).toBe(
      'AUTO_APPLY',
    )
    expect(decideTriage({ result: belowThreshold, candidates: REPLY_TO_EXISTING_CASE.candidates }).outcome).toBe(
      'NEEDS_ATTENTION',
    )
  })
})

describe('decideTriage needs attention', () => {
  it('sends a low-confidence signal to a human', async () => {
    const decision = decideTriage({
      result: await triage(LOW_CONFIDENCE_MESSAGE),
      candidates: LOW_CONFIDENCE_MESSAGE.candidates,
    })
    expect(decision.outcome).toBe('NEEDS_ATTENTION')
    if (decision.outcome !== 'NEEDS_ATTENTION') return
    expect(decision.reason).toBe('LOW_CONFIDENCE')
    expect(decision.disposition).toBeNull()
  })

  it('sends an incomplete extraction to a human and offers the same list', async () => {
    const decision = decideTriage({
      result: await triage(MISSING_DATA_MESSAGE),
      candidates: MISSING_DATA_MESSAGE.candidates,
    })
    expect(decision.outcome).toBe('NEEDS_ATTENTION')
    if (decision.outcome !== 'NEEDS_ATTENTION') return
    expect(decision.reason).toBe('UNRESOLVED_FIELDS')
    expect(decision.candidateIndexes).toEqual([0, 1])
    expect(decision.signal.unresolved).toEqual(['commitments[0].date'])
  })

  it('holds a confident signal that contradicts the resolved thread', async () => {
    const decision = decideTriage({
      result: await triage(THREAD_CONTRADICTION),
      candidates: THREAD_CONTRADICTION.candidates,
    })
    expect(decision.outcome).toBe('NEEDS_ATTENTION')
    if (decision.outcome !== 'NEEDS_ATTENTION') return
    expect(decision.reason).toBe('THREAD_CONTRADICTION')
  })

  it('treats a NEW_CASE answer on a matched thread as a contradiction', async () => {
    const candidates: readonly InboundCandidate[] = [{ ...TWO_CANDIDATES[0], threadMatch: true }]
    const fixture: TriageFixture = { ...NEW_SUPPLY_PROPOSAL, candidates }
    const decision = decideTriage({ result: await triage(fixture), candidates })
    expect(decision.outcome).toBe('NEEDS_ATTENTION')
    if (decision.outcome !== 'NEEDS_ATTENTION') return
    expect(decision.reason).toBe('THREAD_CONTRADICTION')
  })

  it('auto-applies a NEW_CASE answer when no thread matched', async () => {
    const decision = decideTriage({
      result: await triage({ ...NEW_SUPPLY_PROPOSAL, candidates: TWO_CANDIDATES }),
      candidates: TWO_CANDIDATES,
    })
    expect(decision.outcome).toBe('AUTO_APPLY')
  })
})

describe('decideTriage quarantine', () => {
  it('quarantines a candidate index outside the offered list', async () => {
    const decision = decideTriage({
      result: await triage(OUT_OF_RANGE_CANDIDATE),
      candidates: OUT_OF_RANGE_CANDIDATE.candidates,
    })
    expect(decision.outcome).toBe('QUARANTINE')
    if (decision.outcome !== 'QUARANTINE') return
    expect(decision.reason).toBe('SCHEMA_INVALID')
    expect(decision.disposition).toBe('QUARANTINED')
    expect(decision.needsAttention).toBe(true)
  })

  it('quarantines an out-of-range index that reached the apply step directly', () => {
    const decision = decideTriage({
      result: {
        ok: true,
        signal: {
          ...(OUT_OF_RANGE_CANDIDATE.rawResult as InboundSignal),
        },
        input: { sanitizedBody: 'x', senderEmail: OUT_OF_RANGE_CANDIDATE.senderEmail, candidates: [] },
      },
      candidates: TWO_CANDIDATES,
    })
    expect(decision.outcome).toBe('QUARANTINE')
    if (decision.outcome !== 'QUARANTINE') return
    expect(decision.reason).toBe('INVALID_CANDIDATE_INDEX')
  })

  it('quarantines an unrelated message without touching any case', async () => {
    const decision = decideTriage({
      result: await triage(UNRELATED_CUSTOMER_MESSAGE),
      candidates: UNRELATED_CUSTOMER_MESSAGE.candidates,
    })
    expect(decision.outcome).toBe('QUARANTINE')
    if (decision.outcome !== 'QUARANTINE') return
    expect(decision.reason).toBe('UNRELATED')
    expect(decision.needsAttention).toBe(false)
    expect(decision).not.toHaveProperty('target')
  })

  it('quarantines and raises attention when the provider is unavailable', async () => {
    const result = await runInboundTriage({
      sanitizedBody: LOW_CONFIDENCE_MESSAGE.sanitizedBody,
      senderEmail: LOW_CONFIDENCE_MESSAGE.senderEmail,
      candidates: LOW_CONFIDENCE_MESSAGE.candidates,
      invoke: createFailingInvoker(),
    })
    const decision = decideTriage({ result, candidates: LOW_CONFIDENCE_MESSAGE.candidates })
    expect(decision.outcome).toBe('QUARANTINE')
    if (decision.outcome !== 'QUARANTINE') return
    expect(decision.reason).toBe('AGENT_UNAVAILABLE')
    expect(decision.needsAttention).toBe(true)
  })

  it('quarantines a quote-only body without raising attention', async () => {
    const result = await runInboundTriage({
      sanitizedBody: '',
      senderEmail: LOW_CONFIDENCE_MESSAGE.senderEmail,
      candidates: TWO_CANDIDATES,
      invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult),
    })
    const decision = decideTriage({ result, candidates: TWO_CANDIDATES })
    expect(decision.outcome).toBe('QUARANTINE')
    if (decision.outcome !== 'QUARANTINE') return
    expect(decision.reason).toBe('EMPTY_BODY')
    expect(decision.needsAttention).toBe(false)
  })
})

describe('decideTriage is a pure decision', () => {
  it('mutates neither the candidate list nor the signal', async () => {
    const candidates = TWO_CANDIDATES.map((candidate) => ({ ...candidate }))
    const snapshot = JSON.stringify(candidates)
    const result = await triage({ ...MISSING_DATA_MESSAGE, candidates })
    const signalSnapshot = result.ok ? JSON.stringify(result.signal) : null
    decideTriage({ result, candidates })
    expect(JSON.stringify(candidates)).toBe(snapshot)
    expect(result.ok ? JSON.stringify(result.signal) : null).toBe(signalSnapshot)
  })

  it('returns the same decision for the same inputs', async () => {
    const result = await triage(REPLY_TO_EXISTING_CASE)
    const first = decideTriage({ result, candidates: REPLY_TO_EXISTING_CASE.candidates })
    const second = decideTriage({ result, candidates: REPLY_TO_EXISTING_CASE.candidates })
    expect(second).toEqual(first)
  })
})

describe('resolveTriageConfig', () => {
  it('defaults when the deployment states no policy', () => {
    expect(resolveTriageConfig({})).toEqual({ confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD })
  })

  it('honours a configured threshold', () => {
    expect(resolveTriageConfig({ [CONFIDENCE_THRESHOLD_ENV_KEY]: '0.95' })).toEqual({ confidenceThreshold: 0.95 })
  })

  it('never widens the bar on an unusable value', () => {
    for (const raw of ['', 'nope', '-1', '2']) {
      expect(resolveTriageConfig({ [CONFIDENCE_THRESHOLD_ENV_KEY]: raw })).toEqual({
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      })
    }
  })
})
