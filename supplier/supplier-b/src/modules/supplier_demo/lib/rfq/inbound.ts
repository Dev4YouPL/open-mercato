import { z } from 'zod'
import { preScanReplyText } from '../interpretation/prescan'

const MAX_SUBJECT_LENGTH = 240
const MAX_BODY_LENGTH = 12_000
const rfqSubjectPattern = /^RFQ\s+([A-Za-z0-9][A-Za-z0-9._-]{0,99})\s*:\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,99})$/i

export const rfqInboundSchema = z.object({
  subject: z.string().max(MAX_SUBJECT_LENGTH),
  body: z.string().max(MAX_BODY_LENGTH),
  senderEmail: z.string().trim().min(1).max(320),
  allowlistedSenderEmails: z.array(z.string().trim().min(1).max(320)).max(100).default([]),
  selfSenderEmail: z.string().trim().min(1).max(320).nullable().optional(),
  senderAllowlisted: z.boolean().optional(),
  isSelfSender: z.boolean().optional(),
}).strict()

export type RfqInbound = z.infer<typeof rfqInboundSchema>

export type RfqInboundRejectionReason =
  | 'invalid_input'
  | 'invalid_subject'
  | 'empty_body'
  | 'sender_not_allowlisted'
  | 'self_sender'
  | 'protocol_envelope'
  | 'prompt_injection'
  | 'existing_supply_case'
  | 'not_a_free_form_rfq'

export type RfqInboundClassification =
  | {
      accepted: true
      status: 'accepted'
      reason: null
      correlationId: string
      sku: string
      senderEmail: string
      body: string
    }
  | {
      accepted: false
      status: 'rejected'
      reason: RfqInboundRejectionReason
      reasons: RfqInboundRejectionReason[]
      correlationId: null
      sku: null
    }

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function hasProtocolEnvelope(value: string): boolean {
  if (/---OPEN-MERCATO-SUPPLY-MESSAGE---|---END-OPEN-MERCATO-SUPPLY-MESSAGE---/i.test(value)) return true
  if (/\bSUPPLY_(?:PROPOSAL|ACCEPTANCE|COUNTER_PROPOSAL|REJECTION|COMMITMENT_CONFIRMED)\b/i.test(value)) return true
  if (/^\s*(?:```(?:json)?\s*)?[\[{]/i.test(value)) return true
  if (/["']?(?:schemaVersion|messageType|correlationId|payload|inReplyToMessageId)["']?\s*:/i.test(value) && /[{}]/.test(value)) return true
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return 'messageType' in record || 'schemaVersion' in record || 'payload' in record
  } catch {
    return false
  }
}

function hasExistingSupplyCaseSignal(value: string, correlationId: string | null): boolean {
  if (/\bSC-[A-Za-z0-9][A-Za-z0-9._/-]*\b/i.test(value)) return true
  if (/\[\s*(?:SC|CASE)-[^\]]+\]/i.test(value)) return true
  if (/\b(?:supply[- ]case|existing case|delivery update|counter[- ]proposal|in reply to|message[- ]id)\b/i.test(value)) return true
  return correlationId !== null && /^SC[-_]/i.test(correlationId)
}

function hasPromptInjection(value: string): boolean {
  if (preScanReplyText(value).hit) return true
  return /\b(?:ignore|disregard|forget|override|bypass)\b[\s\S]{0,80}\b(?:instructions?|rules?|guardrails?|schema|classifier|system prompt)\b/i.test(value)
    || /\b(?:zignoruj|pomiń|obejdź|nadpisz)\b[\s\S]{0,80}\b(?:instrukcj|zasad|schemat|klasyfikator|prompt)\b/i.test(value)
}

function isClearlyFreeFormRfq(value: string): boolean {
  return /\b(?:rfq|request(?:ing)?\s+(?:a\s+)?(?:quote|quotation)|quote|quotation|pricing|price|availability|available|supply|deliver|offer)\b/i.test(value)
    || /\b(?:proszę\s+o\s+(?:ofertę|wycenę)|zapytanie\s+ofertowe|wycena|cena|dostępność|dostarczyć|oferta|ile\s+kosztuje)\b/i.test(value)
}

function invalidInputResult(): RfqInboundClassification {
  return {
    accepted: false,
    status: 'rejected',
    reason: 'invalid_input',
    reasons: ['invalid_input'],
    correlationId: null,
    sku: null,
  }
}

export function classifyRfqInbound(input: unknown): RfqInboundClassification {
  const parsed = rfqInboundSchema.safeParse(input)
  if (!parsed.success) return invalidInputResult()

  const value = parsed.data
  const subject = value.subject.trim()
  const body = value.body.trim()
  const subjectMatch = rfqSubjectPattern.exec(subject)
  const correlationId = subjectMatch?.[1] ?? null
  const sku = subjectMatch?.[2] ?? null
  const reasons: RfqInboundRejectionReason[] = []
  const addReason = (reason: RfqInboundRejectionReason) => {
    if (!reasons.includes(reason)) reasons.push(reason)
  }

  if (hasExistingSupplyCaseSignal(subject, correlationId)) addReason('existing_supply_case')
  if (hasExistingSupplyCaseSignal(body, correlationId)) addReason('existing_supply_case')
  if (!subjectMatch) addReason('invalid_subject')
  if (!body) addReason('empty_body')

  const sender = normalizeEmail(value.senderEmail)
  const selfSender = value.isSelfSender === true
    || (value.selfSenderEmail ? normalizeEmail(value.selfSenderEmail) === sender : false)
  if (selfSender) addReason('self_sender')

  const allowlisted = value.senderAllowlisted === true
    || value.allowlistedSenderEmails.some((entry) => normalizeEmail(entry) === sender)
  if (!allowlisted) addReason('sender_not_allowlisted')

  if (hasProtocolEnvelope(body)) addReason('protocol_envelope')
  if (hasPromptInjection(body)) addReason('prompt_injection')
  if (body && !isClearlyFreeFormRfq(body)) addReason('not_a_free_form_rfq')

  if (reasons.length > 0 || !correlationId || !sku) {
    return {
      accepted: false,
      status: 'rejected',
      reason: reasons[0] ?? 'invalid_subject',
      reasons: reasons.length > 0 ? reasons : ['invalid_subject'],
      correlationId: null,
      sku: null,
    }
  }

  return {
    accepted: true,
    status: 'accepted',
    reason: null,
    correlationId,
    sku,
    senderEmail: sender,
    body,
  }
}

export const classifyInboundRfq = classifyRfqInbound
