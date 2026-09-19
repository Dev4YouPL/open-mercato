import type { SupplyCase, SupplyCommitment } from '../data/entities'
import type { SupplyEnvelope } from './envelope'

export type InboundValidationStatus =
  | 'valid'
  | 'no_envelope'
  | 'schema_invalid'
  | 'ambiguous_envelope'
  | 'untrusted_sender'
  | 'sender_not_case_partner'
  | 'recipient_mismatch'
  | 'correlation_mismatch'
  | 'sku_mismatch'
  | 'duplicate'
  | 'stale_reference'
  | 'case_closed'
  | 'case_not_awaiting_reply'

export type InboundValidationResult = {
  status: InboundValidationStatus
  reason: string
  notify: boolean
  envelope: SupplyEnvelope | null
}

export type InboundValidationInput = {
  envelope: SupplyEnvelope | null
  blockCount: number
  schemaError?: string | null
  transportSender?: string | null
  // Transport sender is on the partner allowlist (SUPPLIER_DEMO_PARTNER_EMAILS). Missing means not allowlisted.
  senderAllowlisted?: boolean
  casePartner?: string | null
  transportRecipient?: string | null
  caseRecord: Pick<SupplyCase, 'status' | 'correlationId' | 'sku'>
  latestProposalId?: string | null
  validBusinessMessageIds?: ReadonlySet<string>
}

const awaitingStatuses = new Set(['proposal_queued', 'proposal_delivered'])

function normaliseAddress(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function result(status: InboundValidationStatus, reason: string, envelope: SupplyEnvelope | null, notify: boolean): InboundValidationResult {
  return { status, reason, notify, envelope }
}

export function validateInboundEnvelope(input: InboundValidationInput): InboundValidationResult {
  const sender = normaliseAddress(input.transportSender)
  const partner = normaliseAddress(input.casePartner)
  if (!sender) return result('untrusted_sender', 'missing_transport_sender', input.envelope, false)
  if (input.senderAllowlisted !== true) return result('untrusted_sender', 'sender_not_allowlisted', input.envelope, false)
  if (!partner || sender !== partner) return result('sender_not_case_partner', 'sender_not_case_partner', input.envelope, false)
  if (!input.envelope) {
    return result(input.schemaError ? 'schema_invalid' : 'no_envelope', input.schemaError ?? 'no_envelope', null, true)
  }
  if (input.blockCount !== 1) return result('ambiguous_envelope', 'ambiguous_envelope', input.envelope, true)
  if (normaliseAddress(input.envelope.sender) !== sender) return result('sender_not_case_partner', 'envelope_sender_mismatch', input.envelope, true)
  if (input.transportRecipient && normaliseAddress(input.envelope.recipient) !== normaliseAddress(input.transportRecipient)) {
    return result('recipient_mismatch', 'recipient_mismatch', input.envelope, true)
  }
  if (input.envelope.correlationId !== input.caseRecord.correlationId) return result('correlation_mismatch', 'correlation_mismatch', input.envelope, true)
  if (input.envelope.payload.sku !== input.caseRecord.sku) return result('sku_mismatch', 'sku_mismatch', input.envelope, true)
  if (input.validBusinessMessageIds?.has(input.envelope.messageId)) return result('duplicate', 'duplicate', input.envelope, false)
  if (input.envelope.messageType === 'SUPPLY_PROPOSAL' || input.envelope.messageType === 'SUPPLY_COMMITMENT_CONFIRMED') {
    return result('schema_invalid', 'unexpected_message_type', input.envelope, true)
  }
  const inReplyTo = 'inReplyToMessageId' in input.envelope.payload ? input.envelope.payload.inReplyToMessageId : null
  if (!input.latestProposalId || inReplyTo !== input.latestProposalId) return result('stale_reference', 'stale_reference', input.envelope, true)
  if (input.caseRecord.status === 'resolved') return result('case_closed', 'case_closed', input.envelope, false)
  if (!awaitingStatuses.has(input.caseRecord.status)) return result('case_not_awaiting_reply', 'case_not_awaiting_reply', input.envelope, false)
  return result('valid', 'valid', input.envelope, false)
}

export function commitmentTotals(commitments: SupplyCommitment[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const commitment of commitments) totals.set(commitment.date, (totals.get(commitment.date) ?? 0) + commitment.quantity)
  return totals
}
