import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJsonSupplyCasesStore } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import { initialImpactAdvisorResultSchema } from '../data/initial-impact'
import { runInitialImpactAdvisor } from '../lib/impact/runInitialImpactAdvisor'

describe('supply cases initial impact', () => {
  let dataDir: string
  let store: SupplyCasesStore
  const scope: StoreScope = { tenantId: 'tenant-impact', organizationId: 'org-impact' }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-impact-'))
    store = createJsonSupplyCasesStore({ dataDir })
    const order = await store.productionOrders.create(scope, {
      orderNumber: 'PO-IMPACT-1',
      productSku: 'FG-1',
      quantity: 1,
      materialSku: 'MAT-42',
      materialQuantity: 500,
      dueDate: '2026-09-23T12:00:00.000Z',
      customerName: 'Acme',
      customerCommitmentDate: '2026-09-24T12:00:00.000Z',
      status: 'RELEASED',
    })
    const plan = await store.productionPlans.create(scope, {
      planNumber: 'PP-IMPACT-1',
      materialSku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
      internalStockQuantity: 200,
      productionOrderIds: [order.id],
    })
    await store.supplyCases.create(scope, {
      id: 'case-impact-1',
      correlationId: 'SC-IMPACT-1',
      status: 'RECEIVED',
      sku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
      supplier1Email: 'supplier1@example.com',
      supplier2Email: 'supplier2@example.com',
      productionPlanId: plan.id,
      productionOrderIds: [order.id],
      supplier1Proposal: {
        sku: 'MAT-42',
        deliveries: [
          { quantity: 300, deliveryDate: '2026-09-23T12:00:00.000Z' },
          { quantity: 200, deliveryDate: '2026-09-25T12:00:00.000Z' },
        ],
      },
    })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('computes the reference shortage and Friday customer breach', async () => {
    const loaded = await loadInitialImpactSnapshot(store, scope, 'case-impact-1')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const impact = calculateInitialImpact(loaded.snapshot)
    expect(impact).toMatchObject({
      onTimePrimaryQuantity: 300,
      latePrimaryQuantity: 200,
      coverageWithoutStock: 300,
      shortageWithoutStock: 200,
      coverageWithStock: 500,
      shortageAfterStock: 0,
      customerDeadlineStatus: 'BREACHED',
    })
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    expect(options.map((option) => option.id)).toEqual([
      'ACCEPT_PRIMARY_DELAY',
      'USE_INTERNAL_STOCK',
      'CHECK_ALTERNATIVE_SUPPLIER',
    ])
    expect(options[0].feasibility).toBe('INFEASIBLE')
    expect(options[1].stockRemaining).toBe(0)
    expect(options[2].supply.find((supply) => supply.source === 'SUPPLIER_2')?.quantity).toBe(200)
  })

  it('fails closed when the advisor changes facts or evidence references', async () => {
    const loaded = await loadInitialImpactSnapshot(store, scope, 'case-impact-1')
    if (!loaded.ok) throw new Error('fixture did not load')
    const impact = calculateInitialImpact(loaded.snapshot)
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    const input = {
      schemaVersion: 1 as const,
      caseRef: { correlationId: 'SC-IMPACT-1', sku: 'MAT-42', status: 'ANALYZING_INITIAL_IMPACT' as const },
      factsHash: options[0].factsHash,
      demand: { requiredQuantity: 500, requiredDate: '2026-09-23T12:00:00.000Z', productionOrders: [] },
      primaryProposal: { supplierEmail: 'supplier1@example.com', deliveries: loaded.snapshot.supplier1Deliveries },
      stock: { availableQuantity: 200, sourceUpdatedAt: loaded.snapshot.stockUpdatedAt },
      impact,
      options,
      unresolved: [],
    }
    const validResult = initialImpactAdvisorResultSchema.parse({
      schemaVersion: 1,
      factsHash: input.factsHash,
      summary: 'Supplier 1 misses the customer deadline unless stock or an alternative is used.',
      optionAssessments: options.map((option) => ({
        optionId: option.id,
        consequenceSummary: option.id,
        whyGood: ['Evidence-backed path.'],
        whyBad: ['Has a known trade-off.'],
        evidenceRefs: ['impact.shortageWithoutStock'],
      })),
      recommendedOptionId: 'CHECK_ALTERNATIVE_SUPPLIER',
      confidence: 0.9,
      unresolved: [],
    })
    const mismatch = await runInitialImpactAdvisor(input, async () => ({ ...validResult, factsHash: 'changed' }))
    expect(mismatch).toMatchObject({ ok: false, reason: 'FACTS_HASH_MISMATCH' })
    const unknownEvidence = await runInitialImpactAdvisor(input, async () => ({
      ...validResult,
      optionAssessments: validResult.optionAssessments.map((assessment) => ({ ...assessment, evidenceRefs: ['invented.fact'] })),
    }))
    expect(unknownEvidence).toMatchObject({ ok: false, reason: 'SCHEMA_INVALID' })
  })
})
