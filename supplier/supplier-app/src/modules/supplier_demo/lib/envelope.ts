import { z } from 'zod'
import type { SupplyCommitment } from '../data/entities'

const commitmentSchema = z.object({
  quantity: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

const proposalPayloadSchema = z.object({
  sku: z.string().min(1),
  commitments: z.array(commitmentSchema),
}).strict()

const replyPayloadBaseSchema = z.object({
  sku: z.string().min(1),
  inReplyToMessageId: z.string().min(1),
})

const acceptancePayloadSchema = replyPayloadBaseSchema.extend({
  acceptedCommitments: z.array(commitmentSchema).min(1),
  cancelledCommitments: z.array(commitmentSchema),
}).strict()

const confirmationPayloadSchema = replyPayloadBaseSchema.extend({
  confirmedCommitments: z.array(commitmentSchema).min(1),
  cancelledCommitments: z.array(commitmentSchema),
}).strict()

const counterPayloadSchema = replyPayloadBaseSchema.passthrough()
const rejectionPayloadSchema = replyPayloadBaseSchema.passthrough()

const envelopeBaseSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().min(1),
  correlationId: z.string().min(1),
  sender: z.string().min(1),
  recipient: z.string().min(1),
}).strict()

export const supplyEnvelopeSchema = z.discriminatedUnion('messageType', [
  envelopeBaseSchema.extend({ messageType: z.literal('SUPPLY_PROPOSAL'), payload: proposalPayloadSchema }),
  envelopeBaseSchema.extend({ messageType: z.literal('SUPPLY_ACCEPTANCE'), payload: acceptancePayloadSchema }),
  envelopeBaseSchema.extend({ messageType: z.literal('SUPPLY_COUNTER_PROPOSAL'), payload: counterPayloadSchema }),
  envelopeBaseSchema.extend({ messageType: z.literal('SUPPLY_REJECTION'), payload: rejectionPayloadSchema }),
  envelopeBaseSchema.extend({ messageType: z.literal('SUPPLY_COMMITMENT_CONFIRMED'), payload: confirmationPayloadSchema }),
])

export type SupplyEnvelope = z.infer<typeof supplyEnvelopeSchema>
export type SupplyMessageType = SupplyEnvelope['messageType']
export type StoredSupplyEnvelope = Omit<SupplyEnvelope, 'sender' | 'recipient'>

export function parseSupplyEnvelope(value: unknown): SupplyEnvelope {
  return supplyEnvelopeSchema.parse(value)
}

export function buildSupplyEnvelope(input: {
  messageId: string
  correlationId: string
  sender: string
  recipient: string
  sku: string
  commitments: SupplyCommitment[]
}): Extract<SupplyEnvelope, { messageType: 'SUPPLY_PROPOSAL' }> {
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
  const { sender: _sender, recipient: _recipient, ...stored } = envelope
  return stored
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
