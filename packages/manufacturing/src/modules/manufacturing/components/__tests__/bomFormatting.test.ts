import { formatDecimalForDisplay, formatQuantityForDisplay } from '../bomFormatting'

describe('formatDecimalForDisplay', () => {
  it('trims the scale padding a canonical decimal string carries', () => {
    expect(formatDecimalForDisplay('1.000000')).toBe('1')
    expect(formatDecimalForDisplay('1.000000000000')).toBe('1')
    expect(formatDecimalForDisplay('2.500000')).toBe('2.5')
    expect(formatDecimalForDisplay('0.125000')).toBe('0.125')
  })

  it('keeps values that carry no padding untouched', () => {
    expect(formatDecimalForDisplay('12')).toBe('12')
    expect(formatDecimalForDisplay('0.5')).toBe('0.5')
    expect(formatDecimalForDisplay('-1.250')).toBe('-1.25')
  })

  it('passes anything that is not a decimal string straight through', () => {
    expect(formatDecimalForDisplay('')).toBe('')
    expect(formatDecimalForDisplay('n/a')).toBe('n/a')
    expect(formatDecimalForDisplay('1e6')).toBe('1e6')
  })
})

describe('formatQuantityForDisplay', () => {
  it('pairs the trimmed value with its unit code', () => {
    expect(formatQuantityForDisplay('1.000000', 'hour')).toBe('1 hour')
    expect(formatQuantityForDisplay('2.250000', 'kg')).toBe('2.25 kg')
  })
})
