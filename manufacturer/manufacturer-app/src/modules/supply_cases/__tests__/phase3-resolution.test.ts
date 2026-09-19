import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { AlternativeOfferConflictError, RecordNotFoundError } from '../data/errors'
import { createJsonSupplyCasesStore } from '../data/json/store'
import type { StoreScope } from '../data/repositories'
import { buildResolutionPlans } from '../lib/resolution/plans'
import { resolveCurrentAlternativeOfferCorrelation, validateAlternativeOffer } from '../lib/resolution/offer'
import type { InboundMessage, OutboundCorrelation, ProductionPlan, SupplyCase } from '../data/types'

const supplyCase = {
  id: 'case-1', tenantId: 'tenant-1', organizationId: 'org-1', correlationId: 'SC-001', status: 'WAITING_FOR_ALTERNATIVE_OFFER',
  needsAttentionReason: null, sku: 'MAT-42', requiredQuantity: 500, requiredDate: '2026-09-16T12:00:00.000Z',
  supplier1Email: 'supplier1@example.com', supplier2Email: 'supplier2@example.com', productionOrderIds: [], productionPlanId: 'plan-1',
  customerCommitmentSnapshot: { commitmentDate: '2026-09-18T12:00:00.000Z' }, originalCommitment: null,
  supplier1Proposal: { deliveries: [{ quantity: 300, deliveryDate: '2026-09-16T12:00:00.000Z' }, { quantity: 200, deliveryDate: '2026-09-18T12:00:00.000Z' }] },
  alternativeOffer: null, initialAnalysis: null, initialOptions: null, selectedInitialOptionId: null, initialProposalId: null, initialAnalyzedAt: null,
  initialFactsHash: null, initialDecisionIdempotencyKey: null, initialDecisionKind: null, initialDecisionReason: null, finalAnalysis: null, resolutionPlans: null,
  selectedResolutionPlanId: null, pendingResolutionPlan: null, estimatedAdditionalCost: null, actualAdditionalCost: null, currency: 'PLN', supplier1ConfirmedAt: null,
  supplier2ConfirmedAt: null, workflowInstanceId: 'workflow-1', resolvedAt: null, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', deletedAt: null,
} satisfies SupplyCase

