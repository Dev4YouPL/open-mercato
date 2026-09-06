/**
 * Quantities and yield factors are stored as canonical decimal strings padded
 * to their column scale (`1.000000`, `1.000000000000`). That padding is
 * evidence, not information: a table of it reads as noise, so display trims the
 * trailing zeros while leaving the stored value untouched.
 */
export function formatDecimalForDisplay(value: string): string {
  const trimmed = value.trim()
  if (!/^-?\d+\.\d+$/.test(trimmed)) return trimmed
  const withoutTrailingZeros = trimmed.replace(/0+$/, '')
  return withoutTrailingZeros.endsWith('.')
    ? withoutTrailingZeros.slice(0, -1)
    : withoutTrailingZeros
}

export function formatQuantityForDisplay(value: string, unitCode: string): string {
  return `${formatDecimalForDisplay(value)} ${unitCode}`
}
