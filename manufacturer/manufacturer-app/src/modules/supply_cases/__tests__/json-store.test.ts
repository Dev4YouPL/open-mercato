import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { calculatePlanCoverage } from '../data/coverage'
import {
  AppendOnlyViolationError,
  DuplicateRfcMessageIdError,
  DuplicateRecordKeyError,
  RecordNotFoundError,
  ScopeMismatchError,
  StoreFileCorruptedError,
} from '../data/errors'
import { buildFixtureIds } from '../data/fixtures'
import type { SupplyCasesStore, StoreScope } from '../data/repositories'
import { writeFileAtomically, type AtomicWriter } from '../data/json/collection'
import { createJsonSupplyCasesStore, STORE_FILE_NAMES, type StoreClock } from '../data/json/store'
import type {
  InboundMessageAppendInput,
  OutboundCorrelationRecordInput,
  ProductionOrderCreateInput,
} from '../data/types'
import { buildOutboundIdempotencyKey } from '../lib/outbound/correlationKey'

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
const sameTenantOtherOrg: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-z' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

function orderInput(overrides: Partial<ProductionOrderCreateInput> = {}): ProductionOrderCreateInput {
  return {
    orderNumber: 'PO-9000',
    productSku: 'FG-1',
    quantity: 10,
    materialSku: 'MAT-42',
    materialQuantity: 100,
    dueDate: '2026-09-16T12:00:00.000Z',
    customerName: 'Test Customer',
    customerCommitmentDate: '2026-09-18T12:00:00.000Z',
    ...overrides,
  }
}

function messageInput(overrides: Partial<InboundMessageAppendInput> = {}): InboundMessageAppendInput {
  return {
    rfcMessageId: '<proposal-1@supplier.example>',
    senderEmail: 'supplier@hackon-om-wro.cloud',
    recipientEmail: 'manufacturer@hackon-om-wro.cloud',
    ...overrides,
  }
}

