import {
  addDecimals,
  canonicalizeDecimal,
  compareDecimals,
  divideDecimals,
  multiplyDecimals,
  negateDecimal,
  roundDecimal,
  subtractDecimals,
  type DecimalRoundingMode,
} from '../exact'

/**
 * The exhaustive matrix behind `exact.test.ts`: every scale the quantity
 * snapshot can carry, every sign combination, every rounding mode at and away
 * from a tie, the division and scale guards, and the canonical form of zero.
 *
 * These are the guarantees every quantity in Catalog, Sales and Manufacturing
 * rests on — a snapshot is audit evidence, so a value that round-trips
 * differently is a correctness bug, not a display detail.
 */

const MODES: DecimalRoundingMode[] = ['half_up', 'down', 'up']

describe('canonical form', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['-0.0000', '0'],
    ['0.0', '0'],
    ['000123', '123'],
    ['123.4500', '123.45'],
    ['-000.5000', '-0.5'],
    ['-1.000', '-1'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeDecimal(input)).toBe(expected)
  })

  it('never produces a negative zero from any operation', () => {
    expect(negateDecimal('0')).toBe('0')
    expect(negateDecimal('-0')).toBe('0')
    expect(subtractDecimals('1.5', '1.5')).toBe('0')
    expect(multiplyDecimals('-3', '0')).toBe('0')
    expect(roundDecimal('-0.004', 2, 'half_up')).toBe('0')
    expect(divideDecimals('-0', '5', 4, 'half_up')).toBe('0')
  })

  it.each([' 1', '1e3', '1.', '.1', '+1', '1,5', '', 'abc', '--1', '1.2.3'])(
    'rejects %p as a non-canonical decimal string',
    (input) => {
      expect(() => canonicalizeDecimal(input)).toThrow('Invalid exact decimal')
    },
  )
})

describe('rounding across scale 0 to 12', () => {
  it.each(Array.from({ length: 13 }, (_, scale) => scale))(
    'leaves a value that already fits scale %i untouched',
    (scale) => {
      expect(roundDecimal('7', scale, 'half_up')).toBe('7')
      expect(roundDecimal('-7', scale, 'up')).toBe('-7')
    },
  )

  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    'keeps a one-decimal value exact at scale %i',
    (scale) => {
      expect(roundDecimal('1.5', scale, 'half_up')).toBe('1.5')
      expect(roundDecimal('-1.5', scale, 'down')).toBe('-1.5')
    },
  )

  it.each(Array.from({ length: 13 }, (_, scale) => scale))('truncates a repeating value at scale %i', (scale) => {
    const value = `0.${'3'.repeat(15)}`
    const expected = scale === 0 ? '0' : `0.${'3'.repeat(scale)}`
    expect(roundDecimal(value, scale, 'down')).toBe(expected)
  })

  it('rejects a scale outside the supported range', () => {
    expect(() => roundDecimal('1', -1, 'half_up')).toThrow('Decimal scale')
    expect(() => roundDecimal('1', 1.5, 'half_up')).toThrow('Decimal scale')
    expect(() => roundDecimal('1', 1001, 'half_up')).toThrow('Decimal scale')
  })
})

describe('rounding modes at and away from a tie', () => {
  it.each([
    ['1.25', 1, 'half_up', '1.3'],
    ['1.25', 1, 'down', '1.2'],
    ['1.25', 1, 'up', '1.3'],
    ['-1.25', 1, 'half_up', '-1.3'],
    ['-1.25', 1, 'down', '-1.2'],
    ['-1.25', 1, 'up', '-1.3'],
    ['1.24', 1, 'half_up', '1.2'],
    ['1.26', 1, 'half_up', '1.3'],
    ['1.21', 1, 'up', '1.3'],
    ['-1.21', 1, 'down', '-1.2'],
    ['0.005', 2, 'half_up', '0.01'],
    ['-0.005', 2, 'half_up', '-0.01'],
    ['0.004', 2, 'up', '0.01'],
    ['0.004', 2, 'down', '0'],
  ] as Array<[string, number, DecimalRoundingMode, string]>)(
    'rounds %s to scale %i with %s as %s',
    (value, scale, mode, expected) => {
      expect(roundDecimal(value, scale, mode)).toBe(expected)
    },
  )

  it('rounds magnitude, not signed value, so a mode is symmetric about zero', () => {
    for (const mode of MODES) {
      expect(roundDecimal('-2.345', 2, mode)).toBe(`-${roundDecimal('2.345', 2, mode)}`)
    }
  })
})

describe('sign combinations', () => {
  it.each([
    ['2', '3', '5', '-1', '6'],
    ['-2', '3', '1', '-5', '-6'],
    ['2', '-3', '-1', '5', '-6'],
    ['-2', '-3', '-5', '1', '6'],
  ])('adds, subtracts and multiplies %s and %s exactly', (left, right, sum, difference, product) => {
    expect(addDecimals(left, right)).toBe(sum)
    expect(subtractDecimals(left, right)).toBe(difference)
    expect(multiplyDecimals(left, right)).toBe(product)
  })

  it.each([
    ['1.5', '1.50', 0],
    ['-1.5', '1.5', -1],
    ['1.5', '-1.5', 1],
    ['-1.50', '-1.5', 0],
    ['0', '-0', 0],
  ] as Array<[string, string, number]>)('compares %s with %s as %i', (left, right, expected) => {
    expect(compareDecimals(left, right)).toBe(expected)
  })
})

describe('division', () => {
  it.each([
    ['1', '8', 3, 'half_up', '0.125'],
    ['1', '3', 6, 'down', '0.333333'],
    ['1', '3', 6, 'up', '0.333334'],
    ['-1', '8', 2, 'up', '-0.13'],
    ['-1', '8', 2, 'down', '-0.12'],
    ['-1', '-8', 3, 'half_up', '0.125'],
    ['1', '-8', 3, 'half_up', '-0.125'],
    ['10', '4', 0, 'half_up', '3'],
    ['10', '4', 0, 'down', '2'],
    ['0.1', '0.2', 4, 'half_up', '0.5'],
  ] as Array<[string, string, number, DecimalRoundingMode, string]>)(
    'divides %s by %s at scale %i with %s as %s',
    (dividend, divisor, scale, mode, expected) => {
      expect(divideDecimals(dividend, divisor, scale, mode)).toBe(expected)
    },
  )

  it('rejects a zero divisor whatever its written form', () => {
    for (const zero of ['0', '-0', '0.000', '-0.00']) {
      expect(() => divideDecimals('1', zero, 2, 'half_up')).toThrow('Division by zero')
    }
  })
})

describe('magnitudes beyond IEEE-754 range', () => {
  it('adds and multiplies values a double could not hold', () => {
    const large = '99999999999999999999999999.999999999999'
    expect(addDecimals(large, '0.000000000001')).toBe('100000000000000000000000000')
    expect(multiplyDecimals('12345678901234567890', '10')).toBe('123456789012345678900')
  })

  it('keeps a long fractional tail exact, minus its insignificant trailing zeros', () => {
    const canonical = '0.12345678901234567890123456789'
    expect(canonicalizeDecimal(canonical + '0')).toBe(canonical)
    expect(addDecimals(canonical, '0')).toBe(canonical)
    expect(compareDecimals(canonical + '0', canonical)).toBe(0)
  })
})
