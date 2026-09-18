import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AppendOnlyViolationError, RecordNotFoundError } from '../data/errors'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import type { InboundMessage, ProductionPlan, SupplyCase } from '../data/types'
import { applyTriageOutcome } from '../lib/triage/applyTriageOutcome'
import {
  LOW_CONFIDENCE_MESSAGE,
  NEW_SUPPLY_PROPOSAL,
  TRIAGE_FIXTURE_SENDERS,
  UNRELATED_CUSTOMER_MESSAGE,
  createFailingInvoker,
  createRecordingInvoker,
} from '../data/triage-fixtures'

/**
 * T-09b, persisted: what the deterministic bar actually writes, against the
 * real store rather than a double. The assertions that matter most are the
 * negative ones — what an untrusted triage must NOT change.
 */

const scope: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

describe('applyTriageOutcome', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-triage-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  async function seedPlan(): Promise<ProductionPlan> {
    return store.productionPlans.create(scope, {
      planNumber: 'PP-1',
      materialSku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
    })
  }

  async function seedCase(overrides: Partial<Parameters<SupplyCasesStore['supplyCases']['create']>[1]> = {}): Promise<SupplyCase> {
    return store.supplyCases.create(scope, {
      correlationId: 'SC-001',
      sku: 'MAT-42',
      requiredQuantity: 500,
      requiredDate: '2026-09-23T12:00:00.000Z',
      supplier1Email: TRIAGE_FIXTURE_SENDERS.supplier1,
      ...overrides,
    })
  }

  async function seedMessage(overrides: Partial<Parameters<SupplyCasesStore['inboundMessages']['append']>[1]> = {}): Promise<InboundMessage> {
    return store.inboundMessages.append(scope, {
      rfcMessageId: '<proposal-1@supplier.example>',
      senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
      recipientEmail: 'manufacturer@hackon-om-wro.cloud',
      sanitizedBody: NEW_SUPPLY_PROPOSAL.sanitizedBody,
      ...overrides,
    })
  }

  it('opens a case from local demand and links the message to it', async () => {
    const plan = await seedPlan()
    const message = await seedMessage()

    const outcome = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.decision.outcome).toBe('AUTO_APPLY')
    expect(outcome.supplyCase?.correlationId).toBe('SC-001')
    expect(outcome.supplyCase?.productionPlanId).toBe(plan.id)
    // Local demand, not anything the supplier wrote.
    expect(outcome.supplyCase?.requiredQuantity).toBe(500)
    expect(outcome.message.caseId).toBe(outcome.supplyCase?.id)
    expect(outcome.message.triageDisposition).toBe('AUTO_APPLIED')
    expect(outcome.message.extraction?.intent).toBe('SUPPLY_PROPOSAL')
    expect(outcome.message.failureReason).toBeNull()
  })

  it('links a reply to the existing case the sender participates in', async () => {
    const supplyCase = await seedCase()
    const message = await seedMessage({ rfcMessageId: '<reply-1@supplier.example>' })

    const outcome = await applyTriageOutcome(
      {
        store,
        scope,
        invoke: createRecordingInvoker({
          ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>),
          correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
        }),
      },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.supplyCase?.id).toBe(supplyCase.id)
    expect(outcome.message.caseId).toBe(supplyCase.id)
    // Triage links; it does not decide what the case should now do.
    const reloaded = await store.supplyCases.requireById(scope, supplyCase.id)
    expect(reloaded.status).toBe('RECEIVED')
    expect(reloaded.supplier1Proposal).toBeNull()
  })

  it('holds a low-confidence message without linking or creating anything', async () => {
    await seedPlan()
    await seedCase()
    const message = await seedMessage({ sanitizedBody: LOW_CONFIDENCE_MESSAGE.sanitizedBody })

    const outcome = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(LOW_CONFIDENCE_MESSAGE.rawResult) },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.decision.outcome).toBe('NEEDS_ATTENTION')
    expect(outcome.supplyCase).toBeNull()
    expect(outcome.message.caseId).toBeNull()
    expect(outcome.message.triageDisposition).toBeNull()
    expect(outcome.message.failureReason).toBe('NEEDS_ATTENTION:LOW_CONFIDENCE')
    // The extraction is kept beside the original text for the reviewer.
    expect(outcome.message.extraction?.confidence).toBe(0.41)
    expect(outcome.message.sanitizedBody).toBe(LOW_CONFIDENCE_MESSAGE.sanitizedBody)
    expect(await store.supplyCases.list(scope)).toHaveLength(1)
  })

  it('holds a new-case signal for a SKU no plan requires', async () => {
    const message = await seedMessage()

    const outcome = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.decision.outcome).toBe('NEEDS_ATTENTION')
    if (outcome.decision.outcome !== 'NEEDS_ATTENTION') return
    expect(outcome.decision.reason).toBe('NO_LOCAL_DEMAND')
    expect(await store.supplyCases.list(scope)).toHaveLength(0)
  })

  it('quarantines an unrelated message and touches no case', async () => {
    await seedPlan()
    const supplyCase = await seedCase()
    const message = await seedMessage({
      senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
      sanitizedBody: UNRELATED_CUSTOMER_MESSAGE.sanitizedBody,
    })

    const outcome = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(UNRELATED_CUSTOMER_MESSAGE.rawResult) },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.message.triageDisposition).toBe('QUARANTINED')
    expect(outcome.message.failureReason).toBe('QUARANTINED:UNRELATED')
    expect(outcome.message.extraction).toBeNull()
    expect(outcome.message.caseId).toBeNull()
    const reloaded = await store.supplyCases.requireById(scope, supplyCase.id)
    expect(reloaded.updatedAt).toBe(supplyCase.updatedAt)
  })

  it('quarantines when the provider is unavailable, changing no case', async () => {
    await seedPlan()
    const message = await seedMessage()

    const outcome = await applyTriageOutcome({ store, scope, invoke: createFailingInvoker() }, message.id)

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.message.failureReason).toBe('QUARANTINED:AGENT_UNAVAILABLE')
    expect(await store.supplyCases.list(scope)).toHaveLength(0)
  })

  it('quarantines a message whose body carried no new statement', async () => {
    const message = await seedMessage({ sanitizedBody: null })
    const invoke = createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult)

    const outcome = await applyTriageOutcome({ store, scope, invoke }, message.id)

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.message.failureReason).toBe('QUARANTINED:EMPTY_BODY')
    expect(invoke.calls).toHaveLength(0)
  })

  it('is idempotent: a redelivered message is reported, not re-decided', async () => {
    await seedPlan()
    const message = await seedMessage()
    const first = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
      message.id,
    )
    expect(first.status).toBe('applied')

    const secondInvoke = createRecordingInvoker({
      ...(NEW_SUPPLY_PROPOSAL.rawResult as Record<string, unknown>),
      sku: 'MAT-99',
    })
    const second = await applyTriageOutcome({ store, scope, invoke: secondInvoke }, message.id)

    expect(second.status).toBe('already_settled')
    if (second.status !== 'already_settled') return
    expect(second.disposition).toBe('AUTO_APPLIED')
    expect(secondInvoke.calls).toHaveLength(0)
    expect(second.message.caseId).toBe(first.status === 'applied' ? first.supplyCase?.id : null)
    expect(await store.supplyCases.list(scope)).toHaveLength(1)
  })

  it('refuses to re-triage a settled message even at the repository', async () => {
    await seedPlan()
    const message = await seedMessage()
    await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
      message.id,
    )

    await expect(
      store.inboundMessages.recordTriage(scope, message.id, {
        caseId: null,
        correlationId: null,
        messageIntent: null,
        extraction: null,
        extractionConfidence: null,
        triageDisposition: 'QUARANTINED',
        failureReason: 'QUARANTINED:UNRELATED',
      }),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError)
  })

  it('never leaves a case reachable from another scope', async () => {
    const otherScope: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    await seedPlan()
    const message = await seedMessage()

    await expect(
      applyTriageOutcome(
        { store, scope: otherScope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
        message.id,
      ),
    ).rejects.toBeInstanceOf(RecordNotFoundError)
  })

  it('keeps the received facts untouched while recording triage', async () => {
    await seedPlan()
    const message = await seedMessage()
    const outcome = await applyTriageOutcome(
      { store, scope, invoke: createRecordingInvoker(NEW_SUPPLY_PROPOSAL.rawResult) },
      message.id,
    )

    expect(outcome.status).toBe('applied')
    if (outcome.status !== 'applied') return
    expect(outcome.message.rfcMessageId).toBe(message.rfcMessageId)
    expect(outcome.message.senderEmail).toBe(message.senderEmail)
    expect(outcome.message.rawBody).toBe(message.rawBody)
    expect(outcome.message.sanitizedBody).toBe(message.sanitizedBody)
    expect(outcome.message.createdAt).toBe(message.createdAt)
  })
})
