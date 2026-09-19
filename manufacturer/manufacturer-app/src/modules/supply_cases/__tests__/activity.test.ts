import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createJsonSupplyCasesStore } from '../data/json/store'
import { projectActivityEvent } from '../lib/activity/projectActivity'
import { parseActivityQuery, readActivityPage } from '../lib/activity/readActivity'

describe('supply activity projection', () => {
  let dataDir: string
  const scope = { tenantId: 'tenant-activity', organizationId: 'org-activity' }

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'supply-activity-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('is idempotent and keeps sensitive inbound payload out of the activity record', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    const payload = {
      id: 'message-1',
      inboundMessageId: 'message-1',
      senderEmail: 'supplier@example.test',
      subject: 'secret subject',
      body: 'secret body',
      tenantId: 'forged-tenant',
      organizationId: 'forged-org',
      receivedAt: '2026-09-19T10:00:00.000Z',
    }

    await projectActivityEvent({ eventName: 'supply_cases.inbound_message.accepted', payload, store, scope, now: () => '2026-09-19T10:00:01.000Z' })
    await projectActivityEvent({ eventName: 'supply_cases.inbound_message.accepted', payload, store, scope, now: () => '2026-09-19T10:00:02.000Z' })

    const entries = await store.activities.list(scope)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'email_received' })
    expect(JSON.stringify(entries[0])).not.toContain('supplier@example.test')
    expect(JSON.stringify(entries[0])).not.toContain('secret subject')
    expect(JSON.stringify(entries[0])).not.toContain('secret body')
  })

  it('returns intake activity in the case timeline without mutating its caseId', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    const supplyCase = await store.supplyCases.create(scope, {
      correlationId: 'SC-ACT-001',
      sku: 'MAT-1',
      requiredQuantity: 500,
      requiredDate: '2026-09-24T00:00:00.000Z',
    })
    const message = await store.inboundMessages.append(scope, {
      id: 'message-2',
      caseId: supplyCase.id,
      rfcMessageId: '<message-2@example.test>',
      senderEmail: 'supplier@example.test',
      recipientEmail: 'ops@example.test',
      rawBody: 'private body',
      sanitizedBody: 'private body',
      receivedAt: '2026-09-19T10:00:00.000Z',
    })

    await projectActivityEvent({
      eventName: 'supply_cases.inbound_message.accepted',
      payload: { inboundMessageId: message.id, receivedAt: message.receivedAt },
      store,
      scope,
      now: () => '2026-09-19T10:00:01.000Z',
    })

    const page = await readActivityPage(store, scope, { caseId: supplyCase.id, limit: 50, canViewMessages: false, canViewTrace: false, now: '2026-09-19T10:01:00.000Z' })
    expect(page?.items).toHaveLength(1)
    expect(page?.items[0].caseId).toBeNull()
    expect(page?.items[0].evidence).toBeNull()
  })

  it('enforces scoped pagination and derives stale state without inventing failure', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-1', kind: 'inbound_triage', inboundMessageId: 'message-3', occurredAt: '2026-09-19T09:00:00.000Z' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-2', kind: 'inbound_triage', inboundMessageId: 'message-4', occurredAt: '2026-09-19T10:00:00.000Z' }, store, scope })
    const first = await readActivityPage(store, scope, { limit: 1, canViewMessages: false, canViewTrace: false, now: '2026-09-19T10:01:00.000Z' })
    expect(first?.items).toHaveLength(1)
    expect(first?.items[0].isStale).toBe(false)
    expect(first?.nextCursor).toBeTruthy()

    const older = await readActivityPage(store, scope, { limit: 1, cursor: first?.nextCursor ?? undefined, canViewMessages: false, canViewTrace: false, now: '2026-09-19T10:03:00.000Z' })
    expect(older?.items[0].isStale).toBe(true)
    expect(older?.items[0].status).toBe('running')
    expect(older?.items[0].kind).toBe('analysis_started')
  })

  it('records a retry as a separate activity in the same logical analysis group', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-1', kind: 'inbound_triage', inboundMessageId: 'message-retry', occurredAt: '2026-09-19T10:00:00.000Z' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.failed', payload: { operationId: 'op-1', kind: 'inbound_triage', inboundMessageId: 'message-retry', reasonCode: 'AGENT_UNAVAILABLE', retryable: true, occurredAt: '2026-09-19T10:00:10.000Z' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-2', kind: 'inbound_triage', inboundMessageId: 'message-retry', occurredAt: '2026-09-19T10:01:00.000Z' }, store, scope })

    const entries = await store.activities.list(scope)
    expect(entries.filter((entry) => entry.groupKey === 'analysis:inboundTriage:message-retry')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'operation_failed' }),
      expect.objectContaining({ kind: 'retry_started', params: { agentKey: 'inboundTriage', attempt: 2 } }),
    ]))
  })

  it('keeps triage start and terminal in one group and does not mark a completed run stale', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-terminal', kind: 'inbound_triage', inboundMessageId: 'message-terminal', occurredAt: '2026-09-19T10:00:00.000Z' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.completed', payload: { operationId: 'op-terminal', kind: 'inbound_triage', inboundMessageId: 'message-terminal', classification: 'SUPPLIER', triageOutcome: 'AUTO_APPLIED', occurredAt: '2026-09-19T10:00:10.000Z' }, store, scope })

    const entries = await store.activities.list(scope)
    expect(new Set(entries.map((entry) => entry.groupKey))).toEqual(new Set(['analysis:inboundTriage:message-terminal']))
    const page = await readActivityPage(store, scope, { limit: 50, canViewMessages: false, canViewTrace: false, now: '2026-09-19T10:10:00.000Z' })
    expect(page?.items.find((item) => item.kind === 'analysis_started')?.isStale).toBe(false)
  })

  it('records a non-supplier quarantine as a terminal analysis without supplier claims', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-quarantine', kind: 'inbound_triage', inboundMessageId: 'message-quarantine', occurredAt: '2026-09-19T10:00:00.000Z' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.completed', payload: { operationId: 'op-quarantine', kind: 'inbound_triage', inboundMessageId: 'message-quarantine', classification: 'NON_SUPPLIER', triageOutcome: 'QUARANTINED', occurredAt: '2026-09-19T10:00:10.000Z' }, store, scope })

    const entries = await store.activities.list(scope)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'analysis_completed', status: 'warning', titleKey: 'supply_cases.activity.analysisQuarantined', groupKey: 'analysis:inboundTriage:message-quarantine' }),
    ]))
    expect(entries.some((entry) => entry.kind === 'sender_classified')).toBe(false)
  })

  it('uses a generic confirmation message when the event has no validated commitments', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.case.confirmation_recorded', payload: { id: 'confirmation-1', caseId: 'case-1', role: 'SUPPLIER_1', verdict: 'MATCHES_PLAN', occurredAt: '2026-09-19T10:00:00.000Z' }, store, scope })

    const entries = await store.activities.list(scope)
    expect(entries[0]).toMatchObject({ detailKey: 'supply_cases.activity.confirmationRecordedGeneric', params: { supplierRole: 'SUPPLIER_1', verdict: 'MATCHES_PLAN' }, occurredAt: '2026-09-19T10:00:00.000Z' })
    expect(JSON.stringify(entries[0])).not.toContain('quantity')
    expect(JSON.stringify(entries[0].params)).not.toContain('date')
  })

  it('allowlists failure, stage and risk values before persisting them', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.failed', payload: { operationId: 'op-safe', kind: 'initial_impact', reasonCode: 'raw secret error', retryable: false }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.case.stage_changed', payload: { caseId: 'case-safe', toStatus: 'raw secret stage' }, store, scope })
    await projectActivityEvent({ eventName: 'supply_cases.case.resolved', payload: { caseId: 'case-safe', coveredQuantity: 1, requiredQuantity: 1, riskStatus: 'raw secret risk' }, store, scope })

    const entries = await store.activities.list(scope)
    expect(entries).toHaveLength(1)
    expect(entries[0].params).toEqual({ reasonCode: 'ANALYSIS_FAILED', retryable: false })
    expect(JSON.stringify(entries)).not.toContain('raw secret')
  })

  it('uses receivedAt and authoritative technical references', async () => {
    const store = createJsonSupplyCasesStore({ dataDir })
    await projectActivityEvent({ eventName: 'supply_cases.inbound_message.accepted', payload: { inboundMessageId: 'message-time', receivedAt: '2026-09-19T10:00:00.000Z' }, store, scope, now: () => '2026-09-19T10:05:00.000Z' })
    await projectActivityEvent({ eventName: 'supply_cases.analysis.started', payload: { operationId: 'op-ref', kind: 'initial_impact', caseId: 'case-ref', workflowInstanceId: 'workflow-ref', occurredAt: '2026-09-19T10:01:00.000Z' }, store, scope })

    const page = await readActivityPage(store, scope, { limit: 50, canViewMessages: false, canViewTrace: true })
    expect(page?.items.find((item) => item.kind === 'email_received')?.occurredAt).toBe('2026-09-19T10:00:00.000Z')
    expect(page?.items.find((item) => item.kind === 'analysis_started')?.technicalDetail).toEqual({ type: 'workflow_instance', href: '/backend/processes/workflow-ref' })
  })

  it('uses a 50-entry default for case timelines and rejects oversized identifiers', () => {
    expect(parseActivityQuery(new URLSearchParams('caseId=case-1')).limit).toBe(50)
    expect(parseActivityQuery(new URLSearchParams()).limit).toBe(20)
    expect(() => parseActivityQuery(new URLSearchParams('caseId=bad%20case'))).toThrow('[internal] invalid_caseId')
    expect(() => parseActivityQuery(new URLSearchParams(`cursor=${'a'.repeat(513)}`))).toThrow('[internal] invalid_cursor')
  })
})
