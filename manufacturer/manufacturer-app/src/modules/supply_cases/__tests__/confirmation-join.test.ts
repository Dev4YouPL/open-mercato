import type { ConfirmationPlanContract, SupplyConfirmation } from '../data/types'
import { parseConfirmationPlanContract } from '../lib/resolution/planContract'
import { resolveConfirmationRole, validateConfirmation } from '../lib/resolution/validateConfirmation'
import { evaluateConfirmationJoin } from '../lib/resolution/confirmationJoin'
import { evaluateConfirmationDeadline, resolveConfirmationWindowMs } from '../lib/resolution/confirmationDeadline'

/**
 * Pure-function coverage for the confirmation join. None of this needs a
 * store or Postgres: the join is a function of a plan contract and the
 * confirmations recorded against it, per the spec's Assumption Register (A-4).
 */

const PLAN: ConfirmationPlanContract = {
  planId: 'USE_ALTERNATIVE',
  planHash: 'plan-hash-1',
  supplierCommitments: [
    { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
    { role: 'SUPPLIER_2', supplierEmail: 'supplier2@example.com', quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', intent: 'COMMIT' },
  ],
  internalStockAllocation: 0,
  requiredConfirmations: ['SUPPLIER_1', 'SUPPLIER_2'],
  additionalCost: 50,
}

describe('parseConfirmationPlanContract', () => {
  it('rejects a null plan as PLAN_MISSING', () => {
    expect(parseConfirmationPlanContract(null)).toEqual({ ok: false, reason: 'PLAN_MISSING' })
  })

  it('rejects a plan that fails schema validation', () => {
    expect(parseConfirmationPlanContract({ planId: 'NOT_A_PLAN' } as never)).toEqual({
      ok: false,
      reason: 'PLAN_INVALID',
    })
  })

  it('accepts a well-formed, consistent plan', () => {
    const result = parseConfirmationPlanContract(PLAN as never)
    expect(result).toEqual({ ok: true, plan: PLAN })
  })

  // TEST-014G: a role in requiredConfirmations with no commitment, and a
  // commitment whose role is not required, are both MISSING_DATA — never a
  // guess about what the plan "must have meant".
  it('rejects a plan where a required role owns no commitment', () => {
    const inconsistent: ConfirmationPlanContract = {
      ...PLAN,
      requiredConfirmations: ['SUPPLIER_1', 'SUPPLIER_2'],
      supplierCommitments: [PLAN.supplierCommitments[0]],
    }
    expect(parseConfirmationPlanContract(inconsistent as never)).toEqual({ ok: false, reason: 'PLAN_INCONSISTENT' })
  })

  it('rejects a plan where a commitment role is not in requiredConfirmations', () => {
    const inconsistent: ConfirmationPlanContract = {
      ...PLAN,
      requiredConfirmations: ['SUPPLIER_1'],
    }
    expect(parseConfirmationPlanContract(inconsistent as never)).toEqual({ ok: false, reason: 'PLAN_INCONSISTENT' })
  })
})

describe('resolveConfirmationRole', () => {
  it('matches a sender to the role that owns their address in the plan', () => {
    expect(resolveConfirmationRole(PLAN, 'Supplier1@Example.com')).toBe('SUPPLIER_1')
    expect(resolveConfirmationRole(PLAN, 'supplier2@example.com')).toBe('SUPPLIER_2')
  })

  it('returns null for a sender the plan does not name', () => {
    expect(resolveConfirmationRole(PLAN, 'stranger@example.com')).toBeNull()
  })
})

describe('validateConfirmation', () => {
  it('matches when the confirmed set equals the role\'s COMMIT set', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: PLAN.planHash,
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'MATCHES_PLAN', mismatchReasons: [] })
  })

  it('matches when the date differs only in time-of-day, not calendar day', () => {
    const lateNightPlan: ConfirmationPlanContract = {
      ...PLAN,
      supplierCommitments: [
        { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 300, deliveryDate: '2026-09-16T22:00:00.000Z', intent: 'COMMIT' },
      ],
      requiredConfirmations: ['SUPPLIER_1'],
    }
    const result = validateConfirmation(lateNightPlan, {
      role: 'SUPPLIER_1',
      planHash: lateNightPlan.planHash,
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'MATCHES_PLAN', mismatchReasons: [] })
  })

  it('flags QUANTITY_OR_DATE_DIFFERS when only the calendar day differs and the quantity matches', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: PLAN.planHash,
      commitments: [{ quantity: 300, date: '2026-09-17' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'DIFFERS_FROM_PLAN', mismatchReasons: ['QUANTITY_OR_DATE_DIFFERS'] })
  })

  // TEST-013A
  it('flags QUANTITY_OR_DATE_DIFFERS when the confirmed quantity does not match', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: PLAN.planHash,
      commitments: [{ quantity: 299, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'DIFFERS_FROM_PLAN', mismatchReasons: ['QUANTITY_OR_DATE_DIFFERS'] })
  })

  // TEST-013B
  it('flags UNKNOWN_ROLE when the resolved role is not required by the plan', () => {
    const result = validateConfirmation(PLAN, {
      role: null,
      planHash: PLAN.planHash,
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result.verdict).toBe('DIFFERS_FROM_PLAN')
    expect(result.mismatchReasons).toEqual(['UNKNOWN_ROLE'])
  })

  // TEST-013C
  it('flags UNRESOLVED_FACTS when the extraction carries unresolved items', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: PLAN.planHash,
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: ['quantity unclear'],
    })
    expect(result.verdict).toBe('DIFFERS_FROM_PLAN')
    expect(result.mismatchReasons).toContain('UNRESOLVED_FACTS')
  })

  it('flags UNRESOLVED_FACTS when the extraction carries no commitments at all', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: PLAN.planHash,
      commitments: [],
      unresolved: [],
    })
    expect(result.verdict).toBe('DIFFERS_FROM_PLAN')
    expect(result.mismatchReasons).toContain('UNRESOLVED_FACTS')
  })

  // TEST-013D
  it('flags PLAN_SUPERSEDED when the confirmation was read against an older plan hash', () => {
    const result = validateConfirmation(PLAN, {
      role: 'SUPPLIER_1',
      planHash: 'stale-hash',
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result.verdict).toBe('DIFFERS_FROM_PLAN')
    expect(result.mismatchReasons).toEqual(['PLAN_SUPERSEDED'])
  })

  it('does not require a CANCEL commitment to be enumerated by the supplier', () => {
    const stockPlan: ConfirmationPlanContract = {
      planId: 'USE_STOCK',
      planHash: 'stock-hash',
      supplierCommitments: [
        { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 300, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
        { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 200, deliveryDate: '2026-09-18T00:00:00.000Z', intent: 'CANCEL' },
      ],
      internalStockAllocation: 200,
      requiredConfirmations: ['SUPPLIER_1'],
      additionalCost: 0,
    }
    const result = validateConfirmation(stockPlan, {
      role: 'SUPPLIER_1',
      planHash: stockPlan.planHash,
      commitments: [{ quantity: 300, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'MATCHES_PLAN', mismatchReasons: [] })
  })

  // Multiset regression: a role's COMMIT list may legitimately contain two
  // identical entries (an ACCEPT_DELAY split into two `250 Wed` deliveries).
  // Comparing as SETS would let the supplier confirm just ONE of the two and
  // still match, after which apply would mark BOTH rows CONFIRMED for
  // quantity nobody actually promised twice. This must be a MULTISET compare.
  const SPLIT_COMMIT_PLAN: ConfirmationPlanContract = {
    planId: 'ACCEPT_DELAY',
    planHash: 'plan-hash-split',
    supplierCommitments: [
      { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 250, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
      { role: 'SUPPLIER_1', supplierEmail: 'supplier1@example.com', quantity: 250, deliveryDate: '2026-09-16T00:00:00.000Z', intent: 'COMMIT' },
    ],
    internalStockAllocation: 0,
    requiredConfirmations: ['SUPPLIER_1'],
    additionalCost: 0,
  }

  it('flags QUANTITY_OR_DATE_DIFFERS when only one of two identical COMMIT entries is confirmed (multiset, not set, comparison)', () => {
    const result = validateConfirmation(SPLIT_COMMIT_PLAN, {
      role: 'SUPPLIER_1',
      planHash: SPLIT_COMMIT_PLAN.planHash,
      commitments: [{ quantity: 250, date: '2026-09-16' }],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'DIFFERS_FROM_PLAN', mismatchReasons: ['QUANTITY_OR_DATE_DIFFERS'] })
  })

  it('matches when both identical COMMIT entries are confirmed (multiset equality)', () => {
    const result = validateConfirmation(SPLIT_COMMIT_PLAN, {
      role: 'SUPPLIER_1',
      planHash: SPLIT_COMMIT_PLAN.planHash,
      commitments: [
        { quantity: 250, date: '2026-09-16' },
        { quantity: 250, date: '2026-09-16' },
      ],
      unresolved: [],
    })
    expect(result).toEqual({ verdict: 'MATCHES_PLAN', mismatchReasons: [] })
  })
})

function confirmation(overrides: Partial<SupplyConfirmation>): SupplyConfirmation {
  return {
    id: 'confirmation-id',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    caseId: 'case-1',
    planId: PLAN.planId,
    planHash: PLAN.planHash,
    role: 'SUPPLIER_1',
    supplierEmail: 'supplier1@example.com',
    inboundMessageId: 'message-1',
    rfcMessageId: 'rfc-1@example.com',
    confirmedCommitments: [{ quantity: 300, date: '2026-09-16' }],
    verdict: 'MATCHES_PLAN',
    mismatchReasons: [],
    idempotencyKey: 'case-1:plan-hash-1:SUPPLIER_1',
    createdAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  }
}

describe('evaluateConfirmationJoin', () => {
  it('is PENDING when no confirmations have been recorded', () => {
    expect(evaluateConfirmationJoin(PLAN.requiredConfirmations, [])).toBe('PENDING')
  })

  it('is PENDING when only some required roles have matching confirmations', () => {
    const records = [confirmation({ role: 'SUPPLIER_1' })]
    expect(evaluateConfirmationJoin(PLAN.requiredConfirmations, records)).toBe('PENDING')
  })

  it('is COMPLETE when every required role has a MATCHES_PLAN confirmation', () => {
    const records = [
      confirmation({ role: 'SUPPLIER_1' }),
      confirmation({ role: 'SUPPLIER_2', supplierEmail: 'supplier2@example.com', idempotencyKey: 'case-1:plan-hash-1:SUPPLIER_2' }),
    ]
    expect(evaluateConfirmationJoin(PLAN.requiredConfirmations, records)).toBe('COMPLETE')
  })

  it('is BLOCKED when any required role differs from the plan, even if the set is otherwise full', () => {
    const records = [
      confirmation({ role: 'SUPPLIER_1', verdict: 'DIFFERS_FROM_PLAN', mismatchReasons: ['QUANTITY_OR_DATE_DIFFERS'] }),
      confirmation({ role: 'SUPPLIER_2', supplierEmail: 'supplier2@example.com', idempotencyKey: 'case-1:plan-hash-1:SUPPLIER_2' }),
    ]
    expect(evaluateConfirmationJoin(PLAN.requiredConfirmations, records)).toBe('BLOCKED')
  })
})

describe('evaluateConfirmationDeadline', () => {
  const supplyCase = { updatedAt: '2026-09-16T00:00:00.000Z' } as never

  it('is WITHIN before the window elapses', () => {
    expect(evaluateConfirmationDeadline(supplyCase, '2026-09-16T00:00:01.000Z', 60_000)).toBe('WITHIN')
  })

  it('is EXPIRED once the window has elapsed', () => {
    expect(evaluateConfirmationDeadline(supplyCase, '2026-09-16T00:01:00.000Z', 60_000)).toBe('EXPIRED')
  })

  it('falls back to the default window for an unparseable override', () => {
    expect(resolveConfirmationWindowMs({ OM_SUPPLY_CASES_CONFIRMATION_WINDOW_MS: 'not-a-number' })).toBeGreaterThan(0)
  })
})