const correlation = { id: 'rfq-1', tenantId: 'tenant-1', organizationId: 'org-1', caseId: 'case-1', phase: 'ALTERNATIVE_SUPPLY_REQUEST', recipientEmail: 'supplier2@example.com', rfcMessageId: 'rfq@example.com', idempotencyKey: 'key-1', createdAt: '2026-09-10T00:00:00.000Z' } satisfies OutboundCorrelation
const plan = { id: 'plan-1', tenantId: 'tenant-1', organizationId: 'org-1', planNumber: 'PP-1', materialSku: 'MAT-42', requiredQuantity: 500, requiredDate: '2026-09-16T12:00:00.000Z', internalStockQuantity: 200, supplierCommitments: [], productionOrderIds: [], riskStatus: 'AT_RISK', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', deletedAt: null } satisfies ProductionPlan

describe('Phase 3 pure resolution slices', () => {
  it('validates and canonicalizes a current full offer', () => {
    const result = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: 'supplier2@example.com', sku: 'MAT-42', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.offer.offerHash).toHaveLength(64)
  })

  it('rejects quantity, currency and invalid calendar mismatches', () => {
    const result = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: 'supplier2@example.com', sku: 'WRONG-SKU', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 100, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-02-30' }], priceTotal: { amount: 1400, currency: 'EUR' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'OFFER_INVALID' }))
  })

  it('builds exactly three plans and uses the persisted offer price', () => {
    const offer = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: 'supplier2@example.com', sku: 'MAT-42', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    if (!offer.ok) throw new Error('fixture offer should validate')
    const persistedCase = { ...supplyCase, alternativeOffer: offer.offer }
    const caseBefore = structuredClone(persistedCase)
    const planBefore = structuredClone(plan)
    const result = buildResolutionPlans({ supplyCase: persistedCase, productionPlan: plan, offer: offer.offer })
    expect(result.plans.map((entry) => entry.id)).toEqual(['ACCEPT_DELAY', 'USE_STOCK', 'USE_ALTERNATIVE'])
    expect(result.plans[2].additionalCost).toEqual({ amount: 1400, currency: 'PLN', basis: 'supplier_2_offer' })
    expect(result.plans[2].coverage.onTimeQuantity).toBe(500)
    expect(result.plans[1].supplier1Commitments).toContainEqual({ quantity: 200, date: '2026-09-18', status: 'CANCEL' })
    expect(result.plans[1].supplier2Commitments).toEqual([{ quantity: 200, date: '2026-09-16', status: 'DECLINE' }])
    expect(result.plans[1].stock).toEqual({ allocated: 200, remaining: 0 })
    expect(persistedCase).toEqual(caseBefore)
    expect(plan).toEqual(planBefore)
  })

  it('keeps the canonical offer hash stable across evidence timestamps and commitment order', () => {
    const base = {
      supplierId: 'SUPPLIER2@EXAMPLE.COM', sku: 'MAT-42', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 125, date: '2026-09-16' }, { quantity: 75, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    }
    const first = validateAlternativeOffer(supplyCase, correlation, base)
    const replay = validateAlternativeOffer(supplyCase, correlation, {
      ...base,
      commitments: [...base.commitments].reverse(),
      recordedAt: '2026-09-14T15:00:00.000Z',
    })
    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    if (first.ok && replay.ok) expect(replay.offer.offerHash).toBe(first.offer.offerHash)
  })

  it('rejects a tampered offer snapshot even when it reuses the persisted hash', () => {
    const validation = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: 'supplier2@example.com', sku: 'MAT-42', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    if (!validation.ok) throw new Error('fixture offer should validate')
    const persistedCase = { ...supplyCase, alternativeOffer: validation.offer }
    const tamperedOffer = { ...validation.offer, priceTotal: { amount: 1, currency: 'PLN' } }
    expect(() => buildResolutionPlans({ supplyCase: persistedCase, productionPlan: plan, offer: tamperedOffer })).toThrow('persisted alternative offer')
  })

  it('does not count late alternative commitments as on-time coverage', () => {
    const validation = validateAlternativeOffer(supplyCase, correlation, {
      supplierId: 'supplier2@example.com', sku: 'MAT-42', sourceInboundMessageId: 'message-1', sourceRfcMessageId: 'offer@example.com', sourceOutboundCorrelationId: 'rfq-1',
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 100, date: '2026-09-16' }, { quantity: 100, date: '2026-09-18' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    if (!validation.ok) throw new Error('fixture offer should validate')
    const result = buildResolutionPlans({ supplyCase: { ...supplyCase, alternativeOffer: validation.offer }, productionPlan: plan, offer: validation.offer })
    const alternative = result.plans.find((entry) => entry.id === 'USE_ALTERNATIVE')
    expect(alternative).toEqual(expect.objectContaining({
      feasibility: 'INFEASIBLE',
      coverage: expect.objectContaining({ onTimeQuantity: 400, shortage: 100 }),
    }))
  })

  it('accepts only the current Supplier 2 RFQ reply-chain anchor', () => {
    const message = {
      id: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', caseId: 'case-1', rfcMessageId: 'offer@example.com', correlationId: 'SC-001',
      inReplyTo: correlation.rfcMessageId, references: [], messageIntent: 'ALTERNATIVE_SUPPLY_OFFER', senderEmail: 'supplier2@example.com', recipientEmail: 'buyer@example.com',
      payload: null, rawBody: null, sanitizedBody: null, extraction: null, extractionConfidence: null, triageDisposition: null, triageOutcome: null,
      candidateIndexes: [], needsAttention: false, providerMessageId: null, failureReason: null, receivedAt: null, createdAt: '2026-09-11T00:00:00.000Z',
    } satisfies InboundMessage
    expect(resolveCurrentAlternativeOfferCorrelation(message, [correlation])).toEqual(correlation)
    const newer = { ...correlation, id: 'acceptance-1', phase: 'SUPPLY_ACCEPTANCE' as const, rfcMessageId: 'acceptance@example.com', createdAt: '2026-09-12T00:00:00.000Z' }
    expect(resolveCurrentAlternativeOfferCorrelation(message, [correlation, newer])).toBeNull()
  })

  it('records one offer atomically and makes replay/conflict outcomes explicit', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-resolution-'))
    const scope: StoreScope = { tenantId: 'tenant-cas', organizationId: 'org-cas' }
    try {
      const store = createJsonSupplyCasesStore({ dataDir })
      const seeded = await store.resetScenario(scope, { includeAlternativeOffer: true })
      const correlation = seeded.outboundCorrelations[0]
      const validation = validateAlternativeOffer(seeded.supplyCase, correlation, {
        supplierId: 'supplier2@hackon-om-wro.cloud', sku: seeded.supplyCase.sku, sourceInboundMessageId: 'offer-1', sourceRfcMessageId: 'offer-1@example.com', sourceOutboundCorrelationId: correlation.id,
        requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
      })
      if (!validation.ok) throw new Error('fixture offer should validate')
      const competing = validateAlternativeOffer(seeded.supplyCase, correlation, {
        supplierId: 'supplier2@hackon-om-wro.cloud', sku: seeded.supplyCase.sku, sourceInboundMessageId: 'offer-2', sourceRfcMessageId: 'offer-2@example.com', sourceOutboundCorrelationId: correlation.id,
        requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1500, currency: 'PLN' }, recordedAt: '2026-09-14T14:01:00.000Z',
      })
      if (!competing.ok) throw new Error('competing fixture offer should validate')
      const race = await Promise.allSettled([
        store.supplyCases.recordAlternativeOfferIfAbsent(scope, seeded.supplyCase.id, seeded.supplyCase.updatedAt, validation.offer),
        store.supplyCases.recordAlternativeOfferIfAbsent(scope, seeded.supplyCase.id, seeded.supplyCase.updatedAt, competing.offer),
      ])
      expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const rejected = race.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(rejected?.reason).toBeInstanceOf(AlternativeOfferConflictError)
      const persisted = await store.supplyCases.requireById(scope, seeded.supplyCase.id)
      if (!persisted.alternativeOffer) throw new Error('race winner should be persisted')
      const replay = await store.supplyCases.recordAlternativeOfferIfAbsent(scope, seeded.supplyCase.id, 'stale-version', persisted.alternativeOffer)
      expect(replay.status).toBe('already_recorded')
      await expect(store.supplyCases.recordAlternativeOfferIfAbsent(scope, seeded.supplyCase.id, 'stale-version', { ...validation.offer, sourceInboundMessageId: 'offer-2', offerHash: 'different' })).rejects.toBeInstanceOf(AlternativeOfferConflictError)
      await expect(store.supplyCases.recordAlternativeOfferIfAbsent(
        { tenantId: scope.tenantId, organizationId: 'other-org' },
        seeded.supplyCase.id,
        seeded.supplyCase.updatedAt,
        validation.offer,
      )).rejects.toBeInstanceOf(RecordNotFoundError)
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true })
    }
  })
})
