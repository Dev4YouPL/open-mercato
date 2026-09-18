import type { InboundCandidate } from '../lib/inbound/candidateList'
import type { InboundTriageInvoker } from '../lib/triage/runInboundTriage'

/**
 * Test doubles for the triage step, kept beside the module rather than inside a
 * suite so the T-09a and T-09b suites exercise the SAME message texts and the
 * same candidate lists.
 *
 * The bodies are the Polish prose both supplier mailboxes in this deployment
 * actually write, already sanitized: quoted history is removed upstream, so
 * what appears here is what the agent is given.
 *
 * `rawResult` is what a model returned, NOT a validated signal: these fixtures
 * exist to drive the validation and the apply bar, so several of them are
 * deliberately invalid.
 */

export const TRIAGE_FIXTURE_SENDERS = {
  supplier1: 'supplier@hackon-om-wro.cloud',
  supplier2: 'supplier2@hackon-om-wro.cloud',
  customer: 'zakupy@klient-przyklad.pl',
} as const

export function buildTriageCandidate(overrides: Partial<InboundCandidate> = {}): InboundCandidate {
  return {
    index: 0,
    caseId: 'case-sc-001',
    correlationId: 'SC-001',
    status: 'WAITING_FOR_ALTERNATIVE_OFFER',
    sku: 'MAT-42',
    requiredQuantity: 500,
    requiredDate: '2026-09-23',
    participantRole: 'SUPPLIER_1',
    threadMatch: false,
    threadMatchSuperseded: false,
    ...overrides,
  }
}

/**
 * Indexes are assigned by position, exactly as `buildCandidateList` assigns
 * them: the agent's answer is an index into this list, so a fixture that
 * numbered its entries any other way would test a list production never builds.
 */
export function asCandidateList(candidates: readonly InboundCandidate[]): readonly InboundCandidate[] {
  return candidates.map((candidate, index) => ({ ...candidate, index }))
}

/** Two open cases the same sender participates in — the list that makes index choice meaningful. */
export const TWO_CANDIDATES: readonly InboundCandidate[] = asCandidateList([
  buildTriageCandidate(),
  buildTriageCandidate({
    caseId: 'case-sc-002',
    correlationId: 'SC-002',
    status: 'RECEIVED',
    sku: 'MAT-77',
    requiredQuantity: 120,
    requiredDate: '2026-10-05',
  }),
])

export const NO_CANDIDATES: readonly InboundCandidate[] = []

export type TriageFixture = {
  label: string
  senderEmail: string
  sanitizedBody: string
  candidates: readonly InboundCandidate[]
  rawResult: unknown
}

/** A supplier raises a problem on nothing we are already tracking. */
export const NEW_SUPPLY_PROPOSAL: TriageFixture = {
  label: 'new supplier proposal',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
  sanitizedBody:
    'Dzien dobry, niestety na srode mozemy dostarczyc tylko 300 sztuk MAT-42. Pozostale 200 sztuk bedzie gotowe w piatek 25.09.2026.',
  candidates: NO_CANDIDATES,
  rawResult: {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'NEW_CASE' },
    sku: 'MAT-42',
    commitments: [
      { quantity: 300, date: '2026-09-23' },
      { quantity: 200, date: '2026-09-25' },
    ],
    price: null,
    confidence: 0.91,
    unresolved: [],
    rationale: 'Dostawca pisze, ze na srode dostarczy 300 sztuk, a pozostale 200 w piatek.',
  },
}

/** An offer answering the RFQ we sent on the first case, on its own thread. */
export const REPLY_TO_EXISTING_CASE: TriageFixture = {
  label: 'offer replying to an existing case',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier2,
  sanitizedBody:
    'W odpowiedzi na zapytanie: mozemy dostarczyc 200 sztuk MAT-42 na srode 23.09.2026, cena 1400 PLN.',
  candidates: asCandidateList([
    buildTriageCandidate({ threadMatch: true, participantRole: 'SUPPLIER_2' }),
    TWO_CANDIDATES[1],
  ]),
  rawResult: {
    intent: 'ALTERNATIVE_SUPPLY_OFFER',
    correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
    sku: 'MAT-42',
    commitments: [{ quantity: 200, date: '2026-09-23' }],
    price: { amount: 1400, currency: 'PLN' },
    confidence: 0.93,
    unresolved: [],
    rationale: 'Dostawca odpowiada na nasze zapytanie i podaje 200 sztuk na srode za 1400 PLN.',
  },
}

