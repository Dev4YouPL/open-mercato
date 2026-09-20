import { describe, expect, it } from '@jest/globals'
import { composeRfqOfferReply } from '../offer-reply'

describe('composeRfqOfferReply', () => {
  it('composes deterministic facts without a supply protocol envelope', () => {
    const reply = composeRfqOfferReply({
      correlationId: 'RFQ-2026-001',
      sku: 'MAT-42',
      quantity: 100,
      deliveryDate: '2026-10-01',
      unitPrice: 12.5,
      currency: 'EUR',
      inReplyToMessageId: '<rfq-1@example.test>',
    })
    expect(reply.subject).toBe('Re: RFQ RFQ-2026-001: MAT-42')
    expect(reply.body).toContain('100 units')
    expect(reply.body).toContain('2026-10-01')
    expect(reply.body).toContain('12.50 EUR')
    expect(reply.body).not.toContain('OPEN-MERCATO-SUPPLY-MESSAGE')
    expect(reply).toMatchObject({ inReplyToMessageId: '<rfq-1@example.test>' })
  })
})
