import { describe, expect, it } from '@jest/globals'
import { rfqInterpretationSchema, validateRfqInterpretation } from '../interpretation'

const sourceText = 'Please quote 100 units of MAT-42 for delivery on 2026-10-01.'
const validInterpretation = {
  sku: 'MAT-42',
  quantity: 100,
  deliveryDate: '2026-10-01',
  dateStatus: 'exact',
  skuEvidence: 'MAT-42',
  quantityEvidence: '100 units',
  dateEvidence: '2026-10-01',
  confidence: 0.94,
  instructionsDetected: false,
  status: 'ready',
  blockingStatuses: [],
} as const

describe('RFQ interpretation contract', () => {
  it('accepts a strict, grounded flat result', () => {
    const result = validateRfqInterpretation(validInterpretation, { sourceText, expectedSku: 'MAT-42' })
    expect(result).toMatchObject({ ok: true, status: 'ready', blockingStatuses: [] })
    expect(rfqInterpretationSchema.safeParse({ ...validInterpretation, extra: true }).success).toBe(false)
  })

  it('blocks missing evidence for an extracted fact', () => {
    const result = validateRfqInterpretation({ ...validInterpretation, quantityEvidence: null }, { sourceText })
    expect(result).toMatchObject({ ok: false, status: 'blocked' })
    if (!result.ok) expect(result.blockingStatuses).toContain('missing_quantity_evidence')
  })

  it('blocks an ambiguous date even when the evidence span is present', () => {
    const result = validateRfqInterpretation({
      ...validInterpretation,
      deliveryDate: null,
      dateStatus: 'ambiguous',
      dateEvidence: 'next Friday',
      blockingStatuses: [],
    }, { sourceText: 'Please quote 100 units of MAT-42 for delivery next Friday.' })
    expect(result).toMatchObject({ ok: false, status: 'blocked' })
    if (!result.ok) expect(result.blockingStatuses).toContain('ambiguous_date')
  })

  it('blocks prompt injection, low confidence, and invented evidence', () => {
    const result = validateRfqInterpretation({
      ...validInterpretation,
      confidence: 0.4,
      instructionsDetected: true,
      quantityEvidence: '200 units',
    }, { sourceText })
    expect(result).toMatchObject({ ok: false, status: 'blocked' })
    if (!result.ok) {
      expect(result.blockingStatuses).toEqual(expect.arrayContaining(['prompt_injection', 'low_confidence', 'invalid_evidence']))
    }
  })
})