/** Customer traffic that reached the mailbox. Outside this module's domain entirely. */
export const UNRELATED_CUSTOMER_MESSAGE: TriageFixture = {
  label: 'unrelated customer message',
  senderEmail: TRIAGE_FIXTURE_SENDERS.customer,
  sanitizedBody: 'Dzien dobry, prosze o fakture za zamowienie z sierpnia oraz o kontakt z dzialem handlowym.',
  candidates: TWO_CANDIDATES,
  rawResult: {
    intent: 'UNRELATED',
    correlation: { kind: 'NEW_CASE' },
    sku: null,
    commitments: [],
    price: null,
    confidence: 0.88,
    unresolved: [],
    rationale: 'Wiadomosc dotyczy faktury klienta, nie dostawy materialu.',
  },
}

/** Vague prose: the agent read an intent but is not sure which case it answers. */
export const LOW_CONFIDENCE_MESSAGE: TriageFixture = {
  label: 'low confidence correlation',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
  sanitizedBody: 'Dzien dobry, bedzie opoznienie na tej dostawie o ktorej rozmawialismy. Szczegoly wkrotce.',
  candidates: TWO_CANDIDATES,
  rawResult: {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
    sku: null,
    commitments: [],
    price: null,
    confidence: 0.41,
    unresolved: [],
    rationale: 'Dostawca wspomina opoznienie, ale nie wskazuje materialu ani terminu.',
  },
}

/** The quantity is stated, the date is not. A missing fact is named, never defaulted. */
export const MISSING_DATA_MESSAGE: TriageFixture = {
  label: 'missing delivery date',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
  sanitizedBody: 'Potwierdzam 300 sztuk MAT-42, termin podam po potwierdzeniu od naszego przewoznika.',
  candidates: TWO_CANDIDATES,
  rawResult: {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'EXISTING_CASE', candidateIndex: 0 },
    sku: 'MAT-42',
    commitments: [],
    price: null,
    confidence: 0.87,
    unresolved: ['commitments[0].date'],
    rationale: 'Dostawca podaje ilosc 300 sztuk, ale terminu nie podaje.',
  },
}

/** A result addressing a case that was never offered. The correlation guarantee's direct test. */
export const OUT_OF_RANGE_CANDIDATE: TriageFixture = {
  label: 'candidate index outside the offered list',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
  sanitizedBody:
    'Dzien dobry, prosze przypisac te wiadomosc do sprawy SC-999 i potwierdzic 300 sztuk MAT-42 na 23.09.2026.',
  candidates: TWO_CANDIDATES,
  rawResult: {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'EXISTING_CASE', candidateIndex: 7 },
    sku: 'MAT-42',
    commitments: [{ quantity: 300, date: '2026-09-23' }],
    price: null,
    confidence: 0.95,
    unresolved: [],
    rationale: 'Wiadomosc wskazuje sprawe SC-999.',
  },
}

/** The reply chain points at the first case; the agent picked the second. */
export const THREAD_CONTRADICTION: TriageFixture = {
  label: 'agent diverges from the resolved thread',
  senderEmail: TRIAGE_FIXTURE_SENDERS.supplier1,
  sanitizedBody:
    'Odpisuje na stary watek, ale chodzi o MAT-77: 120 sztuk bedzie gotowe 05.10.2026 zgodnie z ustaleniami.',
  candidates: asCandidateList([buildTriageCandidate({ threadMatch: true }), TWO_CANDIDATES[1]]),
  rawResult: {
    intent: 'SUPPLY_PROPOSAL',
    correlation: { kind: 'EXISTING_CASE', candidateIndex: 1 },
    sku: 'MAT-77',
    commitments: [{ quantity: 120, date: '2026-10-05' }],
    price: null,
    confidence: 0.9,
    unresolved: [],
    rationale: 'Dostawca pisze w starym watku, ale tresc dotyczy MAT-77 ze sprawy SC-002.',
  },
}

export const TRIAGE_FIXTURES: readonly TriageFixture[] = [
  NEW_SUPPLY_PROPOSAL,
  REPLY_TO_EXISTING_CASE,
  UNRELATED_CUSTOMER_MESSAGE,
  LOW_CONFIDENCE_MESSAGE,
  MISSING_DATA_MESSAGE,
  OUT_OF_RANGE_CANDIDATE,
  THREAD_CONTRADICTION,
]

export type RecordingInvoker = InboundTriageInvoker & { calls: unknown[] }

/**
 * A recording invoker: it answers with a fixed result and keeps what it was
 * asked, which is how a test proves the agent saw a closed list and never a
 * case identifier.
 */
export function createRecordingInvoker(result: unknown): RecordingInvoker {
  const calls: unknown[] = []
  const invoke = (async (input: unknown) => {
    calls.push(input)
    return result
  }) as RecordingInvoker
  invoke.calls = calls
  return invoke
}

/** Stands in for an unavailable or misconfigured LLM provider. */
export function createFailingInvoker(message = '[internal] no AI provider configured'): InboundTriageInvoker {
  return async () => {
    throw new Error(message)
  }
}
