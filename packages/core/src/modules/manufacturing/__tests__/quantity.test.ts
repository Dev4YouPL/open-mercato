/** @jest-environment node */

import { hasAllowedPrecision, roundQuantity, toPositiveQuantity } from '../domain/quantity'

describe('toPositiveQuantity', () => {
  it.each([1, 0.25, 1000])('accepts %p', (value) => {
    expect(toPositiveQuantity(value)).toBe(value)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %p', (value) => {
    expect(toPositiveQuantity(value)).toBeNull()
  })
})

describe('hasAllowedPrecision', () => {
  it.each([1, 0.1, 0.25, 1.2345, 1000000.0001])('accepts %p with at most four decimal places', (value) => {
    expect(hasAllowedPrecision(value)).toBe(true)
  })

  it.each([1.23456, 0.00001, 2.00005])('rejects %p with more than four decimal places', (value) => {
    expect(hasAllowedPrecision(value)).toBe(false)
  })
})

describe('roundQuantity', () => {
  it.each([
    [1.23455, 1.2346],
    [1.00005, 1.0001],
    [2.5 / 3, 0.8333],
    [0.1 + 0.2, 0.3],
    [-1.23455, -1.2346],
  ])('rounds %p half-up to %p', (value, expected) => {
    expect(roundQuantity(value)).toBe(expected)
  })
})
