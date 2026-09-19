import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { buildFixtureIds } from '../data/fixtures'
import { buildSupplyCaseDetail, buildSupplyCaseList, parseSupplyCaseListQuery } from '../data/read-model'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import { validateAlternativeOffer } from '../lib/resolution/offer'
import { buildResolutionPlans } from '../lib/resolution/plans'

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

describe('supply_cases read models', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-read-model-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('returns a scoped paginated queue with derived partial coverage', async () => {
    const seeded = await store.seedScenario(scopeA)
    await store.seedScenario(scopeB)
    await store.productionPlans.update(scopeA, seeded.productionPlan.id, {
      internalStockQuantity: 0,
      supplierCommitments: [
        {
          supplierEmail: 'supplier@hackon-om-wro.cloud',
          quantity: 300,
          deliveryDate: '2026-09-16T12:00:00.000Z',
          status: 'COMMITTED',
        },
        {
          supplierEmail: 'supplier@hackon-om-wro.cloud',
          quantity: 200,
          deliveryDate: '2026-09-18T12:00:00.000Z',
          status: 'COMMITTED',
        },
      ],
    })

    const result = await buildSupplyCaseList(
      store,
      scopeA,
      parseSupplyCaseListQuery(new URLSearchParams({ q: 'PO-1001', riskStatus: 'AT_RISK', pageSize: '1' })),
    )

    expect(result).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 })
    expect(result.items[0]).toMatchObject({
      correlationId: 'SC-001',
      sku: 'MAT-42',
      planNumber: 'PP-2001',
      coverage: { coveredQuantity: 300, missingQuantity: 200, riskStatus: 'AT_RISK' },
    })
    expect(result.items[0].productionOrders).toEqual([
      { id: buildFixtureIds(scopeA).productionOrder, orderNumber: 'PO-1001' },
    ])
    expect(result.items[0]).toMatchObject({
      baselineCoverage: { coveredQuantity: 300, requiredQuantity: 500 },
      liveCoverage: { coveredQuantity: 300, requiredQuantity: 500 },
      shortage: 200,
      customerImpact: 'at_risk',
      affectedOrderCount: 1,
      nextAction: 'none',
      dataQuality: 'complete',
    })
  })

  it('does not expose another tenant or organization through the list projection', async () => {
    await store.seedScenario(scopeA)
    await store.seedScenario(scopeB)

    const result = await buildSupplyCaseList(
      store,
      scopeA,
      parseSupplyCaseListQuery(new URLSearchParams()),
    )

    expect(result.total).toBe(1)
    expect(result.items[0].id).toBe(buildFixtureIds(scopeA).supplyCase)
  })

  it('redacts message content without messages.view and keeps raw body out of the projection', async () => {
    const seeded = await store.seedScenario(scopeA)

    const redacted = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)
    const permitted = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, true)

    expect(redacted?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message', senderEmail: null, recipientEmail: null, body: null }),
    ]))
    expect(permitted?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        senderEmail: 'supplier@hackon-om-wro.cloud',
        body: expect.stringContaining('300'),
      }),
    ]))
    expect(JSON.stringify(permitted)).not.toContain('Potwierdzamy zamowienie 500')
  })

  it('returns explicit degraded state when the related plan is missing', async () => {
    const seeded = await store.seedScenario(scopeA)
    await store.productionPlans.softDelete(scopeA, seeded.productionPlan.id)

    const result = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)

    expect(result).toMatchObject({ productionPlan: null, coverage: null })
    expect(result?.case.productionPlanId).toBe(seeded.productionPlan.id)
    expect(result?.dataQuality).toBe('degraded')
    expect(result?.dataQualityReasons).toContain('missing_plan')
    expect(result?.resolutionGate.isGreen).toBe(false)
  })

  it('projects the need, PO/customer impact and split Supplier 1 reality without false baseline success', async () => {
    const seeded = await store.seedScenario(scopeA)

    const result = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)

    expect(result).toMatchObject({
      need: { sku: 'MAT-42', requiredQuantity: 500, requiredDate: '2026-09-16T12:00:00.000Z' },
      baseline: { planNumber: 'PP-2001', coverage: { coveredQuantity: 500, riskStatus: 'PROTECTED' } },
      liveReality: { onTimeQuantity: 300, lateQuantity: 200, missingQuantity: 200, riskStatus: 'AT_RISK' },
      liveCoverage: { coveredQuantity: 300, missingQuantity: 200, riskStatus: 'AT_RISK' },
      customerImpact: { customerName: 'Acme Industries', commitmentDate: '2026-09-18T12:00:00.000Z', status: 'at_risk' },
    })
    expect(result?.productionOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderNumber: 'PO-1001', customerCommitmentDate: '2026-09-18T12:00:00.000Z' }),
    ]))
    expect(result?.suppliers[0].offerLines).toEqual([
      expect.objectContaining({ quantity: 300, onTime: true }),
      expect.objectContaining({ quantity: 200, onTime: false }),
    ])
    expect(result?.resolutionGate.isGreen).toBe(false)
  })

  it('projects Supplier 2 offer and exactly three plans without selecting one', async () => {
    const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })
    const correlation = seeded.outboundCorrelations[0]
    const offerResult = validateAlternativeOffer(seeded.supplyCase, correlation, {
      supplierId: 'supplier2@hackon-om-wro.cloud',
      sku: 'MAT-42',
      sourceInboundMessageId: 'offer-message-1',
      sourceRfcMessageId: 'offer-1@example.com',
      sourceOutboundCorrelationId: correlation.id,
      requestedQuantity: 200,
      offeredQuantity: 200,
      commitments: [{ quantity: 200, date: '2026-09-16' }],
      priceTotal: { amount: 1400, currency: 'PLN' },
      recordedAt: '2026-09-14T14:00:00.000Z',
    })
    if (!offerResult.ok) throw new Error('fixture offer should validate')
    const caseWithOffer = { ...seeded.supplyCase, alternativeOffer: offerResult.offer }
    const analysis = buildResolutionPlans({ supplyCase: caseWithOffer, productionPlan: seeded.productionPlan, offer: offerResult.offer })
    await store.supplyCases.update(scopeA, seeded.supplyCase.id, {
      alternativeOffer: offerResult.offer,
      finalAnalysis: { schemaVersion: 1, finalFactsHash: analysis.finalFactsHash, offerHash: offerResult.offer.offerHash, facts: analysis.facts, plans: analysis.plans, recordedAt: '2026-09-14T14:00:00.000Z' },
      resolutionPlans: analysis.plans,
    })

    const result = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)

    expect(result?.suppliers[1].offerLines).toEqual([
      expect.objectContaining({ quantity: 200, price: 1400, currency: 'PLN', onTime: true }),
    ])
    expect(result?.proposals.resolutionPlans.map((plan) => plan.id)).toEqual(['ACCEPT_DELAY', 'USE_STOCK', 'USE_ALTERNATIVE'])
    expect(result?.proposals.selectedResolutionPlanId).toBeNull()
    expect(result?.confirmationChecklist).toEqual([])
  })

  it('keeps the gate non-green after one confirmation and green only after the complete server-side join', async () => {
    const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })
    const correlation = seeded.outboundCorrelations[0]
    const offerResult = validateAlternativeOffer(seeded.supplyCase, correlation, {
      supplierId: 'supplier2@hackon-om-wro.cloud', sku: 'MAT-42', sourceInboundMessageId: 'offer-message-1', sourceRfcMessageId: 'offer-1@example.com', sourceOutboundCorrelationId: correlation.id,
      requestedQuantity: 200, offeredQuantity: 200, commitments: [{ quantity: 200, date: '2026-09-16' }], priceTotal: { amount: 1400, currency: 'PLN' }, recordedAt: '2026-09-14T14:00:00.000Z',
    })
    if (!offerResult.ok) throw new Error('fixture offer should validate')
    const analysis = buildResolutionPlans({ supplyCase: { ...seeded.supplyCase, alternativeOffer: offerResult.offer }, productionPlan: seeded.productionPlan, offer: offerResult.offer })
    const plan = analysis.plans.find((entry) => entry.id === 'USE_ALTERNATIVE')
    if (!plan) throw new Error('fixture resolution plan should exist')
    const pendingPlan = {
      planId: plan.id,
      planHash: plan.planHash,
      supplierCommitments: [
        { role: 'SUPPLIER_1' as const, supplierEmail: seeded.supplyCase.supplier1Email as string, quantity: 300, deliveryDate: '2026-09-16T12:00:00.000Z', intent: 'COMMIT' as const },
        { role: 'SUPPLIER_2' as const, supplierEmail: seeded.supplyCase.supplier2Email as string, quantity: 200, deliveryDate: '2026-09-16T12:00:00.000Z', intent: 'COMMIT' as const },
      ],
      internalStockAllocation: 0,
      requiredConfirmations: ['SUPPLIER_1' as const, 'SUPPLIER_2' as const],
      additionalCost: 1400,
    }
    await store.supplyCases.update(scopeA, seeded.supplyCase.id, { alternativeOffer: offerResult.offer, resolutionPlans: analysis.plans, selectedResolutionPlanId: plan.id, pendingResolutionPlan: pendingPlan, status: 'WAITING_FOR_SUPPLIER_CONFIRMATIONS' })

    const waiting = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)
    expect(waiting?.liveCoverage).toMatchObject({ coveredQuantity: 300, missingQuantity: 200, riskStatus: 'AT_RISK' })
    expect(waiting?.resolutionGate.isGreen).toBe(false)

    const confirmationInput = (role: 'SUPPLIER_1' | 'SUPPLIER_2', email: string, messageId: string, quantity: number) => ({
      caseId: seeded.supplyCase.id,
      planId: plan.id,
      planHash: plan.planHash,
      role,
      supplierEmail: email,
      inboundMessageId: messageId,
      rfcMessageId: `${messageId}@example.com`,
      confirmedCommitments: [{ quantity, date: '2026-09-16' }],
      verdict: 'MATCHES_PLAN' as const,
      mismatchReasons: [],
      idempotencyKey: `${seeded.supplyCase.id}:${plan.planHash}:${role}`,
    })
    await store.supplyConfirmations.recordAndEvaluate(scopeA, confirmationInput('SUPPLIER_1', seeded.supplyCase.supplier1Email as string, 'confirmation-1', 300), pendingPlan.requiredConfirmations)

    const partial = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)
    expect(partial?.confirmationChecklist.map((item) => item.status)).toEqual(['confirmed', 'pending'])
    expect(partial?.liveCoverage).toMatchObject({ coveredQuantity: 300, missingQuantity: 200, riskStatus: 'AT_RISK' })
    expect(partial?.resolutionGate.confirmationsComplete).toBe(false)
    expect(partial?.resolutionGate.isGreen).toBe(false)

    await store.supplyConfirmations.recordAndEvaluate(scopeA, confirmationInput('SUPPLIER_2', seeded.supplyCase.supplier2Email as string, 'confirmation-2', 200), pendingPlan.requiredConfirmations)
    await store.supplyCases.update(scopeA, seeded.supplyCase.id, { status: 'RESOLVED', resolvedAt: '2026-09-16T13:00:00.000Z' })
    const complete = await buildSupplyCaseDetail(store, scopeA, seeded.supplyCase.id, false)
    expect(complete?.resolutionGate).toMatchObject({ coveredOnTime: 500, missingQuantity: 0, confirmationsComplete: true, planApplicable: true, riskStatus: 'PROTECTED', isGreen: true })
  })
})
