import { describe, expect, it } from '@jest/globals'
import { buildSupplyCaseTimeline, SUPPLY_TIMELINE_STEPS } from '../timeline'
import type { SupplyCase, SupplyMessage } from '../../data/entities'

const createdAt = new Date('2026-09-19T10:00:00Z')

function baseCase(overrides: Partial<SupplyCase> = {}): SupplyCase {
  return {
    status: 'proposal_delivered',
    statusReason: null,
    createdAt,
    sku: 'MAT-42',
    originalCommitment: [{ quantity: 500, date: '2026-09-23' }],
    baselineCommitment: [{ quantity: 300, date: '2026-09-23' }, { quantity: 200, date: '2026-09-25' }],
    currentCommitment: [{ quantity: 400, date: '2026-09-23' }, { quantity: 100, date: '2026-09-25' }],
    planSummary: { movedAllocations: [{ orderNumber: 'SO-442', shiftHours: 4 }] },
    policyDecision: 'auto_approved',
    additionalCost: '120.00',
    currencyCode: 'PLN',
    acceptedCommitment: null,
    cancelledCommitment: null,
    freedCapacity: null,
    replyReceivedAt: null,
    commitmentUpdatedAt: null,
    resolvedAt: null,
    ...overrides,
  } as SupplyCase
}

function message(overrides: Partial<SupplyMessage>): SupplyMessage {
  return {
    direction: 'outbound',
    messageType: 'SUPPLY_PROPOSAL',
    deliveryStatus: 'delivered',
    validationStatus: null,
    duplicateCount: 0,
    createdAt: new Date('2026-09-19T10:00:05Z'),
    queuedAt: new Date('2026-09-19T10:00:05Z'),
    deliveredAt: new Date('2026-09-19T10:00:09Z'),
    receivedAt: null,
    ...overrides,
  } as SupplyMessage
}

function states(supplyCase: SupplyCase, messages: SupplyMessage[]): Record<string, string> {
  return Object.fromEntries(buildSupplyCaseTimeline(supplyCase, messages).map((entry) => [entry.key, entry.state]))
}

describe('supplier case timeline', () => {
  it('always returns the 11 roadmap steps in order', () => {
    expect(buildSupplyCaseTimeline(baseCase(), []).map((entry) => entry.key)).toEqual([...SUPPLY_TIMELINE_STEPS])
  })

  it('shows a Level 4 case waiting for the Manufacturer reply', () => {
    expect(states(baseCase(), [message({})])).toMatchObject({
      detected: 'done', baseline: 'done', replan: 'done', policy: 'done', email_sent: 'done',
      waiting: 'current', email_received: 'pending', resolved: 'pending',
    })
  })

  it('marks replan and policy as skipped for a Level 3 case', () => {
    expect(states(baseCase({ planSummary: null, policyDecision: null }), [message({})])).toMatchObject({ replan: 'skipped', policy: 'skipped' })
  })

  it('completes every step for a resolved case', () => {
    const resolved = baseCase({
      status: 'resolved',
      acceptedCommitment: [{ quantity: 400, date: '2026-09-23' }],
      cancelledCommitment: [{ quantity: 100, date: '2026-09-25' }],
      freedCapacity: [{ quantity: 100, date: '2026-09-25' }],
      commitmentUpdatedAt: new Date('2026-09-19T10:03:13Z'),
      resolvedAt: new Date('2026-09-19T10:03:15Z'),
    })
    const messages = [
      message({}),
      message({ direction: 'inbound', messageType: 'SUPPLY_ACCEPTANCE', validationStatus: 'valid', createdAt: new Date('2026-09-19T10:03:12Z'), receivedAt: new Date('2026-09-19T10:03:12Z') }),
      message({ messageType: 'SUPPLY_COMMITMENT_CONFIRMED', createdAt: new Date('2026-09-19T10:03:13Z') }),
    ]
    const timeline = buildSupplyCaseTimeline(resolved, messages)
    expect(timeline.every((entry) => entry.state === 'done')).toBe(true)
    expect(timeline.find((entry) => entry.key === 'commitment_updated')?.params).toMatchObject({ accepted: '400 · 2026-09-23', cancelled: '100 · 2026-09-25' })
  })

  it('flags a rejected inbound mail and an infeasible acceptance as errors', () => {
    const rejected = message({ direction: 'inbound', messageType: null, validationStatus: 'untrusted_sender', createdAt: new Date('2026-09-19T10:02:00Z') })
    expect(states(baseCase(), [message({}), rejected])).toMatchObject({ email_received: 'error', waiting: 'current' })
    expect(states(baseCase({ status: 'needs_human', statusReason: 'acceptance_infeasible_F3' }), [message({})])).toMatchObject({ feasibility: 'error' })
  })

  it('flags a failed confirmation send', () => {
    const failed = message({ messageType: 'SUPPLY_COMMITMENT_CONFIRMED', deliveryStatus: 'enqueue_failed', createdAt: new Date('2026-09-19T10:03:13Z') })
    expect(states(baseCase({ status: 'send_failed', commitmentUpdatedAt: new Date('2026-09-19T10:03:13Z') }), [message({}), failed])).toMatchObject({ confirmation_sent: 'error' })
  })
})
