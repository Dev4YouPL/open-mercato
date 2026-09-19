import { createInboundSignalSchema } from '../data/inbound-signal'
import type { SupplyCase, SupplyCaseStatus } from '../data/types'
import { buildCandidateList } from '../lib/inbound/candidateList'
import { EMPTY_THREAD_EVIDENCE, type ThreadEvidence, type ThreadMatch } from '../lib/inbound/resolveThread'

const SUPPLIER_1 = 'supplier@hackon-om-wro.cloud'
const SUPPLIER_2 = 'supplier2@hackon-om-wro.cloud'

function supplyCase(overrides: Partial<SupplyCase> = {}): SupplyCase {
  return {
    id: 'case-1',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    correlationId: 'SC-001',
    status: 'RECEIVED',
    needsAttentionReason: null,
    sku: 'MAT-42',
    requiredQuantity: 500,
    requiredDate: '2026-09-16T12:00:00.000Z',
    supplier1Email: SUPPLIER_1,
    supplier2Email: null,
    productionOrderIds: [],
    productionPlanId: null,
    customerCommitmentSnapshot: null,
    originalCommitment: null,
    supplier1Proposal: null,
    alternativeOffer: null,
    initialAnalysis: null,
    initialOptions: null,
    selectedInitialOptionId: null,
    initialProposalId: null,
    initialAnalyzedAt: null,
    initialFactsHash: null,
    initialDecisionIdempotencyKey: null,
    initialDecisionKind: null,
    initialDecisionReason: null,
    finalAnalysis: null,
    resolutionPlans: null,
    selectedResolutionPlanId: null,
    pendingResolutionPlan: null,
    estimatedAdditionalCost: null,
    actualAdditionalCost: null,
    currency: 'PLN',
    supplier1ConfirmedAt: null,
    supplier2ConfirmedAt: null,
    workflowInstanceId: null,
    resolvedAt: null,
    createdAt: '2026-09-14T08:00:00.000Z',
    updatedAt: '2026-09-14T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function threadEvidence(matches: ThreadMatch[], unmatchedReferences: string[] = []): ThreadEvidence {
  return { matches, unmatchedReferences }
}

function threadMatch(overrides: Partial<ThreadMatch> = {}): ThreadMatch {
  return {
    caseId: 'case-1',
    phase: 'ALTERNATIVE_SUPPLY_REQUEST',
    recipientEmail: SUPPLIER_2,
    rfcMessageId: 'request-1@manufacturer.example',
    source: 'IN_REPLY_TO',
    superseded: false,
    ...overrides,
  }
}

describe('buildCandidateList (TEST-004A)', () => {
  it('offers only open cases in which the sender participates', () => {
    const { candidates } = buildCandidateList({
      cases: [
        supplyCase({ id: 'case-open', correlationId: 'SC-001' }),
        supplyCase({ id: 'case-other-supplier', correlationId: 'SC-002', supplier1Email: 'someone@else.example' }),
      ],
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(candidates.map((candidate) => candidate.caseId)).toEqual(['case-open'])
    expect(candidates[0]).toMatchObject({ index: 0, participantRole: 'SUPPLIER_1', threadMatch: false })
  })

  it('recognizes the sender in either supplier role', () => {
    const { candidates } = buildCandidateList({
      cases: [supplyCase({ supplier2Email: SUPPLIER_2 })],
      senderEmail: SUPPLIER_2,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].participantRole).toBe('SUPPLIER_2')
  })

  it('compares participants through address normalization, not raw strings', () => {
    const { candidates } = buildCandidateList({
      cases: [supplyCase({ supplier1Email: 'Supplier@Hackon-OM-Wro.Cloud' })],
      senderEmail: 'supplier@hackon-om-wro.cloud',
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(candidates).toHaveLength(1)
  })

  it.each<[SupplyCaseStatus]>([['RESOLVED'], ['REJECTED'], ['CANCELLED']])(
    'excludes a %s case so a late reply cannot reopen a settled outcome',
    (status) => {
      const { candidates } = buildCandidateList({
        cases: [supplyCase({ status })],
        senderEmail: SUPPLIER_1,
        threadEvidence: EMPTY_THREAD_EVIDENCE,
      })

      expect(candidates).toEqual([])
    },
  )

  it('keeps resumable non-terminal states such as NEEDS_ATTENTION available', () => {
    const { candidates } = buildCandidateList({
      cases: [supplyCase({ status: 'NEEDS_ATTENTION' })],
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(candidates).toHaveLength(1)
  })

  it('excludes a soft-deleted case', () => {
    const { candidates } = buildCandidateList({
      cases: [supplyCase({ deletedAt: '2026-09-15T00:00:00.000Z' })],
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(candidates).toEqual([])
  })

  it('never lets thread evidence pull in a case the sender is not part of', () => {
    const result = buildCandidateList({
      cases: [supplyCase({ id: 'case-foreign', supplier1Email: 'someone@else.example' })],
      senderEmail: SUPPLIER_1,
      threadEvidence: threadEvidence([threadMatch({ caseId: 'case-foreign' })]),
    })

    expect(result.candidates).toEqual([])
    expect(result.unreachableThreadMatches).toHaveLength(1)
    expect(result.unreachableThreadMatches[0].caseId).toBe('case-foreign')
  })

  it('leaves EXISTING_CASE unreachable by construction when nothing is offered', () => {
    const { candidates } = buildCandidateList({
      cases: [],
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    const schema = createInboundSignalSchema(candidates.length)
    const attempt = schema.safeParse({
      intent: 'SUPPLY_PROPOSAL',
      correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
      sku: 'MAT-42',
      commitments: [],
      price: null,
      confidence: 0.9,
      unresolved: [],
      rationale: 'Trying to reach a case that was never offered.',
    })

    expect(candidates).toEqual([])
    expect(attempt.success).toBe(false)
  })

  it('ranks a current thread match above a superseded one and both above no evidence', () => {
    const { candidates } = buildCandidateList({
      cases: [
        supplyCase({ id: 'case-plain', correlationId: 'SC-003' }),
        supplyCase({ id: 'case-superseded', correlationId: 'SC-002' }),
        supplyCase({ id: 'case-current', correlationId: 'SC-001' }),
      ],
      senderEmail: SUPPLIER_1,
      threadEvidence: threadEvidence([
        threadMatch({ caseId: 'case-current', superseded: false }),
        threadMatch({ caseId: 'case-superseded', superseded: true }),
      ]),
    })

    expect(candidates.map((candidate) => candidate.caseId)).toEqual([
      'case-current',
      'case-superseded',
      'case-plain',
    ])
    expect(candidates.map((candidate) => candidate.index)).toEqual([0, 1, 2])
    expect(candidates[1].threadMatchSuperseded).toBe(true)
  })

  it('orders unmatched cases newest first and breaks ties deterministically', () => {
    const cases = [
      supplyCase({ id: 'case-b', correlationId: 'SC-B', createdAt: '2026-09-10T00:00:00.000Z' }),
      supplyCase({ id: 'case-a', correlationId: 'SC-A', createdAt: '2026-09-10T00:00:00.000Z' }),
      supplyCase({ id: 'case-new', correlationId: 'SC-N', createdAt: '2026-09-17T00:00:00.000Z' }),
    ]

    const forward = buildCandidateList({
      cases,
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })
    const reversed = buildCandidateList({
      cases: [...cases].reverse(),
      senderEmail: SUPPLIER_1,
      threadEvidence: EMPTY_THREAD_EVIDENCE,
    })

    expect(forward.candidates.map((candidate) => candidate.caseId)).toEqual(['case-new', 'case-a', 'case-b'])
    // Same inputs, same indices: a replayed run must resolve candidateIndex to
    // the same case, whatever order the store happened to return rows in.
    expect(reversed.candidates).toEqual(forward.candidates)
  })
})
