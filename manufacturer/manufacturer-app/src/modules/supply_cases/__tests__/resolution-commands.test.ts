import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { ConfirmationPlanContract, ConfirmationRole } from '../data/types'
import type { ExtractedCommitment } from '../data/inbound-signal'
import {
  applyConfirmedCommand,
  expireConfirmationsCommand,
  recordConfirmationCommand,
  type ApplyConfirmedResult,
  type ExpireConfirmationsResult,
} from '../commands/resolution'

/**
 * Command + JSON-store coverage for Phase 4's confirmation join. Every test
 * here is TEST-010 through TEST-014G from
 * `.ai/specs/2026-09-19-supply-cases-phase-4-confirmation-join.md`. None needs
 * Postgres or the workflow: `apply_confirmed` is dispatched by
 * `record_confirmation` directly, exactly as production does it.
 */

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }

const SUPPLIER_1_EMAIL = 'supplier1@example.com'
const SUPPLIER_2_EMAIL = 'supplier2@example.com'
const REQUIRED_DATE = '2026-09-20T00:00:00.000Z'

function buildPlan(overrides: Partial<ConfirmationPlanContract> = {}): ConfirmationPlanContract {
  return {
    planId: 'USE_ALTERNATIVE',
    planHash: 'plan-hash-1',
    supplierCommitments: [
      { role: 'SUPPLIER_1', supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
      { role: 'SUPPLIER_2', supplierEmail: SUPPLIER_2_EMAIL, quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', intent: 'COMMIT' },
    ],
    internalStockAllocation: 0,
    requiredConfirmations: ['SUPPLIER_1', 'SUPPLIER_2'],
    additionalCost: 42,
    ...overrides,
  }
}

function createTestClock(): StoreClock {
  let tick = 0
  return {
    // Deliberately in the past relative to wall-clock time: `expire_confirmations`
    // compares a case's `updatedAt` (stamped by this clock) against the real
    // `Date.now()`, so the fixture clock must stay behind "now" for a `windowMs:
    // 0` test to observe a positive elapsed duration.
    now: () => new Date(Date.UTC(2020, 0, 1, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

function createContainer(store: SupplyCasesStore): AwilixContainer {
  const commandBus: CommandBus = {
    async execute(id: string, args: { input: unknown; ctx: CommandRuntimeContext }) {
      if (id === 'supply_cases.resolution.apply_confirmed') {
        const result = await applyConfirmedCommand.execute(args.input as never, args.ctx)
        return { result }
      }
      throw new Error(`[internal] unexpected command dispatch in test double: ${id}`)
    },
  } as unknown as CommandBus

  const values: Record<string, unknown> = { supplyCasesStore: store, commandBus }
  return {
    resolve<T = unknown>(name: string): T {
      if (!(name in values)) throw new Error(`[internal] ${name} is not registered`)
      return values[name] as T
    },
  } as unknown as AwilixContainer
}

function systemCtx(store: SupplyCasesStore): CommandRuntimeContext {
  return {
    container: createContainer(store),
    auth: null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    systemActor: true,
  } as CommandRuntimeContext
}

type RecordedEvent = { id: string; payload: Record<string, unknown> }

describe('supply_cases.resolution — confirmation join', () => {
  let dataDir: string
  let store: SupplyCasesStore
  let recordedEvents: RecordedEvent[]

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-resolution-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
    recordedEvents = []
    // Nothing else in this suite installs a global bus, and `emitSupplyCasesEvent`
    // silently no-ops without one — so without this, TEST-010's "one resolved
    // event" and TEST-014B's "no second event" oracles would hold vacuously.
    setGlobalEventBus({
      async emit(id: string, payload: unknown) {
        recordedEvents.push({ id, payload: payload as Record<string, unknown> })
      },
    })
  })

  afterEach(async () => {
    setGlobalEventBus({ async emit() { /* [internal] no-op after test */ } })
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  async function seedCase(
    scope: StoreScope,
    plan: ConfirmationPlanContract,
    caseOverrides: Partial<Parameters<SupplyCasesStore['supplyCases']['create']>[1]> = {},
  ) {
    const productionPlan = await store.productionPlans.create(scope, {
      planNumber: `PP-${scope.tenantId}`,
      materialSku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: REQUIRED_DATE,
    })
    const supplyCase = await store.supplyCases.create(scope, {
      correlationId: `SC-${scope.tenantId}`,
      status: 'WAITING_FOR_SUPPLIER_CONFIRMATIONS',
      sku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: REQUIRED_DATE,
      productionPlanId: productionPlan.id,
      selectedResolutionPlanId: plan.planId,
      pendingResolutionPlan: plan as never,
      ...caseOverrides,
    })
    return { productionPlan, supplyCase }
  }

  async function appendConfirmationMessage(
    scope: StoreScope,
    caseId: string,
    role: ConfirmationRole,
    senderEmail: string,
    commitments: ExtractedCommitment[],
    unresolved: string[] = [],
  ) {
    return store.inboundMessages.append(scope, {
      rfcMessageId: `<confirm-${role}-${caseId}@supplier.example>`,
      senderEmail,
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      caseId,
      messageIntent: 'SUPPLY_COMMITMENT_CONFIRMED',
      triageDisposition: 'AUTO_APPLIED',
      triageOutcome: 'AUTO_APPLIED',
      extraction: {
        intent: 'SUPPLY_COMMITMENT_CONFIRMED',
        correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
        sku: 'MAT-42',
        commitments,
        price: null,
        confidence: 0.95,
        unresolved,
        rationale: 'Supplier confirmed the accepted plan.',
      },
    })
  }

  async function applyConfirmed(scope: StoreScope, caseId: string): Promise<ApplyConfirmedResult> {
    return applyConfirmedCommand.execute({ caseId, scope }, systemCtx(store))
  }

  async function expireConfirmations(
    scope: StoreScope,
    caseId: string,
    windowMs?: number,
  ): Promise<ExpireConfirmationsResult> {
    return expireConfirmationsCommand.execute({ caseId, scope, windowMs }, systemCtx(store))
  }

  // TEST-010
  it('resolves the case with exactly one plan mutation when S1 confirms then S2', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const r1 = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    expect(r1.status).toBe('recorded')
    expect(r1.closedTheSet).toBe(false)

    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    const r2 = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    expect(r2.status).toBe('recorded')
    expect(r2.closedTheSet).toBe(true)

    const resolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.actualAdditionalCost).toBe(42)

    const plan1 = await store.productionPlans.requireById(scopeA, resolved.productionPlanId as string)
    expect(plan1.supplierCommitments).toEqual([
      { supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', status: 'CONFIRMED' },
      { supplierEmail: SUPPLIER_2_EMAIL, quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', status: 'CONFIRMED' },
    ])
    expect(plan1.riskStatus).toBe('PROTECTED')

    const confirmationRecordedEvents = recordedEvents.filter((event) => event.id === 'supply_cases.case.confirmation_recorded')
    expect(confirmationRecordedEvents).toHaveLength(2)
    expect(confirmationRecordedEvents.map((event) => event.payload.role)).toEqual(['SUPPLIER_1', 'SUPPLIER_2'])
    expect(confirmationRecordedEvents.every((event) => event.payload.verdict === 'MATCHES_PLAN')).toBe(true)

    const resolvedEvents = recordedEvents.filter((event) => event.id === 'supply_cases.case.resolved')
    expect(resolvedEvents).toHaveLength(1)
    expect(resolvedEvents[0].payload).toMatchObject({
      caseId: supplyCase.id,
      coveredQuantity: 500,
      requiredQuantity: 500,
      riskStatus: 'PROTECTED',
    })
  })

  // TEST-011
  it('reaches the identical final plan state when S2 confirms before S1', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const r1 = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    expect(r1.closedTheSet).toBe(true)

    const resolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolved.status).toBe('RESOLVED')

    const finalPlan = await store.productionPlans.requireById(scopeA, resolved.productionPlanId as string)
    expect(finalPlan.supplierCommitments).toEqual([
      { supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', status: 'CONFIRMED' },
      { supplierEmail: SUPPLIER_2_EMAIL, quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', status: 'CONFIRMED' },
    ])
    expect(finalPlan.riskStatus).toBe('PROTECTED')
  })

  // TEST-012
  it('marks WAIT_TIMEOUT with zero mutation when the window elapses on an incomplete join', async () => {
    const plan = buildPlan()
    const { supplyCase, productionPlan } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))

    const expired = await expireConfirmations(scopeA, supplyCase.id, 0)
    expect(expired.status).toBe('expired')

    const attentionCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(attentionCase.status).toBe('NEEDS_ATTENTION')
    expect(attentionCase.needsAttentionReason).toBe('WAIT_TIMEOUT')

    const untouchedPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
    expect(untouchedPlan.supplierCommitments).toEqual([])
    expect(untouchedPlan.riskStatus).toBe('AT_RISK')
  })

  // TEST-012A
  it('never overrides a closed set with a timeout', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))

    const resolvedBefore = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolvedBefore.status).toBe('RESOLVED')

    const expireResult = await expireConfirmations(scopeA, supplyCase.id, 0)
    expect(expireResult.status).toBe('not_applicable')

    const stillResolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(stillResolved.status).toBe('RESOLVED')
    expect(stillResolved.needsAttentionReason).toBeNull()
  })

  // TEST-014A
  it('records exactly one confirmation per role across replays and closes the set exactly once', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const first = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    const replay = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    expect(first.status).toBe('recorded')
    expect(replay.status).toBe('already_recorded')
    expect(replay.closedTheSet).toBe(false)

    const confirmations = await store.supplyConfirmations.findByCaseId(scopeA, supplyCase.id)
    expect(confirmations).toHaveLength(1)

    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    const closing = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    const closingReplay = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    expect(closing.closedTheSet).toBe(true)
    expect(closingReplay.closedTheSet).toBe(false)
  })

  // TEST-014B
  it('treats a repeated apply_confirmed as a no-op: no mutation, no second event, stock landed at the SET target', async () => {
    // A USE_STOCK-shaped plan, deliberately seeded against a production plan
    // whose internalStockQuantity (350) DIFFERS from the plan's allocation
    // (200). A prior regression subtracted the allocation from the existing
    // stock instead of setting it to the absolute target; seeding a different
    // starting value is what makes that defect visible — an implementation
    // that starts from `0` (as `seedCase`'s default plan does) can satisfy a
    // SET and a no-op subtraction (0 - 200) identically.
    const stockPlan = buildPlan({
      planId: 'USE_STOCK',
      supplierCommitments: [
        { role: 'SUPPLIER_1', supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
      ],
      internalStockAllocation: 200,
      requiredConfirmations: ['SUPPLIER_1'],
    })
    const { supplyCase, productionPlan } = await seedCase(scopeA, stockPlan)
    await store.productionPlans.update(scopeA, productionPlan.id, { internalStockQuantity: 350 })

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))

    const resolvedOnce = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolvedOnce.status).toBe('RESOLVED')

    const planAfterFirstApply = await store.productionPlans.requireById(scopeA, productionPlan.id)
    // SET semantics: 200, never 350 (unchanged) nor 350 - 200 = 150 (subtracted).
    expect(planAfterFirstApply.internalStockQuantity).toBe(200)

    const resolvedEventsAfterFirst = recordedEvents.filter((event) => event.id === 'supply_cases.case.resolved')
    expect(resolvedEventsAfterFirst).toHaveLength(1)

    const secondApply = await applyConfirmed(scopeA, supplyCase.id)
    expect(secondApply.status).toBe('already_applied')
    expect(secondApply.coveredQuantity).toBeNull()

    const stillResolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(stillResolved.updatedAt).toBe(resolvedOnce.updatedAt)
    expect(stillResolved.resolvedAt).toBe(resolvedOnce.resolvedAt)

    const planAfterSecondApply = await store.productionPlans.requireById(scopeA, productionPlan.id)
    // Still 200, not re-derived from a mutated base (e.g. 200 - 200 = 0).
    expect(planAfterSecondApply.internalStockQuantity).toBe(200)

    // The second apply is a true no-op: zero further events of any kind.
    expect(recordedEvents.filter((event) => event.id === 'supply_cases.case.resolved')).toHaveLength(1)
    expect(recordedEvents.filter((event) => event.id === 'supply_cases.case.confirmation_recorded')).toHaveLength(1)
  })

  // TEST-014C
  it('closes the set exactly once when two closing confirmations race', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])

    const [r1, r2] = await Promise.all([
      recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store)),
      recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store)),
    ])

    const closedCount = [r1, r2].filter((result) => result.closedTheSet).length
    expect(closedCount).toBe(1)

    const resolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolved.status).toBe('RESOLVED')
  })

  // TEST-014D
  it('returns not_ready from apply_confirmed\'s OWN stale-version branch when two applies race the same closed case', async () => {
    const plan = buildPlan()
    const { supplyCase, productionPlan } = await seedCase(scopeA, plan)

    // Record both confirmations directly against the repository (bypassing
    // `record_confirmation`, which would auto-dispatch apply itself) so the
    // join is COMPLETE while the case is still WAITING_FOR_SUPPLIER_CONFIRMATIONS
    // — exactly the precondition `apply_confirmed` expects from a caller.
    await store.supplyConfirmations.recordAndEvaluate(
      scopeA,
      {
        caseId: supplyCase.id,
        planId: plan.planId,
        planHash: plan.planHash,
        role: 'SUPPLIER_1',
        supplierEmail: SUPPLIER_1_EMAIL,
        inboundMessageId: 'msg-s1',
        rfcMessageId: '<s1@supplier.example>',
        confirmedCommitments: [{ quantity: 300, date: '2026-09-16' }],
        verdict: 'MATCHES_PLAN',
        mismatchReasons: [],
        idempotencyKey: `${supplyCase.id}:${plan.planHash}:SUPPLIER_1`,
      },
      plan.requiredConfirmations,
    )
    await store.supplyConfirmations.recordAndEvaluate(
      scopeA,
      {
        caseId: supplyCase.id,
        planId: plan.planId,
        planHash: plan.planHash,
        role: 'SUPPLIER_2',
        supplierEmail: SUPPLIER_2_EMAIL,
        inboundMessageId: 'msg-s2',
        rfcMessageId: '<s2@supplier.example>',
        confirmedCommitments: [{ quantity: 200, date: '2026-09-18' }],
        verdict: 'MATCHES_PLAN',
        mismatchReasons: [],
        idempotencyKey: `${supplyCase.id}:${plan.planHash}:SUPPLIER_2`,
      },
      plan.requiredConfirmations,
    )

    const waitingCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(waitingCase.status).toBe('WAITING_FOR_SUPPLIER_CONFIRMATIONS')

    // Two concurrent apply_confirmed dispatches both read the same
    // pre-mutation case version. Only one can win the command's own step-1
    // `compareAndSwap` into APPLYING_RESOLUTION; the loser must hit the
    // command's own stale-version branch and answer `not_ready`, not throw
    // and not mutate anything.
    const [first, second] = await Promise.all([
      applyConfirmed(scopeA, supplyCase.id),
      applyConfirmed(scopeA, supplyCase.id),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['not_ready', 'resolved'])

    const resolvedCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolvedCase.status).toBe('RESOLVED')

    // The loser's stale branch performed no write of its own: the plan
    // reflects exactly one clean apply, not a double mutation.
    const finalPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
    expect(finalPlan.supplierCommitments).toEqual([
      { supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', status: 'CONFIRMED' },
      { supplierEmail: SUPPLIER_2_EMAIL, quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', status: 'CONFIRMED' },
    ])

    expect(recordedEvents.filter((event) => event.id === 'supply_cases.case.resolved')).toHaveLength(1)
  })

  // TEST-014E
  it('does not resolve when confirmations match but coverage stays short', async () => {
    const shortPlan = buildPlan({
      supplierCommitments: [
        { role: 'SUPPLIER_1', supplierEmail: SUPPLIER_1_EMAIL, quantity: 100, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
        { role: 'SUPPLIER_2', supplierEmail: SUPPLIER_2_EMAIL, quantity: 50, deliveryDate: '2026-09-18T00:00:00.000Z', intent: 'COMMIT' },
      ],
    })
    const { supplyCase } = await seedCase(scopeA, shortPlan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 100, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 50, date: '2026-09-18' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))

    const finalCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(finalCase.status).toBe('NEEDS_ATTENTION')
    expect(finalCase.status).not.toBe('RESOLVED')

    const finalPlan = await store.productionPlans.requireById(scopeA, finalCase.productionPlanId as string)
    expect(finalPlan.riskStatus).not.toBe('PROTECTED')
  })

  // TEST-014F
  it('never lets a confirmation from another tenant close the join', async () => {
    const plan = buildPlan()
    const { supplyCase: caseA } = await seedCase(scopeA, plan)
    const { supplyCase: caseB } = await seedCase(scopeB, plan)

    const m1A = await appendConfirmationMessage(scopeA, caseA.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1A.id, scope: scopeA }, systemCtx(store))

    // Same role, same plan hash, but recorded under tenant B: it must not be
    // visible to tenant A's join.
    const m1B = await appendConfirmationMessage(scopeB, caseB.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1B.id, scope: scopeB }, systemCtx(store))

    const confirmationsForA = await store.supplyConfirmations.findByCaseId(scopeA, caseA.id)
    expect(confirmationsForA).toHaveLength(1)

    const stillWaitingA = await store.supplyCases.requireById(scopeA, caseA.id)
    expect(stillWaitingA.status).toBe('WAITING_FOR_SUPPLIER_CONFIRMATIONS')
  })

  // TEST-014G
  it('flags MISSING_DATA with zero production mutation when the plan is internally inconsistent', async () => {
    const inconsistentPlan = buildPlan({
      requiredConfirmations: ['SUPPLIER_1', 'SUPPLIER_2'],
      supplierCommitments: [
        { role: 'SUPPLIER_1', supplierEmail: SUPPLIER_1_EMAIL, quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
      ],
    })
    const { supplyCase, productionPlan } = await seedCase(scopeA, inconsistentPlan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const result = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    expect(result.status).toBe('invalid_plan')

    const attentionCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(attentionCase.status).toBe('NEEDS_ATTENTION')
    expect(attentionCase.needsAttentionReason).toBe('MISSING_DATA')

    const untouchedPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
    expect(untouchedPlan.supplierCommitments).toEqual([])

    const confirmations = await store.supplyConfirmations.findByCaseId(scopeA, supplyCase.id)
    expect(confirmations).toHaveLength(0)
  })

  it('flags CONFIRMATION_MISMATCH with zero production mutation on a quantity mismatch', () =>
    (async () => {
      const plan = buildPlan()
      const { supplyCase, productionPlan } = await seedCase(scopeA, plan)

      const badMessage = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
        { quantity: 299, date: '2026-09-16' },
      ])
      const result = await recordConfirmationCommand.execute(
        { inboundMessageId: badMessage.id, scope: scopeA },
        systemCtx(store),
      )
      expect(result.status).toBe('recorded')
      expect(result.verdict).toBe('DIFFERS_FROM_PLAN')

      const attentionCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
      expect(attentionCase.status).toBe('NEEDS_ATTENTION')
      expect(attentionCase.needsAttentionReason).toBe('CONFIRMATION_MISMATCH')

      const untouchedPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
      expect(untouchedPlan.supplierCommitments).toEqual([])
    })())

  it('allows a late confirmation to be recorded after a mismatch without re-closing spuriously', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const badMessage = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 299, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: badMessage.id, scope: scopeA }, systemCtx(store))

    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    const r2 = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    // SUPPLIER_1's recorded confirmation is a permanent mismatch for this plan
    // hash, so the join can never reach COMPLETE from here.
    expect(r2.closedTheSet).toBe(false)

    const stillAttention = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(stillAttention.status).toBe('NEEDS_ATTENTION')
    expect(stillAttention.status).not.toBe('RESOLVED')
  })

  it('REPLACEs only the roles named in the plan: a stale row for a named role is dropped, an unrelated supplier row survives untouched', async () => {
    const plan = buildPlan()
    const { supplyCase, productionPlan } = await seedCase(scopeA, plan)

    const staleSupplier1Row = {
      supplierEmail: SUPPLIER_1_EMAIL,
      quantity: 500,
      deliveryDate: '2026-09-10T00:00:00.000Z',
      status: 'COMMITTED' as const,
    }
    const unrelatedSupplierRow = {
      supplierEmail: 'other-supplier@example.com',
      quantity: 999,
      deliveryDate: '2026-09-05T00:00:00.000Z',
      status: 'PROPOSED' as const,
    }
    await store.productionPlans.update(scopeA, productionPlan.id, {
      supplierCommitments: [staleSupplier1Row, unrelatedSupplierRow],
    })

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))

    const resolved = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolved.status).toBe('RESOLVED')

    const finalPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
    expect(finalPlan.supplierCommitments).toHaveLength(3)
    // The stale 500-unit row for SUPPLIER_1 is gone, replaced entirely by the
    // plan's own 300-unit CONFIRMED row — not merged or appended alongside it.
    expect(finalPlan.supplierCommitments).not.toContainEqual(staleSupplier1Row)
    expect(finalPlan.supplierCommitments).toContainEqual({
      supplierEmail: SUPPLIER_1_EMAIL,
      quantity: 300,
      deliveryDate: '2026-09-16T00:00:00.000Z',
      status: 'CONFIRMED',
    })
    expect(finalPlan.supplierCommitments).toContainEqual({
      supplierEmail: SUPPLIER_2_EMAIL,
      quantity: 200,
      deliveryDate: '2026-09-18T00:00:00.000Z',
      status: 'CONFIRMED',
    })
    // A row for a supplier the plan does not name is untouched by the replace.
    expect(finalPlan.supplierCommitments).toContainEqual(unrelatedSupplierRow)
  })

  it('resumes to RESOLVED when the closing confirmation is redelivered after a crash left the case WAITING', async () => {
    const plan = buildPlan()
    const { supplyCase } = await seedCase(scopeA, plan)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    const m2 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_2', SUPPLIER_2_EMAIL, [
      { quantity: 200, date: '2026-09-18' },
    ])
    const closing = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    expect(closing.closedTheSet).toBe(true)

    const resolvedOnce = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resolvedOnce.status).toBe('RESOLVED')

    // Simulate a crash that happened between the closing confirmation landing
    // and apply actually completing: force the case back to
    // WAITING_FOR_SUPPLIER_CONFIRMATIONS, as if the apply that ran here had
    // never happened. The confirmations themselves (already fully recorded)
    // are untouched — exactly what a real crash between record and apply
    // would leave behind.
    const crashed = await store.supplyCases.compareAndSwap(scopeA, supplyCase.id, resolvedOnce.updatedAt, {
      status: 'WAITING_FOR_SUPPLIER_CONFIRMATIONS',
      resolvedAt: null,
    })
    expect(crashed.status).toBe('WAITING_FOR_SUPPLIER_CONFIRMATIONS')

    // Redelivery of the SAME closing message: `record_confirmation` finds its
    // own idempotency key already recorded, and must resume the apply rather
    // than silently reporting `already_recorded` forever.
    const redelivered = await recordConfirmationCommand.execute({ inboundMessageId: m2.id, scope: scopeA }, systemCtx(store))
    expect(redelivered.status).toBe('already_recorded')

    const resumed = await store.supplyCases.requireById(scopeA, supplyCase.id)
    expect(resumed.status).toBe('RESOLVED')
    expect(resumed.resolvedAt).not.toBeNull()
  })

  it('leaves the case untouched when the pending plan is of a foreign shape the reader does not recognise', async () => {
    const plan = buildPlan()
    const { supplyCase, productionPlan } = await seedCase(scopeA, plan, {
      pendingResolutionPlan: { thisIsNot: 'a confirmation plan contract', version: 7 } as never,
    })
    const beforeCase = await store.supplyCases.requireById(scopeA, supplyCase.id)

    const m1 = await appendConfirmationMessage(scopeA, supplyCase.id, 'SUPPLIER_1', SUPPLIER_1_EMAIL, [
      { quantity: 300, date: '2026-09-16' },
    ])
    const result = await recordConfirmationCommand.execute({ inboundMessageId: m1.id, scope: scopeA }, systemCtx(store))
    expect(result.status).toBe('unreadable_plan')

    const afterCase = await store.supplyCases.requireById(scopeA, supplyCase.id)
    // No write at all: the case's status, reason and version are byte-identical.
    expect(afterCase).toEqual(beforeCase)
    expect(afterCase.status).toBe('WAITING_FOR_SUPPLIER_CONFIRMATIONS')
    expect(afterCase.needsAttentionReason).toBeNull()

    const untouchedPlan = await store.productionPlans.requireById(scopeA, productionPlan.id)
    expect(untouchedPlan.supplierCommitments).toEqual([])

    const confirmations = await store.supplyConfirmations.findByCaseId(scopeA, supplyCase.id)
    expect(confirmations).toHaveLength(0)
  })
})
