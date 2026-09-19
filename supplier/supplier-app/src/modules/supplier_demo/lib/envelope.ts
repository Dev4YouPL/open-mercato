import type { SupplyCommitment } from '../data/entities'

export type SupplyEnvelope = {
  schemaVersion: 1
  messageId: string
  correlationId: string
  messageType: 'SUPPLY_PROPOSAL'
  sender: string
  recipient: string
  payload: {
    sku: string
    commitments: SupplyCommitment[]
  }
}

export type StoredSupplyEnvelope = Omit<SupplyEnvelope, 'sender' | 'recipient'>

export function buildSupplyEnvelope(input: {
  messageId: string
  correlationId: string
  sender: string
  recipient: string
  sku: string
  commitments: SupplyCommitment[]
}): SupplyEnvelope {
  return {
    schemaVersion: 1,
    messageId: input.messageId,
    correlationId: input.correlationId,
    messageType: 'SUPPLY_PROPOSAL',
    sender: input.sender,
    recipient: input.recipient,
    payload: {
      sku: input.sku,
      commitments: input.commitments.map((commitment) => ({ ...commitment })),
    },
  }
}

export function stripEnvelopeAddresses(envelope: SupplyEnvelope): StoredSupplyEnvelope {
  return {
    schemaVersion: envelope.schemaVersion,
    messageId: envelope.messageId,
    correlationId: envelope.correlationId,
    messageType: envelope.messageType,
    payload: envelope.payload,
  }
}

export function renderSupplyEnvelope(envelope: SupplyEnvelope): string {
  return [
    '---OPEN-MERCATO-SUPPLY-MESSAGE---',
    JSON.stringify(envelope, null, 2),
    '---END-OPEN-MERCATO-SUPPLY-MESSAGE---',
  ].join('\n')
}

export const buildEnvelope = buildSupplyEnvelope
export const renderEnvelope = renderSupplyEnvelope
