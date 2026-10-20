/** @jest-environment node */

import { formatOrderNumber } from '../domain/productionOrder'

describe('production order number', () => {
  it.each([
    [1, 'PO-000001'],
    [42, 'PO-000042'],
    [1234567, 'PO-1234567'],
  ])('formats sequence %p as %p', (sequence, expected) => {
    expect(formatOrderNumber(sequence)).toBe(expected)
  })
})
