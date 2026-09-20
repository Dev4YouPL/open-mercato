import { createHash, randomUUID } from 'node:crypto'
import type { SupplyCase } from '../../data/entities'
import { SANITIZER_VERSION } from './sanitize'

// One source for the prompt and its version: the agent declaration. A second copy here would drift from the
// prompt the runtime actually sends and from the hash stored in the audit.
export {
  SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION,
  SUPPLIER_REPLY_INTERPRETER_SYSTEM_PROMPT,
} from '../../ai-agents'
import { SUPPLIER_REPLY_INTERPRETER_PROMPT_VERSION as PROMPT_VERSION } from '../../ai-agents'

function weekday(date: string): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? 'mon'
}

export function buildReplyInterpreterInput(input: {
  supplyCase: Pick<SupplyCase, 'sku' | 'currentCommitment' | 'originalCommitment'>
  sanitizedText: string
  today?: string
  languageHint?: 'pl' | 'en' | null
}): Record<string, unknown> {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const nonce = randomUUID().replaceAll('-', '')
  return {
    promptVersion: PROMPT_VERSION,
    sanitizerVersion: SANITIZER_VERSION,
    today,
    todayWeekday: weekday(today),
    case: {
      sku: input.supplyCase.sku,
      unit: 'pcs',
      currentProposal: input.supplyCase.currentCommitment.map((entry) => ({ quantity: entry.quantity, date: entry.date, weekday: weekday(entry.date) })),
      totalQuantity: input.supplyCase.currentCommitment.reduce((total, entry) => total + entry.quantity, 0),
    },
    message: {
      language_hint: input.languageHint ?? null,
      text: `<<<MAIL_DATA nonce=${nonce}>>>\n${input.sanitizedText}\n<<<END_MAIL_DATA nonce=${nonce}>>>`,
    },
  }
}

export function canonicalReplyInterpreterInput(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

export function hashReplyInterpreterInput(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
