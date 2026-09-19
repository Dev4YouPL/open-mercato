import { describe, expect, it } from '@jest/globals'
import { composeSupplyProposal } from '../compose'
import { parseSupplyEnvelope } from '../envelope'
import { resolveSupplyRecipient } from '../recipient'

describe('supplier demo proposal contracts', () => {
  it('keeps the frozen envelope shape and stores no addresses', () => {
    const proposal = composeSupplyProposal({
      messageId: 'MSG-123',
      correlationId: 'SC-SO-441',
      orderNumber: 'SO-441',
      sku: 'MAT-42',
      sender: 'supplier@example.test',
      recipient: 'manufacturer@example.test',
      commitments: [{ quantity: 300, date: '2026-09-23' }],
    })
    expect(proposal.subject).toBe('[SC-SO-441] Delivery update — MAT-42')
    expect(proposal.storedEnvelope).not.toHaveProperty('sender')
    expect(proposal.storedEnvelope).not.toHaveProperty('recipient')
    expect(proposal.envelope).toEqual({
      schemaVersion: 1,
      messageId: 'MSG-123',
      correlationId: 'SC-SO-441',
      messageType: 'SUPPLY_PROPOSAL',
      sender: 'supplier@example.test',
      recipient: 'manufacturer@example.test',
      payload: { sku: 'MAT-42', commitments: [{ quantity: 300, date: '2026-09-23' }] },
    })
    expect(proposal.plain).toContain('---OPEN-MERCATO-SUPPLY-MESSAGE---')
    expect(proposal.html).toContain('<pre>')
  })

  it('requires the snapshot primary email to be allowlisted', () => {
    expect(resolveSupplyRecipient({ customer: { primaryEmail: 'manufacturer@example.test' } }, 'manufacturer@example.test')).toEqual({
      ok: true,
      email: 'manufacturer@example.test',
    })
    expect(resolveSupplyRecipient({ customer: { primaryEmail: 'other@example.test' } }, 'manufacturer@example.test')).toEqual({
      ok: false,
      reason: 'recipient_not_allowlisted',
    })
    expect(resolveSupplyRecipient({ customer: {} }, 'manufacturer@example.test')).toEqual({
      ok: false,
      reason: 'recipient_missing',
    })
  })

  it('carries only the new commitments and never the local replanning details', () => {
    const proposal = composeSupplyProposal({
      messageId: 'MSG-124',
      correlationId: 'SC-SO-441',
      orderNumber: 'SO-441',
      sku: 'MAT-42',
      sender: 'supplier@example.test',
      recipient: 'manufacturer@example.test',
      commitments: [
        { quantity: 400, date: '2026-09-23' },
        { quantity: 100, date: '2026-09-25' },
      ],
    })

    expect(proposal.envelope.payload.commitments).toEqual([
      { quantity: 400, date: '2026-09-23' },
      { quantity: 100, date: '2026-09-25' },
    ])
    expect(proposal.plain).not.toContain('120')
    expect(proposal.plain).not.toContain('SO-442')
    expect(proposal.plain).not.toContain('planSummary')
    expect(proposal.plain).not.toContain('incrementalCost')
  })

  it('requires paired revision metadata and preserves it on a threaded proposal', () => {
    const revision = composeSupplyProposal({
      messageId: 'MSG-125',
      correlationId: 'SC-SO-441',
      orderNumber: 'SO-441',
      sku: 'MAT-42',
      sender: 'supplier@example.test',
      recipient: 'manufacturer@example.test',
      commitments: [{ quantity: 500, date: '2026-09-25' }],
      inReplyToMessageId: 'COUNTER-1',
      negotiationTurn: 1,
    })

    expect(revision.envelope.payload).toMatchObject({ inReplyToMessageId: 'COUNTER-1', negotiationTurn: 1 })
    expect(() => parseSupplyEnvelope({ ...revision.envelope, payload: { ...revision.envelope.payload, negotiationTurn: undefined } })).toThrow()
  })
})
