import type { OutboundCorrelation } from '../data/types'
import { buildOutboundIdempotencyKey } from '../lib/outbound/correlationKey'
import { resolveThreadEvidence, selectResumableMatch } from '../lib/inbound/resolveThread'

const SUPPLIER_2 = 'supplier2@hackon-om-wro.cloud'
const CASE_ID = 'case-1'

function correlation(overrides: Partial<OutboundCorrelation> = {}): OutboundCorrelation {
  const phase = overrides.phase ?? 'ALTERNATIVE_SUPPLY_REQUEST'
  const recipientEmail = overrides.recipientEmail ?? SUPPLIER_2
  const caseId = overrides.caseId ?? CASE_ID
  return {
    id: 'correlation-1',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    caseId,
    phase,
    recipientEmail,
    rfcMessageId: 'request-1@manufacturer.example',
    idempotencyKey: buildOutboundIdempotencyKey(caseId, phase, recipientEmail),
    createdAt: '2026-09-14T10:00:00.000Z',
    ...overrides,
  }
}

describe('resolveThreadEvidence (TEST-004B)', () => {
  it('matches a reply against the request we actually sent', () => {
    const evidence = resolveThreadEvidence({
      inReplyTo: 'request-1@manufacturer.example',
      references: [],
      correlations: [correlation()],
    })

    expect(evidence.matches).toEqual([
      {
        caseId: CASE_ID,
        phase: 'ALTERNATIVE_SUPPLY_REQUEST',
        recipientEmail: SUPPLIER_2,
        rfcMessageId: 'request-1@manufacturer.example',
        source: 'IN_REPLY_TO',
        superseded: false,
      },
    ])
    expect(selectResumableMatch(evidence)?.caseId).toBe(CASE_ID)
  })

  it('records a reply chain we never issued as unmatched instead of correlating it', () => {
    const evidence = resolveThreadEvidence({
      inReplyTo: 'forged-1@attacker.example',
      references: ['forged-0@attacker.example'],
      correlations: [correlation()],
    })

    expect(evidence.matches).toEqual([])
    // In-Reply-To is scanned before the ancestry, so it is reported first.
    expect(evidence.unmatchedReferences).toEqual(['forged-1@attacker.example', 'forged-0@attacker.example'])
    expect(selectResumableMatch(evidence)).toBeNull()
  })

  it('rejects a stale offer for resumption once we have moved the case on', () => {
    const request = correlation({ id: 'correlation-request', createdAt: '2026-09-14T10:00:00.000Z' })
    const acceptance = correlation({
      id: 'correlation-acceptance',
      phase: 'SUPPLY_ACCEPTANCE',
      rfcMessageId: 'acceptance-1@manufacturer.example',
      createdAt: '2026-09-15T10:00:00.000Z',
    })

    const evidence = resolveThreadEvidence({
      inReplyTo: 'request-1@manufacturer.example',
      references: [],
      correlations: [request, acceptance],
    })

    expect(evidence.matches[0]).toMatchObject({ rfcMessageId: 'request-1@manufacturer.example', superseded: true })
    // The evidence survives for the agent and the audit trail; what it loses is
    // the right to resume the wait the newer message is holding.
    expect(selectResumableMatch(evidence)).toBeNull()
  })

  it('keeps a reply to the newest message in the lane resumable', () => {
    const request = correlation({ id: 'correlation-request', createdAt: '2026-09-14T10:00:00.000Z' })
    const acceptance = correlation({
      id: 'correlation-acceptance',
      phase: 'SUPPLY_ACCEPTANCE',
      rfcMessageId: 'acceptance-1@manufacturer.example',
      createdAt: '2026-09-15T10:00:00.000Z',
    })

    const evidence = resolveThreadEvidence({
      inReplyTo: 'acceptance-1@manufacturer.example',
      references: ['request-1@manufacturer.example'],
      correlations: [request, acceptance],
    })

    expect(selectResumableMatch(evidence)?.rfcMessageId).toBe('acceptance-1@manufacturer.example')
  })

  it('does not treat a different supplier or a different case as the same lane', () => {
    const toSupplier2 = correlation({ id: 'correlation-s2', createdAt: '2026-09-14T10:00:00.000Z' })
    const toSupplier1 = correlation({
      id: 'correlation-s1',
      phase: 'SUPPLY_ACCEPTANCE',
      recipientEmail: 'supplier@hackon-om-wro.cloud',
      rfcMessageId: 'acceptance-s1@manufacturer.example',
      createdAt: '2026-09-15T10:00:00.000Z',
    })
    const otherCase = correlation({
      id: 'correlation-other-case',
      caseId: 'case-2',
      phase: 'SUPPLY_ACCEPTANCE',
      rfcMessageId: 'acceptance-other@manufacturer.example',
      createdAt: '2026-09-16T10:00:00.000Z',
    })

    const evidence = resolveThreadEvidence({
      inReplyTo: 'request-1@manufacturer.example',
      references: [],
      correlations: [toSupplier2, toSupplier1, otherCase],
    })

    expect(evidence.matches[0].superseded).toBe(false)
  })

  it('treats the recipient lane case-insensitively', () => {
    const request = correlation({ id: 'correlation-request', createdAt: '2026-09-14T10:00:00.000Z' })
    const acceptance = correlation({
      id: 'correlation-acceptance',
      phase: 'SUPPLY_ACCEPTANCE',
      recipientEmail: 'Supplier2@Hackon-OM-Wro.Cloud',
      rfcMessageId: 'acceptance-1@manufacturer.example',
      createdAt: '2026-09-15T10:00:00.000Z',
    })

    const evidence = resolveThreadEvidence({
      inReplyTo: 'request-1@manufacturer.example',
      references: [],
      correlations: [request, acceptance],
    })

    expect(evidence.matches[0].superseded).toBe(true)
  })

  it('prefers In-Reply-To over References and reports each anchor once', () => {
    const request = correlation({ id: 'correlation-request', createdAt: '2026-09-14T10:00:00.000Z' })

    const evidence = resolveThreadEvidence({
      inReplyTo: 'request-1@manufacturer.example',
      references: ['request-1@manufacturer.example'],
      correlations: [request],
    })

    expect(evidence.matches).toHaveLength(1)
    expect(evidence.matches[0].source).toBe('IN_REPLY_TO')
  })

  it('reads the References chain newest ancestor first', () => {
    const older = correlation({ id: 'correlation-older', createdAt: '2026-09-10T10:00:00.000Z' })
    const newer = correlation({
      id: 'correlation-newer',
      caseId: 'case-2',
      rfcMessageId: 'request-2@manufacturer.example',
      createdAt: '2026-09-16T10:00:00.000Z',
    })

    const evidence = resolveThreadEvidence({
      inReplyTo: null,
      references: ['request-1@manufacturer.example', 'request-2@manufacturer.example'],
      correlations: [older, newer],
    })

    expect(evidence.matches.map((match) => match.caseId)).toEqual(['case-2', CASE_ID])
    expect(evidence.matches.every((match) => match.source === 'REFERENCES')).toBe(true)
  })

  it('resolves nothing when the message carries no threading headers', () => {
    const evidence = resolveThreadEvidence({ inReplyTo: null, references: [], correlations: [correlation()] })

    expect(evidence).toEqual({ matches: [], unmatchedReferences: [] })
  })
})

