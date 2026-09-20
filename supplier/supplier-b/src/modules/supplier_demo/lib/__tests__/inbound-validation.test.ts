import { describe, expect, it } from '@jest/globals'
import { extractSupplyBlocks, parseInboundSupplyText } from '../envelope-parse'
import { renderSupplyEnvelope, type SupplyEnvelope } from '../envelope'
import { validateInboundEnvelope } from '../inbound-validation'

const caseRecord = { status: 'proposal_delivered', correlationId: 'SC-SO-441', sku: 'MAT-42' } as const

function acceptance(messageId: string, inReplyToMessageId = 'PROPOSAL-1'): SupplyEnvelope {
  return {
    schemaVersion: 1,
    messageId,
    correlationId: caseRecord.correlationId,
    messageType: 'SUPPLY_ACCEPTANCE',
    sender: 'manufacturer@example.test',
    recipient: 'supplier@example.test',
    payload: {
      sku: caseRecord.sku,
      inReplyToMessageId,
      acceptedCommitments: [{ quantity: 300, date: '2026-09-23' }],
      cancelledCommitments: [],
    },
  }
}

function validate(envelope: SupplyEnvelope, overrides: Partial<Parameters<typeof validateInboundEnvelope>[0]> = {}) {
  return validateInboundEnvelope({
    envelope,
    blockCount: 1,
    transportSender: 'manufacturer@example.test',
    senderAllowlisted: true,
    casePartner: 'manufacturer@example.test',
    caseRecord,
    latestProposalId: 'PROPOSAL-1',
    ...overrides,
  })
}

describe('supplier inbound reply validation', () => {
  it('normalizes quoted HTML and extracts exactly one valid envelope', () => {
    const envelope = acceptance('ACCEPT-1')
    const parsed = parseInboundSupplyText(`<p>&gt; Manufacturer reply</p><pre>${renderSupplyEnvelope(envelope)}</pre>`, 'html')

    expect(parsed.humanText).toContain('Manufacturer reply')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.envelope).toEqual(envelope)
  })

  it('classifies the safety matrix without mutating the case', () => {
    expect(validate(acceptance('ACCEPT-1')).status).toBe('valid')
    expect(validate(acceptance('ACCEPT-1'), { validBusinessMessageIds: new Set(['ACCEPT-1']) }).status).toBe('duplicate')
    expect(validate(acceptance('ACCEPT-2'), { caseRecord: { ...caseRecord, correlationId: 'SC-OTHER' } }).status).toBe('correlation_mismatch')
    expect(validate({ ...acceptance('COUNTER-1'), messageType: 'SUPPLY_COUNTER_PROPOSAL', payload: { sku: caseRecord.sku, inReplyToMessageId: 'PROPOSAL-1', requestedCommitments: [{ quantity: 250, date: '2026-09-23' }] } }).status).toBe('valid')
    expect(validate({ ...acceptance('REJECT-1'), messageType: 'SUPPLY_REJECTION', payload: { sku: caseRecord.sku, inReplyToMessageId: 'PROPOSAL-1', reason: 'No capacity' } }).status).toBe('valid')
    expect(validate(acceptance('STALE-1', 'PROPOSAL-OLD')).status).toBe('stale_reference')
    expect(validate(acceptance('SPOOF-1'), { transportSender: 'spoof@example.test' }).status).toBe('sender_not_case_partner')
    expect(validate(acceptance('CLOSED-1'), { caseRecord: { ...caseRecord, status: 'resolved' } }).status).toBe('case_closed')
  })

  it('treats a non-allowlisted sender as untrusted and never notifies about it', () => {
    const untrusted = validate(acceptance('SPOOF-2'), { senderAllowlisted: false })
    expect(untrusted).toMatchObject({ status: 'untrusted_sender', notify: false })
    expect(validate(acceptance('SPOOF-3'), { senderAllowlisted: undefined }).status).toBe('untrusted_sender')
    expect(validate(acceptance('NO-PARTNER'), { casePartner: null }).status).toBe('sender_not_case_partner')
  })

  it('does not notify for duplicates or replies to a case that is not waiting', () => {
    expect(validate(acceptance('ACCEPT-1'), { validBusinessMessageIds: new Set(['ACCEPT-1']) }).notify).toBe(false)
    expect(validate(acceptance('LATE-1'), { caseRecord: { ...caseRecord, status: 'needs_human' } })).toMatchObject({ status: 'case_not_awaiting_reply', notify: false })
  })

  it('records malformed and ambiguous blocks as non-valid input', () => {
    expect(parseInboundSupplyText('hello').blocks).toHaveLength(0)
    expect(parseInboundSupplyText('---OPEN-MERCATO-SUPPLY-MESSAGE---{bad---END-OPEN-MERCATO-SUPPLY-MESSAGE---').blocks[0]?.schemaError).toBe('invalid_json')
    const text = `${renderSupplyEnvelope(acceptance('A'))}\n${renderSupplyEnvelope(acceptance('B'))}`
    const parsed = parseInboundSupplyText(text)
    expect(extractSupplyBlocks(parsed.normalizedText)).toHaveLength(2)
    expect(validate(acceptance('AMB-1'), { blockCount: 2 }).status).toBe('ambiguous_envelope')
  })
})