describe('supply_cases JSON store', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  describe('seeding', () => {
    it('creates deterministic records for all four types', async () => {
      const ids = buildFixtureIds(scopeA)
      const seeded = await store.resetScenario(scopeA, { includeAlternativeOffer: true })

      expect(seeded.productionOrder.id).toBe(ids.productionOrder)
      expect(seeded.productionPlan.id).toBe(ids.productionPlan)
      expect(seeded.supplyCase.id).toBe(ids.supplyCase)
      expect(seeded.inboundMessages.map((message) => message.id)).toEqual([
        ids.supplyProposalMessage,
        ids.alternativeOfferMessage,
      ])
      expect(seeded.supplyCase.correlationId).toBe('SC-001')
      expect(seeded.supplyCase.currency).toBe('PLN')
      expect(seeded.outboundCorrelations.map((correlation) => correlation.id)).toEqual([
        ids.alternativeRequestCorrelation,
      ])
    })

    it('is idempotent across repeated resets', async () => {
      const first = await store.resetScenario(scopeA)
      const second = await store.resetScenario(scopeA)

      expect(second.supplyCase.id).toBe(first.supplyCase.id)
      await expect(store.supplyCases.list(scopeA)).resolves.toHaveLength(1)
      await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    })

    it('leaves other scopes untouched when resetting', async () => {
      await store.seedScenario(scopeB)
      await store.resetScenario(scopeA)

      await expect(store.supplyCases.list(scopeB)).resolves.toHaveLength(1)
      await expect(store.inboundMessages.list(scopeB)).resolves.toHaveLength(1)
    })
  })

  describe('persistence', () => {
    it('reads records written by a previous store instance', async () => {
      const created = await store.productionOrders.create(scopeA, orderInput())

      const restarted = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
      await expect(restarted.productionOrders.findById(scopeA, created.id)).resolves.toEqual(created)
    })

    it('survives a restart for every collection', async () => {
      const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })

      const restarted = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
      await expect(restarted.productionOrders.list(scopeA)).resolves.toHaveLength(1)
      await expect(restarted.productionPlans.list(scopeA)).resolves.toHaveLength(1)
      await expect(restarted.supplyCases.findByCorrelationId(scopeA, 'SC-001')).resolves.toEqual(seeded.supplyCase)
      await expect(restarted.inboundMessages.list(scopeA)).resolves.toHaveLength(2)
    })
  })

  describe('scope isolation', () => {
    it('hides records of another tenant and another organization', async () => {
      const created = await store.productionOrders.create(scopeA, orderInput())

      await expect(store.productionOrders.findById(scopeB, created.id)).resolves.toBeNull()
      await expect(store.productionOrders.findById(sameTenantOtherOrg, created.id)).resolves.toBeNull()
      await expect(store.productionOrders.list(scopeB)).resolves.toEqual([])
      await expect(store.productionOrders.findByOrderNumber(scopeB, 'PO-9000')).resolves.toBeNull()
    })

    it('hides cases and messages of another scope from lookup helpers', async () => {
      await store.seedScenario(scopeA)

      await expect(store.supplyCases.findByCorrelationId(scopeB, 'SC-001')).resolves.toBeNull()
      const ids = buildFixtureIds(scopeA)
      await expect(
        store.inboundMessages.findByRfcMessageId(scopeB, ids.supplyProposalRfcMessageId),
      ).resolves.toBeNull()
      await expect(store.inboundMessages.findById(scopeB, ids.supplyProposalMessage)).resolves.toBeNull()
    })

    it('allows the same business identifiers in two different scopes', async () => {
      await store.productionOrders.create(scopeA, orderInput())
      await expect(store.productionOrders.create(scopeB, orderInput())).resolves.toMatchObject({
        orderNumber: 'PO-9000',
        tenantId: 'tenant-b',
      })
    })

    it('rejects reusing an explicit id that belongs to another scope', async () => {
      await store.productionOrders.create(scopeA, orderInput({ id: 'shared-id' }))

      await expect(
        store.productionOrders.create(scopeB, orderInput({ id: 'shared-id', orderNumber: 'PO-9001' })),
      ).rejects.toBeInstanceOf(ScopeMismatchError)
    })

    it('refuses to update a record from another scope', async () => {
      const created = await store.productionOrders.create(scopeA, orderInput())

      await expect(store.productionOrders.update(scopeB, created.id, { status: 'AT_RISK' })).rejects.toBeInstanceOf(
        RecordNotFoundError,
      )
    })
  })

  describe('uniqueness', () => {
    it('rejects a duplicate orderNumber inside the scope', async () => {
      await store.productionOrders.create(scopeA, orderInput())

      await expect(store.productionOrders.create(scopeA, orderInput())).rejects.toBeInstanceOf(DuplicateRecordKeyError)
    })

    it('rejects a duplicate correlationId inside the scope', async () => {
      await store.seedScenario(scopeA)

      await expect(
        store.supplyCases.create(scopeA, {
          correlationId: 'SC-001',
          sku: 'MAT-42',
          requiredQuantity: 500,
          requiredDate: '2026-09-16T12:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(DuplicateRecordKeyError)
    })
  })

  describe('inbound messages', () => {
    it('rejects a duplicate rfcMessageId on append', async () => {
      await store.inboundMessages.append(scopeA, messageInput())

      await expect(store.inboundMessages.append(scopeA, messageInput())).rejects.toBeInstanceOf(
        DuplicateRfcMessageIdError,
      )
      await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    })

    it('returns the existing message from appendIfAbsent without creating a second one', async () => {
      const first = await store.inboundMessages.appendIfAbsent(scopeA, messageInput())
      const replay = await store.inboundMessages.appendIfAbsent(scopeA, messageInput())

      expect(first.created).toBe(true)
      expect(replay.created).toBe(false)
      expect(replay.message.id).toBe(first.message.id)
      await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    })

    it('deduplicates concurrent replays of the same rfcMessageId', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => store.inboundMessages.appendIfAbsent(scopeA, messageInput())),
      )

      expect(results.filter((entry) => entry.created)).toHaveLength(1)
      await expect(store.inboundMessages.list(scopeA)).resolves.toHaveLength(1)
    })

    it('exposes no update or delete on the contract and guards untyped callers', () => {
      const repository = store.inboundMessages as unknown as { update: () => never; delete: () => never }

      expect(() => repository.update()).toThrow(AppendOnlyViolationError)
      expect(() => repository.delete()).toThrow(AppendOnlyViolationError)
    })

    it('fills contract defaults for an appended message', async () => {
      const message = await store.inboundMessages.append(scopeA, messageInput())

      // Nothing has classified the message yet, so no field may claim it has.
      expect(message.messageIntent).toBeNull()
      expect(message.caseId).toBeNull()
      expect(message.payload).toBeNull()
      expect(message.inReplyTo).toBeNull()
      expect(message.references).toEqual([])
      expect(message.rawBody).toBeNull()
      expect(message.sanitizedBody).toBeNull()
      expect(message.extraction).toBeNull()
      expect(message.extractionConfidence).toBeNull()
      expect(message.triageDisposition).toBeNull()
    })

    it('keeps the same rfcMessageId reachable in two scopes without merging them', async () => {
      const first = await store.inboundMessages.append(scopeA, messageInput())
      const second = await store.inboundMessages.append(scopeB, messageInput())

      expect(second.id).not.toBe(first.id)
      await expect(store.inboundMessages.findByRfcMessageId(scopeA, first.rfcMessageId)).resolves.toMatchObject({
        id: first.id,
      })
      await expect(store.inboundMessages.findByRfcMessageId(scopeB, first.rfcMessageId)).resolves.toMatchObject({
        id: second.id,
      })
      await expect(store.inboundMessages.findByRfcMessageId(sameTenantOtherOrg, first.rfcMessageId)).resolves.toBeNull()
    })

    it('keeps caseId null until triage links the message to a case', async () => {
      const message = await store.inboundMessages.append(scopeA, messageInput())

      expect(message.caseId).toBeNull()
      expect(message.correlationId).toBeNull()
      expect(message.triageDisposition).toBeNull()
    })

    it('keeps the quoted history in rawBody and only the new text in sanitizedBody', async () => {
      const message = await store.inboundMessages.append(
        scopeA,
        messageInput({
          rawBody: 'W srode tylko 300 sztuk.\n\n> Potwierdzamy 500 sztuk na srode.',
          sanitizedBody: 'W srode tylko 300 sztuk.',
        }),
      )

      expect(message.rawBody).toContain('Potwierdzamy 500 sztuk')
      expect(message.sanitizedBody).toBe('W srode tylko 300 sztuk.')
    })

    it('accepts an UNRELATED classification once triage has run', async () => {
      const message = await store.inboundMessages.append(
        scopeA,
        messageInput({ messageIntent: 'UNRELATED', triageDisposition: 'QUARANTINED' }),
      )

      expect(message.messageIntent).toBe('UNRELATED')
      expect(message.caseId).toBeNull()
    })

    it('stores a validated extraction alongside the message', async () => {
      const message = await store.inboundMessages.append(
        scopeA,
        messageInput({
          messageIntent: 'SUPPLY_PROPOSAL',
          sanitizedBody: 'W srode tylko 300 sztuk.',
          extractionConfidence: 0.86,
          triageDisposition: 'AUTO_APPLIED',
          extraction: {
            intent: 'SUPPLY_PROPOSAL',
            correlation: { kind: 'NEW_CASE', candidateIndex: null },
            sku: 'MAT-42',
            commitments: [{ quantity: 300, date: '2026-09-23' }],
            price: null,
            confidence: 0.86,
            unresolved: [],
            rationale: 'Supplier states Wednesday delivery drops to 300.',
          },
        }),
      )

      expect(message.extraction).toMatchObject({ intent: 'SUPPLY_PROPOSAL', sku: 'MAT-42' })
      expect(message.triageDisposition).toBe('AUTO_APPLIED')
    })

    it('refuses an extraction that violates the inbound contract', async () => {
      await expect(
        store.inboundMessages.append(
          scopeA,
          messageInput({
            extraction: {
              intent: 'UNRELATED',
              correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
              sku: null,
              commitments: [],
              price: null,
              confidence: 0.2,
              unresolved: [],
              rationale: 'Marketing newsletter.',
            },
          }),
        ),
      ).rejects.toThrow()
    })
  })

  describe('outbound correlations', () => {
    function correlationInput(overrides: Partial<OutboundCorrelationRecordInput> = {}): OutboundCorrelationRecordInput {
      const caseId = overrides.caseId ?? 'case-1'
      const phase = overrides.phase ?? 'ALTERNATIVE_SUPPLY_REQUEST'
      const recipientEmail = overrides.recipientEmail ?? 'supplier2@hackon-om-wro.cloud'
      return {
        caseId,
        phase,
        recipientEmail,
        rfcMessageId: 'request-1@manufacturer.example',
        idempotencyKey: buildOutboundIdempotencyKey(caseId, phase, recipientEmail),
        ...overrides,
      }
    }

    it('reuses the anchor when a send is retried under the same idempotency key', async () => {
      const first = await store.outboundCorrelations.recordIfAbsent(scopeA, correlationInput())
      const retry = await store.outboundCorrelations.recordIfAbsent(scopeA, correlationInput())

      expect(first.created).toBe(true)
      expect(retry.created).toBe(false)
      expect(retry.correlation.id).toBe(first.correlation.id)
      await expect(store.outboundCorrelations.list(scopeA)).resolves.toHaveLength(1)
    })

    it('refuses to attribute one sent Message-ID to two phases', async () => {
      await store.outboundCorrelations.record(scopeA, correlationInput())

      await expect(
        store.outboundCorrelations.recordIfAbsent(scopeA, correlationInput({ phase: 'SUPPLY_ACCEPTANCE' })),
      ).rejects.toBeInstanceOf(DuplicateRecordKeyError)
    })

    it('records the same send for two scopes without merging them', async () => {
      const inA = await store.outboundCorrelations.record(scopeA, correlationInput())
      const inB = await store.outboundCorrelations.record(scopeB, correlationInput())

      expect(inB.id).not.toBe(inA.id)
      await expect(
        store.outboundCorrelations.findByRfcMessageId(sameTenantOtherOrg, inA.rfcMessageId),
      ).resolves.toBeNull()
      await expect(store.outboundCorrelations.findByIdempotencyKey(scopeB, inA.idempotencyKey)).resolves.toMatchObject(
        { id: inB.id },
      )
    })

    it('rejects an unknown phase before it reaches disk', async () => {
      const broken = correlationInput({ phase: 'NOT_A_PHASE' as 'SUPPLY_ACCEPTANCE' })

      await expect(store.outboundCorrelations.record(scopeA, broken)).rejects.toThrow()
      await expect(store.outboundCorrelations.list(scopeA)).resolves.toEqual([])
    })

    it('survives a restart', async () => {
      await store.outboundCorrelations.record(scopeA, correlationInput())

      const restarted = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
      await expect(
        restarted.outboundCorrelations.findByRfcMessageId(scopeA, 'request-1@manufacturer.example'),
      ).resolves.not.toBeNull()
    })

    it('exposes no update or delete on the contract and guards untyped callers', () => {
      const repository = store.outboundCorrelations as unknown as { update: () => never; delete: () => never }

      expect(() => repository.update()).toThrow(AppendOnlyViolationError)
      expect(() => repository.delete()).toThrow(AppendOnlyViolationError)
    })
  })

  describe('updates and soft delete', () => {
    it('applies a partial patch without clearing untouched fields', async () => {
      const created = await store.supplyCases.create(scopeA, {
        correlationId: 'SC-100',
        sku: 'MAT-42',
        requiredQuantity: 500,
        requiredDate: '2026-09-16T12:00:00.000Z',
        supplier1Email: 'supplier@hackon-om-wro.cloud',
      })

      const updated = await store.supplyCases.update(scopeA, created.id, {
        status: 'AWAITING_SOURCING_DECISION',
      })

      expect(updated.status).toBe('AWAITING_SOURCING_DECISION')
      expect(updated.supplier1Email).toBe('supplier@hackon-om-wro.cloud')
      expect(updated.correlationId).toBe('SC-100')
      expect(updated.updatedAt).not.toBe(created.updatedAt)
      expect(updated.createdAt).toBe(created.createdAt)
    })

    it('rejects updating a record that does not exist', async () => {
      await expect(store.supplyCases.update(scopeA, 'missing', { status: 'RESOLVED' })).rejects.toBeInstanceOf(
        RecordNotFoundError,
      )
    })

    it('hides soft-deleted records from the default list but keeps them on disk', async () => {
      const created = await store.productionOrders.create(scopeA, orderInput())
      await store.productionOrders.softDelete(scopeA, created.id)

      await expect(store.productionOrders.list(scopeA)).resolves.toEqual([])
      await expect(store.productionOrders.findById(scopeA, created.id)).resolves.toBeNull()
      await expect(store.productionOrders.list(scopeA, { includeDeleted: true })).resolves.toHaveLength(1)
    })

    it('filters a list by an equality predicate', async () => {
      await store.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-1', status: 'RELEASED' }))
      await store.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-2', status: 'AT_RISK' }))

      const atRisk = await store.productionOrders.list(scopeA, { where: { status: 'AT_RISK' } })
      expect(atRisk.map((order) => order.orderNumber)).toEqual(['PO-2'])
    })

    it('rejects an unknown enum value before it reaches disk', async () => {
      const created = await store.productionOrders.create(scopeA, orderInput())
      const patch = { status: 'NOT_A_STATUS' } as unknown as { status: 'AT_RISK' }

      await expect(store.productionOrders.update(scopeA, created.id, patch)).rejects.toThrow()
      await expect(store.productionOrders.findById(scopeA, created.id)).resolves.toMatchObject({ status: 'PLANNED' })
    })
  })

  describe('file integrity', () => {
    it('does not lose records when creates run concurrently', async () => {
      await Promise.all(
        Array.from({ length: 12 }, (_unused, index) =>
          store.productionOrders.create(scopeA, orderInput({ orderNumber: `PO-${index}` })),
        ),
      )

      await expect(store.productionOrders.list(scopeA)).resolves.toHaveLength(12)
    })

    it('leaves the previous valid JSON readable when a write is interrupted', async () => {
      let failNextWrite = false
      const interruptibleWriter: AtomicWriter = async (filePath, contents) => {
        if (failNextWrite) {
          // A crash between the temporary write and the rename: the temp file
          // exists, the target file still holds the previous version.
          await fs.writeFile(`${filePath}.interrupted.tmp`, contents, 'utf8')
          throw new Error('[internal] simulated interruption')
        }
        await writeFileAtomically(filePath, contents)
      }

      const guardedStore = createJsonSupplyCasesStore({
        dataDir,
        clock: createTestClock(),
        writer: interruptibleWriter,
      })
      const survivor = await guardedStore.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-KEEP' }))

      failNextWrite = true
      await expect(
        guardedStore.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-LOST' })),
      ).rejects.toThrow('simulated interruption')

      failNextWrite = false
      const reread = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
      const orders = await reread.productionOrders.list(scopeA)
      expect(orders).toEqual([survivor])

      const raw = await fs.readFile(path.join(dataDir, STORE_FILE_NAMES.productionOrders), 'utf8')
      expect(() => JSON.parse(raw)).not.toThrow()
    })

    it('keeps accepting writes after a failed one', async () => {
      await store.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-1' }))
      await expect(store.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-1' }))).rejects.toBeInstanceOf(
        DuplicateRecordKeyError,
      )

      await expect(store.productionOrders.create(scopeA, orderInput({ orderNumber: 'PO-2' }))).resolves.toMatchObject({
        orderNumber: 'PO-2',
      })
      await expect(store.productionOrders.list(scopeA)).resolves.toHaveLength(2)
    })

    it('reports a corrupted file instead of silently repairing it', async () => {
      await store.productionOrders.create(scopeA, orderInput())
      await fs.writeFile(path.join(dataDir, STORE_FILE_NAMES.productionOrders), '{ not json', 'utf8')

      await expect(store.productionOrders.list(scopeA)).rejects.toBeInstanceOf(StoreFileCorruptedError)
    })

    it('reports a file whose records no longer match the schema', async () => {
      await store.productionOrders.create(scopeA, orderInput())
      await fs.writeFile(
        path.join(dataDir, STORE_FILE_NAMES.productionOrders),
        JSON.stringify({ version: 1, records: [{ id: 'broken' }] }),
        'utf8',
      )

      await expect(store.productionOrders.list(scopeA)).rejects.toBeInstanceOf(StoreFileCorruptedError)
    })

    it('treats a missing file as an empty collection', async () => {
      await expect(store.productionOrders.list(scopeA)).resolves.toEqual([])
    })
  })

  describe('coverage calculation', () => {
    it('reports the seeded plan as fully covered and protected', async () => {
      const seeded = await store.seedScenario(scopeA)

      const coverage = calculatePlanCoverage(seeded.productionPlan)
      expect(coverage).toMatchObject({
        requiredQuantity: 500,
        coveredQuantity: 500,
        missingQuantity: 0,
        isFullyCovered: true,
        riskStatus: 'PROTECTED',
      })
    })

    it('drops to at risk when a commitment slips past the required date', async () => {
      const seeded = await store.seedScenario(scopeA)

      const degraded = await store.productionPlans.update(scopeA, seeded.productionPlan.id, {
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

      expect(calculatePlanCoverage(degraded)).toMatchObject({
        coveredQuantity: 300,
        missingQuantity: 200,
        isFullyCovered: false,
        riskStatus: 'AT_RISK',
      })
    })

    it('returns to 500/500 and PROTECTED once the alternative supplier confirms', async () => {
      const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })

      const resolved = await store.productionPlans.update(scopeA, seeded.productionPlan.id, {
        internalStockQuantity: 0,
        supplierCommitments: [
          {
            supplierEmail: 'supplier@hackon-om-wro.cloud',
            quantity: 300,
            deliveryDate: '2026-09-16T12:00:00.000Z',
            status: 'CONFIRMED',
          },
          {
            supplierEmail: 'supplier2@hackon-om-wro.cloud',
            quantity: 200,
            deliveryDate: '2026-09-16T12:00:00.000Z',
            status: 'CONFIRMED',
          },
        ],
        riskStatus: 'PROTECTED',
      })

      expect(calculatePlanCoverage(resolved)).toMatchObject({
        coveredQuantity: 500,
        missingQuantity: 0,
        isFullyCovered: true,
        riskStatus: 'PROTECTED',
      })
    })

    it('ignores cancelled commitments', async () => {
      const seeded = await store.seedScenario(scopeA)

      const cancelled = await store.productionPlans.update(scopeA, seeded.productionPlan.id, {
        internalStockQuantity: 0,
        supplierCommitments: [
          {
            supplierEmail: 'supplier@hackon-om-wro.cloud',
            quantity: 500,
            deliveryDate: '2026-09-16T12:00:00.000Z',
            status: 'CANCELLED',
          },
        ],
      })

      expect(calculatePlanCoverage(cancelled)).toMatchObject({ coveredQuantity: 0, riskStatus: 'BREACHED' })
    })
  })
})
