import { htmlToText } from 'html-to-text'
import { supplyEnvelopeSchema, type SupplyEnvelope } from './envelope'

export const SUPPLY_BLOCK_START = '---OPEN-MERCATO-SUPPLY-MESSAGE---'
export const SUPPLY_BLOCK_END = '---END-OPEN-MERCATO-SUPPLY-MESSAGE---'

export type ParsedSupplyBlock = {
  raw: string
  value: unknown
  envelope: SupplyEnvelope | null
  schemaError: string | null
}

export function normalizeInboundText(body: string, bodyFormat: 'text' | 'markdown' | 'html' = 'text'): string {
  const text = bodyFormat === 'html' ? htmlToText(body, { wordwrap: false }) : body
  return text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(/&nbsp;/gi, ' ')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:>\s*)+/, '').trimEnd())
    .join('\n')
    .trim()
}

function parseJsonBlock(raw: string): ParsedSupplyBlock {
  try {
    const value: unknown = JSON.parse(raw)
    const parsed = supplyEnvelopeSchema.safeParse(value)
    return parsed.success
      ? { raw, value, envelope: parsed.data, schemaError: null }
      : { raw, value, envelope: null, schemaError: parsed.error.issues[0]?.message ?? 'schema_invalid' }
  } catch {
    return { raw, value: null, envelope: null, schemaError: 'invalid_json' }
  }
}

export function extractSupplyBlocks(text: string): ParsedSupplyBlock[] {
  const blocks: ParsedSupplyBlock[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf(SUPPLY_BLOCK_START, cursor)
    if (start < 0) break
    const contentStart = start + SUPPLY_BLOCK_START.length
    const end = text.indexOf(SUPPLY_BLOCK_END, contentStart)
    if (end < 0) {
      blocks.push({ raw: text.slice(contentStart).trim(), value: null, envelope: null, schemaError: 'unterminated_block' })
      break
    }
    const raw = text
      .slice(contentStart, end)
      .split('\n')
      .map((line) => line.replace(/^\s*(?:>\s*)+/, '').trim())
      .join('\n')
      .trim()
    blocks.push(parseJsonBlock(raw))
    cursor = end + SUPPLY_BLOCK_END.length
  }
  return blocks
}

export function parseInboundSupplyText(body: string, bodyFormat: 'text' | 'markdown' | 'html' = 'text'): {
  normalizedText: string
  humanText: string
  blocks: ParsedSupplyBlock[]
} {
  const normalizedText = normalizeInboundText(body, bodyFormat)
  const blocks = extractSupplyBlocks(normalizedText)
  const humanText = normalizedText
    .replaceAll(SUPPLY_BLOCK_START, '')
    .replaceAll(SUPPLY_BLOCK_END, '')
    .trim()
  return { normalizedText, humanText, blocks }
}
