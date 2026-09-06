export type DecimalRoundingMode = 'half_up' | 'down' | 'up'

type ParsedDecimal = { coefficient: bigint; scale: number }

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

function pow10(scale: number): bigint {
  return 10n ** BigInt(scale)
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 1000) {
    throw new Error('[internal] Decimal scale must be an integer between 0 and 1000')
  }
}

function parse(value: string): ParsedDecimal {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error('[internal] Invalid exact decimal')
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integerPart, fractionalPart = ''] = unsigned.split('.')
  const coefficient = BigInt(`${integerPart}${fractionalPart}`)
  return { coefficient: negative ? -coefficient : coefficient, scale: fractionalPart.length }
}

function format(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return '0'
  const negative = coefficient < 0n
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0')
  const integerLength = digits.length - scale
  const integerPart = digits.slice(0, integerLength)
  const fractionalPart = scale === 0 ? '' : digits.slice(integerLength).replace(/0+$/, '')
  return `${negative ? '-' : ''}${integerPart}${fractionalPart ? `.${fractionalPart}` : ''}`
}

function align(left: ParsedDecimal, right: ParsedDecimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale)
  return [
    left.coefficient * pow10(scale - left.scale),
    right.coefficient * pow10(scale - right.scale),
    scale,
  ]
}

export function canonicalizeDecimal(value: string): string {
  const parsed = parse(value)
  return format(parsed.coefficient, parsed.scale)
}

export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const [alignedLeft, alignedRight] = align(parse(left), parse(right))
  return alignedLeft === alignedRight ? 0 : alignedLeft < alignedRight ? -1 : 1
}

export function addDecimals(left: string, right: string): string {
  const [alignedLeft, alignedRight, scale] = align(parse(left), parse(right))
  return format(alignedLeft + alignedRight, scale)
}

export function subtractDecimals(left: string, right: string): string {
  return addDecimals(left, negateDecimal(right))
}

export function negateDecimal(value: string): string {
  const parsed = parse(value)
  return format(-parsed.coefficient, parsed.scale)
}

export function multiplyDecimals(left: string, right: string): string {
  const parsedLeft = parse(left)
  const parsedRight = parse(right)
  return format(parsedLeft.coefficient * parsedRight.coefficient, parsedLeft.scale + parsedRight.scale)
}

export function roundDecimal(value: string, scale: number, mode: DecimalRoundingMode): string {
  assertScale(scale)
  const parsed = parse(value)
  if (parsed.scale <= scale) return format(parsed.coefficient * pow10(scale - parsed.scale), scale)
  const divisor = pow10(parsed.scale - scale)
  const negative = parsed.coefficient < 0n
  const magnitude = negative ? -parsed.coefficient : parsed.coefficient
  let rounded = magnitude / divisor
  const remainder = magnitude % divisor
  if (remainder !== 0n && (mode === 'up' || (mode === 'half_up' && remainder * 2n >= divisor))) {
    rounded += 1n
  }
  return format(negative ? -rounded : rounded, scale)
}

export function divideDecimals(
  dividend: string,
  divisor: string,
  scale: number,
  mode: DecimalRoundingMode,
): string {
  assertScale(scale)
  const left = parse(dividend)
  const right = parse(divisor)
  if (right.coefficient === 0n) throw new Error('[internal] Division by zero')
  const negative = (left.coefficient < 0n) !== (right.coefficient < 0n)
  const numerator = (left.coefficient < 0n ? -left.coefficient : left.coefficient) * pow10(scale + right.scale)
  const denominator = (right.coefficient < 0n ? -right.coefficient : right.coefficient) * pow10(left.scale)
  let quotient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder !== 0n && (mode === 'up' || (mode === 'half_up' && remainder * 2n >= denominator))) {
    quotient += 1n
  }
  return format(negative ? -quotient : quotient, scale)
}
