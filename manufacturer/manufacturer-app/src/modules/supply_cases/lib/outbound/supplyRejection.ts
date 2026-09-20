import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { InboundMessage, SupplyCase } from '../../data/types'

const markerStart = '---OPEN-MERCATO-SUPPLY-MESSAGE---'
const markerEnd = '---END-OPEN-MERCATO-SUPPLY-MESSAGE---'

const proposalEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().regex(/^MSG-.+/),
  correlationId: z.string().min(1),
  messageType: z.literal('SUPPLY_PROPOSAL'),
  sender: z.string().email(),
  recipient: z.string().email(),
  payload: z.object({
    sku: z.string().min(1),
    commitments: z.array(z.object({ quantity: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()).min(1),
  }).passthrough(),
}).strict()

export type SupplyProposalEnvelope = z.infer<typeof proposalEnvelopeSchema>

export type SupplyRejectionSource = {
  proposal: SupplyProposalEnvelope
  sourceRfcMessageId: string
}

export type SupplyRejectionEnvelope = {
  schemaVersion: 1
  messageId: string
  correlationId: string
  messageType: 'SUPPLY_REJECTION'
  sender: string
  recipient: string
  payload: {
    sku: string
    inReplyToMessageId: string
    reason: string
  }
}

export function buildSupplyRejectionEnvelope(input: {
  correlationId: string
  sender: string
  recipient: string
  sku: string
  inReplyToMessageId: string
  reason: string
  messageId?: string
}): SupplyRejectionEnvelope {
  return {
    schemaVersion: 1,
    messageId: input.messageId ?? `MSG-${randomUUID()}`,
    correlationId: input.correlationId,
    messageType: 'SUPPLY_REJECTION',
    sender: input.sender,
    recipient: input.recipient,
    payload: {
      sku: input.sku,
      inReplyToMessageId: input.inReplyToMessageId,
      reason: input.reason,
    },
  }
}

export function renderSupplyRejectionEnvelope(envelope: SupplyRejectionEnvelope): string {
  return [markerStart, JSON.stringify(envelope, null, 2), markerEnd].join('\n')
}

export function buildSupplyRejectionBody(input: { envelope: SupplyRejectionEnvelope; reason: string }): string {
  return `We are unable to accept the proposed supply plan for ${input.envelope.payload.sku}. Reason: ${input.reason}.\n\n${renderSupplyRejectionEnvelope(input.envelope)}`
}

export function readSupplyProposalSource(message: InboundMessage, supplyCase: SupplyCase): SupplyRejectionSource | null {
  if (message.messageIntent !== 'SUPPLY_PROPOSAL' || !message.rawBody || !message.rfcMessageId.trim() || message.senderEmail !== supplyCase.supplier1Email) return null
  const blocks = extractBlocks(message.rawBody)
  if (blocks.length !== 1) return null
  const parsed = safeJson(blocks[0])
  const proposal = proposalEnvelopeSchema.safeParse(parsed)
  if (!proposal.success) return null
  if (proposal.data.correlationId !== supplyCase.correlationId || proposal.data.payload.sku !== supplyCase.sku) return null
  if (proposal.data.sender.toLowerCase() !== message.senderEmail.toLowerCase()) return null
  if (proposal.data.recipient.toLowerCase() !== message.recipientEmail.toLowerCase()) return null
  return { proposal: proposal.data, sourceRfcMessageId: message.rfcMessageId }
}

function extractBlocks(body: string): string[] {
  const blocks: string[] = []
  let cursor = 0
  while (cursor < body.length) {
    const start = body.indexOf(markerStart, cursor)
    if (start < 0) break
    const contentStart = start + markerStart.length
    const end = body.indexOf(markerEnd, contentStart)
    if (end < 0) return []
    blocks.push(body.slice(contentStart, end).split('\n').map(stripQuotePrefix).join('\n').trim())
    cursor = end + markerEnd.length
  }
  return blocks
}

function stripQuotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, '')
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
