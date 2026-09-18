import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildFixtureIds, FIXTURE_PARTICIPANTS } from '../data/fixtures'
import { createJsonSupplyCasesStore, type StoreClock } from '../data/json/store'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import type { InboundMessage } from '../data/types'
import { assembleTriageContext } from '../lib/inbound/triageContext'
import { buildOutboundIdempotencyKey } from '../lib/outbound/correlationKey'

const scopeA: StoreScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
const scopeB: StoreScope = { tenantId: 'tenant-b', organizationId: 'org-b' }

function createTestClock(): StoreClock {
  let tick = 0
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 0, 0, tick++)).toISOString(),
    newId: () => `generated-${tick++}`,
  }
}

async function appendInbound(
  store: SupplyCasesStore,
  scope: StoreScope,
  overrides: Partial<Parameters<SupplyCasesStore['inboundMessages']['append']>[1]> = {},
): Promise<InboundMessage> {
  return store.inboundMessages.append(scope, {
    rfcMessageId: `inbound-${Math.random().toString(36).slice(2)}@supplier.example`,
    senderEmail: FIXTURE_PARTICIPANTS.supplier1,
    recipientEmail: FIXTURE_PARTICIPANTS.manufacturer,
    sanitizedBody: 'W srode tylko 300 sztuk MAT-42.',
    ...overrides,
  })
}

describe('assembleTriageContext (T-08 store assembly)', () => {
  let dataDir: string
  let store: SupplyCasesStore

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'supply-cases-triage-'))
    store = createJsonSupplyCasesStore({ dataDir, clock: createTestClock() })
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('offers the seeded case to its Supplier 1 and hands the agent only the sanitized body', async () => {
    const seeded = await store.seedScenario(scopeA)
    const message = await appendInbound(store, scopeA)

    const result = await assembleTriageContext(store, scopeA, message)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.candidates.map((candidate) => candidate.caseId)).toEqual([seeded.supplyCase.id])
    expect(result.input.sanitizedBody).toBe('W srode tylko 300 sztuk MAT-42.')
    expect(result.input).not.toHaveProperty('rawBody')
  })

  it('offers nothing to a sender who participates in no case in this scope', async () => {
    await store.seedScenario(scopeA)
    const message = await appendInbound(store, scopeA, { senderEmail: 'stranger@elsewhere.example' })

    const result = await assembleTriageContext(store, scopeA, message)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.candidates).toEqual([])
  })

  it('never reaches another tenant case, even when the reply chain names it', async () => {
    const seededB = await store.seedScenario(scopeB, { includeAlternativeOffer: true })
    const idsB = buildFixtureIds(scopeB)
    await store.seedScenario(scopeA)

    const message = await appendInbound(store, scopeA, {
      senderEmail: FIXTURE_PARTICIPANTS.supplier2,
      inReplyTo: idsB.alternativeRequestRfcMessageId,
      references: [idsB.alternativeRequestRfcMessageId],
    })

    const result = await assembleTriageContext(store, scopeA, message)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.candidates).toEqual([])
    // The anchor exists, but in tenant B — from tenant A it is simply not there.
    expect(result.input.threadEvidence.matches).toEqual([])
    expect(result.input.threadEvidence.unmatchedReferences).toContain(idsB.alternativeRequestRfcMessageId)
    expect(result.input.resumableMatch).toBeNull()
    expect(seededB.outboundCorrelations).toHaveLength(1)
  })

  it('flags the seeded offer as a current thread match on its own case', async () => {
    const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })
    const ids = buildFixtureIds(scopeA)
    const message = await appendInbound(store, scopeA, {
      senderEmail: FIXTURE_PARTICIPANTS.supplier2,
      inReplyTo: ids.alternativeRequestRfcMessageId,
    })

    const result = await assembleTriageContext(store, scopeA, message)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.candidates[0]).toMatchObject({
      caseId: seeded.supplyCase.id,
      participantRole: 'SUPPLIER_2',
      threadMatch: true,
      threadMatchSuperseded: false,
    })
    expect(result.input.resumableMatch?.caseId).toBe(seeded.supplyCase.id)
  })

  it('keeps a stale reply visible as a candidate but refuses it as a resumption', async () => {
    const seeded = await store.seedScenario(scopeA, { includeAlternativeOffer: true })
    const ids = buildFixtureIds(scopeA)

    await store.outboundCorrelations.record(scopeA, {
      caseId: seeded.supplyCase.id,
      phase: 'SUPPLY_ACCEPTANCE',
      recipientEmail: FIXTURE_PARTICIPANTS.supplier2,
      rfcMessageId: 'acceptance-s2@manufacturer.example',
      idempotencyKey: buildOutboundIdempotencyKey(
        seeded.supplyCase.id,
        'SUPPLY_ACCEPTANCE',
        FIXTURE_PARTICIPANTS.supplier2,
      ),
    })

    const message = await appendInbound(store, scopeA, {
      senderEmail: FIXTURE_PARTICIPANTS.supplier2,
      inReplyTo: ids.alternativeRequestRfcMessageId,
    })

    const result = await assembleTriageContext(store, scopeA, message)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Still offered — the agent may legitimately read it as a new problem on an
    // old thread — but it cannot resume the wait the acceptance is holding.
    expect(result.input.candidates[0]).toMatchObject({ threadMatch: true, threadMatchSuperseded: true })
    expect(result.input.resumableMatch).toBeNull()
  })

  it('refuses to assemble an input without a sanitized body', async () => {
    await store.seedScenario(scopeA)
    const message = await appendInbound(store, scopeA, { sanitizedBody: null })

    await expect(assembleTriageContext(store, scopeA, message)).resolves.toEqual({
      ok: false,
      reason: 'NO_SANITIZED_BODY',
    })
  })
})