describe('buildOutboundIdempotencyKey', () => {
  it('is stable across retries and normalizes the recipient', () => {
    const first = buildOutboundIdempotencyKey(CASE_ID, 'ALTERNATIVE_SUPPLY_REQUEST', 'Supplier2@Hackon-OM-Wro.Cloud')
    const retry = buildOutboundIdempotencyKey(CASE_ID, 'ALTERNATIVE_SUPPLY_REQUEST', SUPPLIER_2)

    expect(first).toBe(retry)
  })

  it('separates phases and recipients', () => {
    const request = buildOutboundIdempotencyKey(CASE_ID, 'ALTERNATIVE_SUPPLY_REQUEST', SUPPLIER_2)
    const acceptance = buildOutboundIdempotencyKey(CASE_ID, 'SUPPLY_ACCEPTANCE', SUPPLIER_2)
    const otherRecipient = buildOutboundIdempotencyKey(CASE_ID, 'SUPPLY_ACCEPTANCE', 'supplier@hackon-om-wro.cloud')

    expect(new Set([request, acceptance, otherRecipient]).size).toBe(3)
  })

  it('refuses a recipient it cannot normalize rather than keying on garbage', () => {
    expect(() => buildOutboundIdempotencyKey(CASE_ID, 'SUPPLY_ACCEPTANCE', 'not-an-address')).toThrow()
  })
})
