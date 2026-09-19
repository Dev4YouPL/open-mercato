import type { SupplyCommitment } from '../data/entities'
import { buildSupplyEnvelope, renderSupplyEnvelope, type SupplyEnvelope, type StoredSupplyEnvelope, stripEnvelopeAddresses } from './envelope'

export type ComposedSupplyProposal = {
  subject: string
  plain: string
  html: string
  envelope: SupplyEnvelope
  storedEnvelope: StoredSupplyEnvelope
}

export function composeSupplyProposal(input: {
  messageId: string
  correlationId: string
  orderNumber: string
  sku: string
  sender: string
  recipient: string
  commitments: SupplyCommitment[]
}): ComposedSupplyProposal {
  const envelope = buildSupplyEnvelope(input)
  const renderedEnvelope = renderSupplyEnvelope(envelope)
  const commitments = input.commitments.map((commitment) => `${commitment.quantity} on ${commitment.date}`).join('; ')
  const subject = `[${input.correlationId}] Delivery update — ${input.sku}`
  const humanBody = `Delivery update for ${input.sku} on order ${input.orderNumber}: ${commitments}.`
  const plain = `${humanBody}\n\n${renderedEnvelope}`
  const html = `<p>${humanBody}</p><pre>${renderedEnvelope.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`

  return { subject, plain, html, envelope, storedEnvelope: stripEnvelopeAddresses(envelope) }
}

export const composeProposal = composeSupplyProposal
