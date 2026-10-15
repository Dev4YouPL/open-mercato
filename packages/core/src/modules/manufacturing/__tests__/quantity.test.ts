/** @jest-environment node */

import { toPositiveQuantity } from '../domain/quantity'

describe('toPositiveQuantity', () => {
  it.each([1, 0.25, 1000])('accepts %p', (value) => {
    expect(toPositiveQuantity(value)).toBe(value)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %p', (value) => {
    expect(toPositiveQuantity(value)).toBeNull()
  })
})
