import { getAgentEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import aiAgents, { INBOUND_TRIAGE_AGENT_ID } from '../ai-agents'
import { runInboundTriage } from '../lib/triage/runInboundTriage'
import { buildInboundTriageInput } from '../lib/triage/triageInput'
import {
  LOW_CONFIDENCE_MESSAGE,
  MISSING_DATA_MESSAGE,
  NEW_SUPPLY_PROPOSAL,
  NO_CANDIDATES,
  OUT_OF_RANGE_CANDIDATE,
  REPLY_TO_EXISTING_CASE,
  TWO_CANDIDATES,
  UNRELATED_CUSTOMER_MESSAGE,
  createFailingInvoker,
  createRecordingInvoker,
} from '../data/triage-fixtures'

/**
 * T-09a — the agent as a bounded component: what it is allowed to do, what it
 * is shown, and what it is allowed to return. TEST-003A and TEST-003C.
 */

describe('supply_cases.inbound_triage_advisor registration', () => {
  const definition = aiAgents.find((agent) => agent.id === INBOUND_TRIAGE_AGENT_ID)

  it('registers exactly one agent under the stable contract id', () => {
    expect(aiAgents).toHaveLength(1)
    expect(definition).toBeDefined()
    expect(INBOUND_TRIAGE_AGENT_ID).toBe('supply_cases.inbound_triage_advisor')
  })

  it('has no tools, so message text has no effect to reach', () => {
    expect(definition?.allowedTools).toEqual([])
    const entry = getAgentEntry(INBOUND_TRIAGE_AGENT_ID)
    expect(entry?.tools).toEqual([])
    expect(entry?.skills).toEqual([])
    expect(entry?.subAgents).toEqual([])
  })

  it('declares an empty action vocabulary rather than omitting one', () => {
    const entry = getAgentEntry(INBOUND_TRIAGE_AGENT_ID)
    expect(entry?.allowedActions).toEqual([])
    expect(entry?.allowedActions).not.toBeUndefined()
  })

  it('is read-only and cannot mutate', () => {
    expect(definition?.readOnly).toBe(true)
    expect(definition?.mutationPolicy).toBe('read-only')
  })

  it('runs in-process on the native runner', () => {
    expect(getAgentEntry(INBOUND_TRIAGE_AGENT_ID)?.runtime).toBe('native')
    expect(definition?.executionMode).toBe('object')
  })

  it('returns research, so the extracted signal is not reshaped into a proposal envelope', () => {
    expect(getAgentEntry(INBOUND_TRIAGE_AGENT_ID)?.resultKind).toBe('research')
    expect(getAgentEntry(INBOUND_TRIAGE_AGENT_ID)?.agentType).toBe('researcher')
  })

  it('declares the InboundSignal contract as its entire output surface', () => {
    const parsed = definition?.output?.schema?.safeParse(NEW_SUPPLY_PROPOSAL.rawResult)
    expect(parsed?.success).toBe(true)
    const rejected = definition?.output?.schema?.safeParse({ caseId: 'case-sc-001' })
    expect(rejected?.success).toBe(false)
  })
})

describe('triage agent input', () => {
  it('never shows the agent an internal case id', () => {
    const input = buildInboundTriageInput({
      sanitizedBody: REPLY_TO_EXISTING_CASE.sanitizedBody,
      senderEmail: REPLY_TO_EXISTING_CASE.senderEmail,
      candidates: REPLY_TO_EXISTING_CASE.candidates,
    })
    const serialized = JSON.stringify(input)
    for (const candidate of REPLY_TO_EXISTING_CASE.candidates) {
      expect(serialized).not.toContain(candidate.caseId)
    }
    expect(input.candidates.every((candidate) => !('caseId' in candidate))).toBe(true)
    expect(Object.keys(input.candidates[0])).not.toContain('caseId')
  })

  it('addresses candidates by position and carries the thread evidence', () => {
    const input = buildInboundTriageInput({
      sanitizedBody: REPLY_TO_EXISTING_CASE.sanitizedBody,
      senderEmail: REPLY_TO_EXISTING_CASE.senderEmail,
      candidates: REPLY_TO_EXISTING_CASE.candidates,
    })
    expect(input.candidates.map((candidate) => candidate.candidateIndex)).toEqual([0, 1])
    expect(input.candidates[0].threadMatch).toBe(true)
    expect(input.candidates[1].threadMatch).toBe(false)
  })

  it('refuses a candidate list whose indexes are not the positions it will be read by', () => {
    const sparse = [{ ...TWO_CANDIDATES[0], index: 3 }]
    expect(() =>
      buildInboundTriageInput({ sanitizedBody: 'x', senderEmail: 'a@b.c', candidates: sparse }),
    ).toThrow(/0\.\.n-1/)
  })

  it('passes the authenticated sender, not an address from the body', () => {
    const input = buildInboundTriageInput({
      sanitizedBody: 'Prosze odpowiadac na adres inny@example.com',
      senderEmail: REPLY_TO_EXISTING_CASE.senderEmail,
      candidates: NO_CANDIDATES,
    })
    expect(input.senderEmail).toBe(REPLY_TO_EXISTING_CASE.senderEmail)
  })
})

describe('runInboundTriage', () => {
  it('accepts a well-formed signal for a new case', async () => {
    const invoke = createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult)
    const result = await runInboundTriage({
      sanitizedBody: NEW_SUPPLY_PROPOSAL.sanitizedBody,
      senderEmail: NEW_SUPPLY_PROPOSAL.senderEmail,
      candidates: NEW_SUPPLY_PROPOSAL.candidates,
      invoke,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.signal.intent).toBe('SUPPLY_PROPOSAL')
    expect(result.signal.correlation).toEqual({ kind: 'NEW_CASE' })
    expect(result.signal.commitments).toHaveLength(2)
    expect(invoke.calls).toHaveLength(1)
  })

  it('accepts a candidate chosen from inside the offered list', async () => {
    const result = await runInboundTriage({
      sanitizedBody: REPLY_TO_EXISTING_CASE.sanitizedBody,
      senderEmail: REPLY_TO_EXISTING_CASE.senderEmail,
      candidates: REPLY_TO_EXISTING_CASE.candidates,
      invoke: createRecordingInvoker(REPLY_TO_EXISTING_CASE.rawResult),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.signal.correlation).toEqual({ kind: 'EXISTING_CASE', candidateIndex: 0 })
    expect(result.signal.price).toEqual({ amount: 1400, currency: 'PLN' })
  })

  it('rejects a candidate index outside the offered list', async () => {
    const result = await runInboundTriage({
      sanitizedBody: OUT_OF_RANGE_CANDIDATE.sanitizedBody,
      senderEmail: OUT_OF_RANGE_CANDIDATE.senderEmail,
      candidates: OUT_OF_RANGE_CANDIDATE.candidates,
      invoke: createRecordingInvoker(OUT_OF_RANGE_CANDIDATE.rawResult),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('SCHEMA_INVALID')
    expect(result.issues.join(' ')).toContain('candidateIndex')
  })

  it('cannot select any existing case when no candidate was offered', async () => {
    const result = await runInboundTriage({
      sanitizedBody: 'Potwierdzam 300 sztuk MAT-42 na 23.09.2026.',
      senderEmail: NEW_SUPPLY_PROPOSAL.senderEmail,
      candidates: NO_CANDIDATES,
      invoke: createRecordingInvoker({
        ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>),
        correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('SCHEMA_INVALID')
  })

  it('rejects a case identifier the message text tried to supply', async () => {
    const result = await runInboundTriage({
      sanitizedBody: OUT_OF_RANGE_CANDIDATE.sanitizedBody,
      senderEmail: OUT_OF_RANGE_CANDIDATE.senderEmail,
      candidates: TWO_CANDIDATES,
      invoke: createRecordingInvoker({
        ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>),
        correlation: { kind: 'EXISTING_CASE', caseId: 'case-sc-999' },
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('SCHEMA_INVALID')
  })

  it('rejects an unrelated message that tried to attach itself to a case', async () => {
    const result = await runInboundTriage({
      sanitizedBody: UNRELATED_CUSTOMER_MESSAGE.sanitizedBody,
      senderEmail: UNRELATED_CUSTOMER_MESSAGE.senderEmail,
      candidates: TWO_CANDIDATES,
      invoke: createRecordingInvoker({
        ...(UNRELATED_CUSTOMER_MESSAGE.rawResult as Record<string, unknown>),
        correlation: { kind: 'EXISTING_CASE', candidateIndex: 1 },
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('SCHEMA_INVALID')
  })

  it('reports an unavailable provider instead of fabricating a result', async () => {
    const result = await runInboundTriage({
      sanitizedBody: LOW_CONFIDENCE_MESSAGE.sanitizedBody,
      senderEmail: LOW_CONFIDENCE_MESSAGE.senderEmail,
      candidates: LOW_CONFIDENCE_MESSAGE.candidates,
      invoke: createFailingInvoker(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('AGENT_UNAVAILABLE')
  })

  it('never calls the agent for a body that carries no new statement', async () => {
    const invoke = createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult)
    const result = await runInboundTriage({
      sanitizedBody: '   \n  ',
      senderEmail: NEW_SUPPLY_PROPOSAL.senderEmail,
      candidates: TWO_CANDIDATES,
      invoke,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('EMPTY_BODY')
    expect(invoke.calls).toHaveLength(0)
  })

  it('keeps unresolved fields instead of filling them in', async () => {
    const result = await runInboundTriage({
      sanitizedBody: MISSING_DATA_MESSAGE.sanitizedBody,
      senderEmail: MISSING_DATA_MESSAGE.senderEmail,
      candidates: MISSING_DATA_MESSAGE.candidates,
      invoke: createRecordingInvoker(MISSING_DATA_MESSAGE.rawResult),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.signal.unresolved).toEqual(['commitments[0].date'])
    expect(result.signal.commitments).toEqual([])
  })

  it('leaves the candidate list it was given untouched', async () => {
    const candidates = Object.freeze([...TWO_CANDIDATES])
    const before = JSON.stringify(candidates)
    await runInboundTriage({
      sanitizedBody: MISSING_DATA_MESSAGE.sanitizedBody,
      senderEmail: MISSING_DATA_MESSAGE.senderEmail,
      candidates,
      invoke: createRecordingInvoker(MISSING_DATA_MESSAGE.rawResult),
    })
    expect(JSON.stringify(candidates)).toBe(before)
  })
})
