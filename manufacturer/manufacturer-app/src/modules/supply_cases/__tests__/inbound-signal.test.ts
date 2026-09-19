import {
  createInboundSignalSchema,
  inboundSignalSchema,
  type InboundSignal,
} from '../data/inbound-signal'

function buildSignal(overrides: Partial<InboundSignal> = {}): Record<string, unknown> {
  return {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'NEW_CASE', candidateIndex: null },
    sku: 'MAT-42',
    commitments: [
      { quantity: 300, date: '2026-09-23' },
      { quantity: 200, date: '2026-09-25' },
    ],
    price: null,
    confidence: 0.86,
    unresolved: [],
    rationale: 'Supplier states Wednesday delivery drops to 300.',
    ...overrides,
  }
}

describe('inboundSignalSchema', () => {
  it('accepts a well-formed extraction', () => {
    const parsed = inboundSignalSchema.parse(buildSignal())
    expect(parsed.intent).toBe('SUPPLY_PROPOSAL')
    expect(parsed.commitments).toHaveLength(2)
  })

  it('rejects unknown keys so the model cannot smuggle fields past the contract', () => {
    expect(() => inboundSignalSchema.parse(buildSignal({ ...({ action: 'approve' } as object) }))).toThrow()
  })

  it('rejects an invented intent', () => {
    expect(() => inboundSignalSchema.parse(buildSignal({ intent: 'APPROVE_EVERYTHING' as never }))).toThrow()
  })

  it.each([
    [-0.1],
    [1.1],
  ])('rejects a confidence of %p', (confidence) => {
    expect(() => inboundSignalSchema.parse(buildSignal({ confidence }))).toThrow()
  })

  it('rejects a non-positive or fractional quantity', () => {
    expect(() => inboundSignalSchema.parse(buildSignal({ commitments: [{ quantity: 0, date: '2026-09-23' }] }))).toThrow()
    expect(() => inboundSignalSchema.parse(buildSignal({ commitments: [{ quantity: 1.5, date: '2026-09-23' }] }))).toThrow()
  })

  it('rejects a date that is not a calendar date', () => {
    expect(() => inboundSignalSchema.parse(buildSignal({ commitments: [{ quantity: 10, date: 'wednesday' }] }))).toThrow()
  })

  it('allows a price only on an offer', () => {
    const offer = buildSignal({
      intent: 'ALTERNATIVE_SUPPLY_OFFER',
      price: { amount: 1400, currency: 'PLN' },
    })
    expect(inboundSignalSchema.parse(offer).price).toEqual({ amount: 1400, currency: 'PLN' })

    const proposalWithPrice = buildSignal({ price: { amount: 1400, currency: 'PLN' } })
    expect(() => inboundSignalSchema.parse(proposalWithPrice)).toThrow()
  })

  it('rejects a currency that is not a three-letter uppercase code', () => {
    const offer = buildSignal({ intent: 'ALTERNATIVE_SUPPLY_OFFER', price: { amount: 1, currency: 'pln' } })
    expect(() => inboundSignalSchema.parse(offer)).toThrow()
  })

  it('forbids an unrelated message from attaching itself to an open case', () => {
    const unrelated = buildSignal({
      intent: 'UNRELATED',
      correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
    })
    expect(() => inboundSignalSchema.parse(unrelated)).toThrow()
  })
})

describe('createInboundSignalSchema', () => {
  it('accepts a candidate index inside the offered list', () => {
    const schema = createInboundSignalSchema(3)
    const parsed = schema.parse(buildSignal({ correlation: { kind: 'EXISTING_CASE', candidateIndex: 2 } }))
    expect(parsed.correlation).toEqual({ kind: 'EXISTING_CASE', candidateIndex: 2 })
  })

  it('rejects a candidate index outside the offered list', () => {
    const schema = createInboundSignalSchema(3)
    expect(() => schema.parse(buildSignal({ correlation: { kind: 'EXISTING_CASE', candidateIndex: 3 } }))).toThrow()
    expect(() => schema.parse(buildSignal({ correlation: { kind: 'EXISTING_CASE', candidateIndex: 47 } }))).toThrow()
  })

  it('makes EXISTING_CASE unreachable when no candidates were offered', () => {
    const schema = createInboundSignalSchema(0)
    expect(() => schema.parse(buildSignal({ correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 } }))).toThrow()
    expect(schema.parse(buildSignal()).correlation).toEqual({ kind: 'NEW_CASE', candidateIndex: null })
  })

  it('rejects a free-form case identifier in place of an index', () => {
    const schema = createInboundSignalSchema(3)
    const smuggled = buildSignal({
      correlation: { kind: 'EXISTING_CASE', caseId: 'SC-999' } as never,
    })
    expect(() => schema.parse(smuggled)).toThrow()
  })

  it('refuses a nonsensical candidate count', () => {
    expect(() => createInboundSignalSchema(-1)).toThrow()
    expect(() => createInboundSignalSchema(1.5)).toThrow()
  })
})
