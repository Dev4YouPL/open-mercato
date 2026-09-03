import {
  addDecimals,
  canonicalizeDecimal,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  negateDecimal,
  roundDecimal,
  subtractDecimals,
} from '../exact'

describe('exact decimal operations', () => {
  it('canonicalizes base-10 values without negative zero', () => {
    expect(canonicalizeDecimal('00012.3400')).toBe('12.34')
    expect(canonicalizeDecimal('-0.000')).toBe('0')
    expect(() => canonicalizeDecimal(' 1')).toThrow('Invalid exact decimal')
    expect(() => canonicalizeDecimal('1e3')).toThrow('Invalid exact decimal')
  })

  it('calculates without binary floating point drift', () => {
    expect(addDecimals('0.1', '0.2')).toBe('0.3')
    expect(subtractDecimals('1', '0.25')).toBe('0.75')
    expect(multiplyDecimals('2.5', '12')).toBe('30')
    expect(negateDecimal('0')).toBe('0')
    expect(compareDecimals('1.00', '1')).toBe(0)
  })

  it('honors explicit rounding modes for signed ties', () => {
    expect(roundDecimal('1.25', 1, 'half_up')).toBe('1.3')
    expect(roundDecimal('-1.25', 1, 'half_up')).toBe('-1.3')
    expect(roundDecimal('1.21', 1, 'down')).toBe('1.2')
    expect(roundDecimal('-1.21', 1, 'up')).toBe('-1.3')
  })

  it('requires explicit division precision and rejects zero', () => {
    expect(divideDecimals('1', '8', 3, 'half_up')).toBe('0.125')
    expect(divideDecimals('-1', '8', 2, 'up')).toBe('-0.13')
    expect(() => divideDecimals('1', '0', 2, 'half_up')).toThrow('Division by zero')
  })
})
