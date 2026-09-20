export const SANITIZER_VERSION = 's1'

export type SanitizationFailure = 'interpretation_empty' | 'interpretation_input_too_long'

export type SanitizationResult = {
  ok: true
  text: string
  inputChars: number
  outputChars: number
} | {
  ok: false
  reason: SanitizationFailure
  text: string
  inputChars: number
  outputChars: number
}

export type SanitizationOptions = {
  ownOrderNumber?: string | null
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 4000
const OWN_ORDER_MARKER = '__SUPPLIER_OWN_ORDER__'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Everything from the first quote header on belongs to the mail we sent, including our own envelope block, so it
// never reaches the model. Covers the English and Polish client wordings and the plain Outlook separator line.
const QUOTE_HEADERS = [
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*(?:oryginalna wiadomo|wiadomo(?:ść|sc) oryginalna)/i,
  /^\s*-{2,}\s*(?:forwarded message|wiadomość przekazana)/i,
  /^_{5,}\s*$/,
  /^\s*on .+ wrote:\s*$/i,
  /^\s*(?:w dniu|dnia) .+ (?:napisał|napisała|napisano|pisze)/i,
  /^\s*(?:od|from):\s*.+<[^>]+>\s*$/i,
]

function removeQuotedHistory(value: string): string {
  const lines = value.split(/\r?\n/)
  const result: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (QUOTE_HEADERS.some((pattern) => pattern.test(line))) break
    if (/^\s*--\s*$/.test(line)) break
    result.push(line)
  }
  return result.join('\n')
}

function stripUnsafeCharacters(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

function pseudonymize(value: string, ownOrderNumber: string | null | undefined): string {
  let result = value
  if (ownOrderNumber?.trim()) {
    result = result.replace(new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(ownOrderNumber.trim())}(?![A-Za-z0-9-])`, 'gi'), OWN_ORDER_MARKER)
  }
  result = result.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, '[NUMBER]')
  result = result.replace(/https?:\/\/[^\s<]+|www\.[^\s<]+/gi, '[URL]')
  result = result.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
  result = result.replace(/(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)/g, (match) => {
    const trimmed = match.trim()
    const digitCount = (trimmed.match(/\d/g) ?? []).length
    // Dates in any common written form are business data, never a phone number: 2026-09-23, 23.09.2026, 23/09/26.
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(trimmed)) return match
    // A quantity list ("400 100") must survive; only a real phone-length run or an international prefix is masked.
    if (!trimmed.startsWith('+') && digitCount < 9) return match
    return '[PHONE]'
  })
  result = result.replace(/(?<!\d)\d{12,}(?!\d)/g, '[NUMBER]')
  // An order reference always carries a separator (SO-441, PO_77). Without it "po 400 szt." would eat the quantity.
  result = result.replace(/\b(?:SO|PO|ORDER|ORD)[-_/][A-Z0-9][A-Z0-9-]*\b/gi, '[ORDER]')
  return result.replaceAll(OWN_ORDER_MARKER, '[OUR_ORDER]')
}

export function sanitizeReplyText(input: string, options: SanitizationOptions = {}): SanitizationResult {
  const inputChars = input.length
  const cleaned = pseudonymize(
    removeQuotedHistory(stripUnsafeCharacters(input)),
    options.ownOrderNumber,
  ).replace(/\s+/g, ' ').trim()
  const outputChars = cleaned.length
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  if (!cleaned) return { ok: false, reason: 'interpretation_empty', text: cleaned, inputChars, outputChars }
  if (outputChars > maxChars) return { ok: false, reason: 'interpretation_input_too_long', text: cleaned, inputChars, outputChars }
  return { ok: true, text: cleaned, inputChars, outputChars }
}

export const sanitizeInboundReplyText = sanitizeReplyText
