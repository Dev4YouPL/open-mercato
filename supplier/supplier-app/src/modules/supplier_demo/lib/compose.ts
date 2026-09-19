import type { SupplyCommitment } from '../data/entities'
import { buildSupplyEnvelope, renderSupplyEnvelope, type SupplyEnvelope, type StoredSupplyEnvelope, stripEnvelopeAddresses } from './envelope'

export type ComposedSupplyProposal = { subject: string; plain: string; html: string; envelope: Extract<SupplyEnvelope, { messageType: 'SUPPLY_PROPOSAL' }>; storedEnvelope: StoredSupplyEnvelope }

export function composeSupplyProposal(input: { messageId: string; correlationId: string; orderNumber: string; sku: string; sender: string; recipient: string; commitments: SupplyCommitment[] }): ComposedSupplyProposal {
  const envelope = buildSupplyEnvelope(input); const renderedEnvelope = renderSupplyEnvelope(envelope); const commitments = input.commitments.map((commitment) => `${commitment.quantity} on ${commitment.date}`).join('; '); const subject = `[${input.correlationId}] Delivery update — ${input.sku}`; const humanBody = `Delivery update for ${input.sku} on order ${input.orderNumber}: ${commitments}.`; const plain = `${humanBody}\n\n${renderedEnvelope}`; const html = `<p>${humanBody}</p><pre>${renderedEnvelope.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`
  return { subject, plain, html, envelope, storedEnvelope: stripEnvelopeAddresses(envelope) }
}

export const composeProposal = composeSupplyProposal

export type ComposedCommitmentConfirmation = { subject: string; plain: string; html: string; envelope: Extract<SupplyEnvelope, { messageType: 'SUPPLY_COMMITMENT_CONFIRMED' }>; storedEnvelope: StoredSupplyEnvelope }

export function composeCommitmentConfirmation(input: { messageId: string; correlationId: string; orderNumber: string; sku: string; sender: string; recipient: string; inReplyToMessageId: string; confirmedCommitments: SupplyCommitment[]; cancelledCommitments: SupplyCommitment[] }): ComposedCommitmentConfirmation {
  const envelope: Extract<SupplyEnvelope, { messageType: 'SUPPLY_COMMITMENT_CONFIRMED' }> = { schemaVersion: 1, messageId: input.messageId, correlationId: input.correlationId, messageType: 'SUPPLY_COMMITMENT_CONFIRMED', sender: input.sender, recipient: input.recipient, payload: { sku: input.sku, inReplyToMessageId: input.inReplyToMessageId, confirmedCommitments: input.confirmedCommitments.map((entry) => ({ ...entry })), cancelledCommitments: input.cancelledCommitments.map((entry) => ({ ...entry })) } }
  const rendered = renderSupplyEnvelope(envelope); const confirmed = input.confirmedCommitments.map((entry) => `${entry.quantity} pcs on ${entry.date}`).join(', '); const cancelled = input.cancelledCommitments.map((entry) => `${entry.quantity} pcs on ${entry.date}`).join(', '); const humanBody = `We confirm ${confirmed} of ${input.sku} for order ${input.orderNumber}.${cancelled ? ` The ${cancelled} planned quantity is cancelled as requested.` : ''}`
  return { subject: `[${input.correlationId}] Commitment confirmed — ${input.sku}`, plain: `${humanBody}\n\n${rendered}`, html: `<p>${humanBody}</p><pre>${rendered.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`, envelope, storedEnvelope: stripEnvelopeAddresses(envelope) }
}
