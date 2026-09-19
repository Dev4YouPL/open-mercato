import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { InboundMessage, OutboundCorrelation, StoreScope, SupplyCase } from '../../data/types'
import {
  alternativeOfferCommitmentSchema,
  alternativeOfferPriceSchema,
  alternativeOfferSnapshotSchema,
  type AlternativeOfferSnapshot,
} from '../../data/types'
import { emailsMatch } from '../email/normalizeEmail'
import { resolveThreadEvidence } from '../inbound/resolveThread'

export const alternativeOfferInputSchema = z.object({
  supplierId: z.string().min(1),
  sku: z.string().min(1),
  sourceInboundMessageId: z.string().min(1),
  sourceRfcMessageId: z.string().min(1),
  sourceOutboundCorrelationId: z.string().min(1),
  requestedQuantity: z.number().int().positive(),
  offeredQuantity: z.number().int().positive(),
  commitments: z.array(alternativeOfferCommitmentSchema).min(1),
  priceTotal: alternativeOfferPriceSchema,
  recordedAt: z.string().datetime(),
}).strict()
export type AlternativeOfferInput = z.infer<typeof alternativeOfferInputSchema>

export type OfferValidationResult =
  | { ok: true; offer: AlternativeOfferSnapshot }
  | { ok: false; reason: 'OFFER_INVALID'; issues: string[] }

export function validateAlternativeOffer(
  supplyCase: SupplyCase,
  correlation: OutboundCorrelation,
  input: unknown,
): OfferValidationResult {
  const parsed = alternativeOfferInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: 'OFFER_INVALID', issues: parsed.error.issues.map((issue) => issue.path.join('.')) }
  const value = parsed.data
  const issues: string[] = []
  if (supplyCase.status !== 'WAITING_FOR_ALTERNATIVE_OFFER') issues.push('status')
  if (correlation.tenantId !== supplyCase.tenantId || correlation.organizationId !== supplyCase.organizationId) issues.push('scope')
  if (correlation.caseId !== supplyCase.id || correlation.phase !== 'ALTERNATIVE_SUPPLY_REQUEST') issues.push('correlation')
  if (correlation.id !== value.sourceOutboundCorrelationId) issues.push('sourceOutboundCorrelationId')
  if (!supplyCase.supplier2Email || !emailsMatch(supplyCase.supplier2Email, value.supplierId)) issues.push('supplierId')
  if (!emailsMatch(correlation.recipientEmail, value.supplierId)) issues.push('correlation.recipientEmail')
  if (value.sku !== supplyCase.sku) issues.push('sku')
  if (value.requestedQuantity !== supplyCase.requiredQuantity - onTimePrimaryQuantity(supplyCase)) issues.push('requestedQuantity')
  if (value.offeredQuantity !== value.requestedQuantity) issues.push('offeredQuantity')
  if (sum(value.commitments) !== value.offeredQuantity) issues.push('commitments')
  if (value.priceTotal.currency !== supplyCase.currency) issues.push('priceTotal.currency')
  if (issues.length > 0) return { ok: false, reason: 'OFFER_INVALID', issues }
  const normalized = {
    schemaVersion: 1 as const,
    supplierId: normalize(value.supplierId),
    sku: value.sku,
    sourceInboundMessageId: value.sourceInboundMessageId,
    sourceRfcMessageId: value.sourceRfcMessageId,
    sourceOutboundCorrelationId: value.sourceOutboundCorrelationId,
    requestedQuantity: value.requestedQuantity,
    offeredQuantity: value.offeredQuantity,
    commitments: normalizeCommitments(value.commitments),
    priceTotal: value.priceTotal,
    offerHash: '',
    recordedAt: value.recordedAt,
  }
  const offerHash = calculateAlternativeOfferHash(normalized)
  return { ok: true, offer: alternativeOfferSnapshotSchema.parse({ ...normalized, offerHash }) }
}

export function calculateAlternativeOfferHash(
  offer: Pick<AlternativeOfferSnapshot, 'schemaVersion' | 'supplierId' | 'sku' | 'requestedQuantity' | 'offeredQuantity' | 'commitments' | 'priceTotal'>,
): string {
  return hashCanonical({
    schemaVersion: offer.schemaVersion,
    supplierId: normalize(offer.supplierId),
    sku: offer.sku,
    requestedQuantity: offer.requestedQuantity,
    offeredQuantity: offer.offeredQuantity,
    commitments: normalizeCommitments(offer.commitments),
    priceTotal: offer.priceTotal,
  })
}

export function resolveCurrentAlternativeOfferCorrelation(
  message: InboundMessage,
  correlations: readonly OutboundCorrelation[],
): OutboundCorrelation | null {
  if (!message.caseId) return null
  const evidence = resolveThreadEvidence({
    inReplyTo: message.inReplyTo,
    references: message.references,
    correlations,
  })
  const matches = evidence.matches.filter((match) =>
    match.caseId === message.caseId
    && match.phase === 'ALTERNATIVE_SUPPLY_REQUEST'
    && !match.superseded
    && emailsMatch(match.recipientEmail, message.senderEmail),
  )
  if (matches.length !== 1) return null
  return correlations.find((entry) => entry.rfcMessageId === matches[0].rfcMessageId) ?? null
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sum(values: Array<{ quantity: number }>): number {
  return values.reduce((total, value) => total + value.quantity, 0)
}

function normalizeCommitments<T extends { quantity: number; date: string }>(commitments: readonly T[]): T[] {
  return [...commitments].sort((left, right) => left.date.localeCompare(right.date) || left.quantity - right.quantity)
}

function onTimePrimaryQuantity(supplyCase: SupplyCase): number {
  const proposal = supplyCase.supplier1Proposal
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return 0
  const deliveries = (proposal as { deliveries?: unknown }).deliveries
  if (!Array.isArray(deliveries)) return 0
  return sum(deliveries.filter((delivery): delivery is { quantity: number; deliveryDate: string } => {
    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) return false
    const value = delivery as Record<string, unknown>
    return typeof value.quantity === 'number' && typeof value.deliveryDate === 'string' && value.deliveryDate.slice(0, 10) <= supplyCase.requiredDate.slice(0, 10)
  }))
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export type { StoreScope }
