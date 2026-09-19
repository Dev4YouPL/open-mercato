# Supply Cases Phase 2 — analiza wpływu i pierwsza decyzja sourcingowa

**Date:** 2026-09-19  
**Status:** Ready for implementation  
**Parent spec:** [`2026-09-18-supplier-email-agent-workflow.md`](./2026-09-18-supplier-email-agent-workflow.md)  
**UI spec:** [`2026-09-18-supply-cases-ui.md`](./2026-09-18-supply-cases-ui.md)  
**Scope:** Manufacturer A, moduł `supply_cases`, wyłącznie Phase 2

## 📌 TLDR

Phase 2 prowadzi sprawę od `RECEIVED` do policzonego wpływu, trzech realnych wariantów i jawnej decyzji operatora. Kod wylicza ilości, terminy, wykonalność i konsekwencje; propose-only agent `supply_cases.initial_impact_advisor` wyjaśnia fakty i rekomenduje wariant, ale nie wymyśla danych, nie zatwierdza wyboru i nie kontaktuje dostawców. Ścieżka demo kończy się po wyborze `CHECK_ALTERNATIVE_SUPPLIER`, dostarczeniu jednego logicznego `ALTERNATIVE_SUPPLY_REQUEST` do Supplier 2 i trwałym przejściu do `WAITING_FOR_ALTERNATIVE_OFFER`.

## 📌 Problem Statement

Phase 1 przyjmuje e-mail Supplier 1, tworzy jeden scoped `SupplyCase`, uruchamia trwałą `WorkflowInstance` i wznawia ją po restarcie. Operator nie ma jeszcze odpowiedzi:

- ile materiału będzie dostępne na wymagany termin;
- czy `300 w środę + 200 w piątek` ochroni produkcję i termin klienta;
- czy użycie stocku jest realne i jakie ma konsekwencje;
- czy warto uzyskać ofertę Supplier 2;
- który wariant został świadomie wybrany i dlaczego.

Phase 2 rozdziela odpowiedzialności: kod ustala fakty, agent je interpretuje, a człowiek autoryzuje jeden konkretny efekt.

## 📌 Overview and Success Measures

- **Primary outcome:** operator widzi policzony brak i trzy wykonalne albo jawnie warunkowe opcje, wybiera `CHECK_ALTERNATIVE_SUPPLIER`, Supplier 2 otrzymuje jeden logiczny RFQ, a workflow czeka na ofertę także po restarcie.
- **Baseline:** istnieją scoped JSON repositories, `SupplyCase`, `ProductionPlan`, `ProductionOrder`, `calculatePlanCoverage`, inbound triage, workflow `supply_cases.inbound-case`, T-10b na realnym engine oraz read-only UI/API w trakcie prac.
- **Granica sukcesu:** `WAITING_FOR_ALTERNATIVE_OFFER` nie oznacza zakupu ani rozwiązania problemu. Case nie może być zielony ani `RESOLVED`.
- **Market reference:** dojrzałe systemy oddzielają demand-at-risk, late supply, użycie alternatywnego dostawcy, approval RFQ i stan oczekiwania na ofertę. Przyjmujemy te granice, ale nie budujemy w Phase 2 pełnego optimizera ani sourcing event.

## 📌 Goals

- **REQ-P2-001:** dla case w `RECEIVED` system deterministycznie liczy zapotrzebowanie, pokrycie, brak, spóźnioną ilość oraz wpływ na produkcję i klienta.
- **REQ-P2-002:** `initial_impact_advisor` dostaje zamknięty snapshot faktów i zwraca uziemioną ocenę dokładnie trzech opcji bez mutacji.
- **REQ-P2-003:** operator widzi konsekwencje i musi jawnie wybrać `selectedOptionId`; rekomendacja i confidence niczego nie zaznaczają.
- **REQ-P2-004:** `supply_cases.sourcing.apply_decision` egzekwuje ACL, scope, optimistic locking, proposal freshness i idempotency.
- **REQ-P2-005:** wybór `CHECK_ALTERNATIVE_SUPPLIER` tworzy jeden logiczny RFQ, przechodzi przez `SENDING_ALTERNATIVE_REQUEST` i dopiero po delivery evidence ustawia `WAITING_FOR_ALTERNATIVE_OFFER`.
- **REQ-P2-006:** restart i replay nie tworzą drugiego logicznego RFQ ani efektów niewybranej opcji.
- **REQ-P2-007:** błędy danych, agenta, decyzji lub wysyłki kończą się `NEEDS_ATTENTION`, konfliktem albo retry, nigdy fałszywym sukcesem.

## 📌 Non-goals

- Analiza oferty Supplier 2, `final_resolution_advisor`, druga decyzja i końcowe `ResolutionPlan`.
- Award Supplier 2, finalne `SUPPLY_ACCEPTANCE`, potwierdzenia i `resolution.apply_confirmed`.
- Mutacja `ProductionPlan`, rezerwacja stocku lub status `RESOLVED`.
- Migracja JSON store do ORM i lokalne `db:migrate`.
- Wielopoziomowy MRP/pegging i katalog wielu alternatywnych dostawców.
- Zmiany w aktualnie tworzonych plikach UI i `src/modules/supply_cases/data/read-model.ts` podczas pisania tej specyfikacji.

## 📌 Proposed Solution

1. Workflow przełącza case z `RECEIVED` na `ANALYZING_INITIAL_IMPACT`.
2. Scoped loader pobiera case, plan i orders, a deterministic impact service waliduje spójność i liczy fakty.
3. Kod buduje dokładnie trzy kanoniczne opcje.
4. `initial_impact_advisor` objaśnia opcje, wskazuje zalety, wady i rekomendację po `optionId`.
5. Validator nie pozwala agentowi zmienić liczb, dat, ceny, odbiorcy, wykonalności ani efektów outbound.
6. `supply_cases.analysis.record_initial` zapisuje analysis/options i otwiera wymuszoną human disposition; case przechodzi do `AWAITING_SOURCING_DECISION`.
7. Operator wybiera, odrzuca lub proponuje edycję. Tylko świeży SELECT uruchamia `sourcing.apply_decision`.
8. Dla demo wybór C uruchamia `sourcing.request_alternative`, wysyłkę przez `communication_channels` i trwały wait na ofertę.

## 📌 Domain Rules and Deterministic Impact

### Źródła prawdy

- `requiredQuantity` i `requiredDate`: aktywny `ProductionPlan`; muszą zgadzać się ze snapshotem case.
- Material demand, production due i customer commitment: scoped `ProductionOrder`.
- Aktualna propozycja Supplier 1: typed `supplier1Proposal`.
- Stock: `ProductionPlan.internalStockQuantity`; jest snapshotem dostępności, nie rezerwacją.
- Cena Supplier 2: zawsze `UNKNOWN` w Phase 2.

### Formuły

```text
onTimePrimaryQuantity =
  sum(Supplier 1 deliveries where deliveryDate <= requiredDate)

latePrimaryQuantity =
  sum(Supplier 1 deliveries where deliveryDate > requiredDate)

coverageWithoutStock =
  min(requiredQuantity, onTimePrimaryQuantity)

shortageWithoutStock =
  max(requiredQuantity - coverageWithoutStock, 0)

stockUsed =
  min(stockAvailableQuantity, shortageWithoutStock)

coverageWithStock =
  min(requiredQuantity, onTimePrimaryQuantity + stockUsed)

shortageAfterStock =
  max(requiredQuantity - coverageWithStock, 0)
```

Stare commitment `500` zapisane w planie nie może przesłonić nowej propozycji `300/200`. Impact service analizuje proposal overlay bez mutowania planu.

### Terminy

Service ocenia osobno:

- czy dostawa jest na `requiredDate`;
- czy produkcja jest zagrożona względem `ProductionOrder.dueDate`;
- czy całość może spełnić `customerCommitmentDate`.

Status wyniku: `ON_TIME | AT_RISK | BREACHED | UNKNOWN`. Delivery po required date nie liczy się do plan coverage. Delivery po customer commitment jest `BREACHED`. Jeżeli brakuje danych o lead time, kod nie stwierdza „on time”; używa `AT_RISK` albo `UNKNOWN`.

### Niepewne dane

Brak planu, SKU, quantity, required date albo parsowalnej propozycji jest blocking i daje `NEEDS_ATTENTION`. Brak ceny nie blokuje analizy, ale koszt pozostaje `UNKNOWN`. Brak customer commitment pozwala policzyć materiał, lecz customer impact pozostaje `UNKNOWN`. Agent nie może uzupełniać braków.

### Scenariusz referencyjny

- wymagane `500 × MAT-42`;
- material required date: środa;
- klient potrzebuje całości w czwartek;
- Supplier 1: `300` w środę i `200` w piątek;
- stock snapshot: `200`;
- cena Supplier 2: nieznana.

```text
Supplier 1 on time       300
Supplier 1 late          200
coverage without stock   300/500
shortage without stock   200
coverage with all stock  500/500
stock remaining          0
Friday vs customer Thu   BREACHED
```

## 📌 Agent `supply_cases.initial_impact_advisor`

### Typed input

```ts
type InitialImpactAdvisorInput = {
  schemaVersion: 1
  caseRef: {
    correlationId: string
    sku: string
    status: 'ANALYZING_INITIAL_IMPACT'
  }
  factsHash: string
  demand: {
    requiredQuantity: number
    requiredDate: string
    productionOrders: Array<{
      orderNumber: string
      materialQuantity: number
      dueDate: string
      customerName: string
      customerCommitmentDate: string | null
    }>
  }
  primaryProposal: {
    supplierEmail: string
    deliveries: Array<{ quantity: number; deliveryDate: string }>
  }
  stock: {
    availableQuantity: number
    sourceUpdatedAt: string
  }
  impact: {
    onTimePrimaryQuantity: number
    latePrimaryQuantity: number
    coverageWithoutStock: number
    shortageWithoutStock: number
    coverageWithStock: number
    shortageAfterStock: number
    customerDeadlineStatus: 'ON_TIME' | 'AT_RISK' | 'BREACHED' | 'UNKNOWN'
    reasonCodes: string[]
    latestSafeDecisionAt: string | null
  }
  options: CanonicalInitialOption[]
  unresolved: string[]
}
```

### Typed output

```ts
type InitialImpactAdvisorResult = {
  schemaVersion: 1
  factsHash: string
  summary: string
  optionAssessments: Array<{
    optionId:
      | 'ACCEPT_PRIMARY_DELAY'
      | 'USE_INTERNAL_STOCK'
      | 'CHECK_ALTERNATIVE_SUPPLIER'
    consequenceSummary: string
    whyGood: string[]
    whyBad: string[]
    evidenceRefs: string[]
  }>
  recommendedOptionId:
    | 'ACCEPT_PRIMARY_DELAY'
    | 'USE_INTERNAL_STOCK'
    | 'CHECK_ALTERNATIVE_SUPPLIER'
    | null
  confidence: number
  unresolved: string[]
}
```

Output nie zawiera mutable quantity/date/price/recipient ani command payloadu. Musi mieć dokładnie jedną ocenę dla każdego canonical ID, identyczny `factsHash` i wyłącznie znane `evidenceRefs`.

Agent jest propose-only. Nie ma narzędzi mutacyjnych ani network access. Preferowany kontrakt nie daje mu narzędzi, bo kompletny snapshot jest inputem. Jeżeli runtime wymaga odświeżenia, jedynym narzędziem może być context-bound read-only `supply_cases.initial_impact_facts.get_current`, bez swobodnego `caseId`.

Instrukcja agenta wymaga:

- używać inputu jako jedynego źródła prawdy;
- nie przeliczać i nie zmieniać canonical facts;
- wyjaśnić, że `300 Wed + 200 Fri` nie spełnia customer Thursday;
- nie zakładać ceny Supplier 2;
- opisać dobre i złe konsekwencje każdej opcji;
- rekomendować tylko na podstawie evidence refs;
- traktować confidence jako jakość dowodu, nie autoryzację.

Provider unavailable albo schema-invalid nie tworzy decyzji. Canonical options mogą być pokazane read-only, ale case przechodzi do `NEEDS_ATTENTION`, bez actionable proposal i bez syntetyzowanej rekomendacji.

## 📌 Three Canonical Options

```ts
type CanonicalInitialOption = {
  id:
    | 'ACCEPT_PRIMARY_DELAY'
    | 'USE_INTERNAL_STOCK'
    | 'CHECK_ALTERNATIVE_SUPPLIER'
  factsHash: string
  feasibility: 'FEASIBLE' | 'CONDITIONALLY_FEASIBLE' | 'INFEASIBLE'
  supply: Array<{
    source: 'SUPPLIER_1' | 'INTERNAL_STOCK'
    quantity: number
    date: string | null
  }>
  onTimeCoverage: number
  shortageOnRequiredDate: number
  stockRemaining: number
  productionImpact: 'ON_TIME' | 'AT_RISK' | 'BREACHED' | 'UNKNOWN'
  customerImpact: 'ON_TIME' | 'AT_RISK' | 'BREACHED' | 'UNKNOWN'
  cost: {
    status: 'KNOWN' | 'UNKNOWN'
    amount: number | null
    currency: string
  }
  risks: string[]
  requiredConfirmations: string[]
  outboundEffects: string[]
}
```

### `ACCEPT_PRIMARY_DELAY`

- Używa dokładnie `300 Wed / 200 Fri`.
- W przykładzie ma `300/500` na required date, a Friday przekracza customer Thursday.
- Jest operacyjnie możliwe, lecz `INFEASIBLE` względem bieżącego customer commitment, dopóki klient nie zaakceptuje zmiany.
- Koszt nie jest automatycznie `0`; bez jawnego źródła jest `UNKNOWN`.
- Po wyborze tworzy canonical `ACCEPT_DELAY` pending plan i prosi Supplier 1 o potwierdzenie.
- Nie kontaktuje Supplier 2 i nie zmienia jeszcze produkcji.

### `USE_INTERNAL_STOCK`

- Używa `300` od Supplier 1 oraz do `200` stocku.
- Może dać `500/500`, ale nie rezerwuje ani nie zużywa stocku w Phase 2.
- Pokazuje stock remaining; w przykładzie `0`.
- Ryzyka: konflikt rezerwacji, wyzerowanie bufora, wpływ na inne orders, nieznany koszt.
- Wymaga potwierdzenia allocatable stock i commitment Supplier 1 `300 Wed`.
- Po wyborze tworzy `USE_STOCK` pending plan; nie kontaktuje Supplier 2.

### `CHECK_ALTERNATIVE_SUPPLIER`

- RFQ dotyczy dokładnie `shortageWithoutStock`, np. `200 × MAT-42`, i wymaganej daty z planu.
- Do chwili oferty coverage nadal wynosi `300/500`; to zakup informacji, nie rozwiązanie.
- Cena i realna dostępność Supplier 2 są `UNKNOWN`.
- Ryzyka: brak odpowiedzi, odpowiedź po safe-decision time, wysoka cena.
- Po wyborze wysyła jeden logiczny `ALTERNATIVE_SUPPLY_REQUEST`.
- Jest uzasadnione, gdy akceptacja S1 łamie termin, a użycie całego stocku jest ryzykowne. Jeżeli odpowiedź nie może nadejść przed `latestSafeDecisionAt`, opcja musi być warunkowa albo niewykonalna.

## 📌 Human Decision

Case przechodzi do `AWAITING_SOURCING_DECISION` dopiero po zapisaniu valid analysis, trzech options i actionable AgentProposal. Żadna opcja nie jest preselected.

```ts
type InitialSourcingDisposition = {
  caseId: string
  proposalId: string
  factsHash: string
  expectedUpdatedAt: string
  kind: 'SELECT' | 'REJECT' | 'EDIT'
  selectedOptionId: InitialOptionId | null
  reason: string | null
  idempotencyKey: string
}
```

- `SELECT` wymaga `selectedOptionId`.
- `REJECT` wymaga reason, ustawia `REJECTED` i nie wykonuje outbound.
- `EDIT` wymaga option ID i reason, tworzy nową wersję propozycji w granicach typed edit schema oraz wymaga ponownego SELECT; sama edycja niczego nie wysyła.
- `proposalId`, `factsHash` i `expectedUpdatedAt` muszą być aktualne.
- Stale action zwraca 409, UI pokazuje unified conflict i wymaga refetch.
- Serwer egzekwuje `supply_cases.decisions.apply`, tenant/org scope i membership option ID.
- Replay tego samego idempotency key zwraca poprzedni wynik; inny wybór po skutecznym SELECT jest konfliktem.
- UI używa Caseload lub guarded command route. Nie powstaje direct `PATCH`.

## 📌 Selected Demo Path

`supply_cases.sourcing.apply_decision` jest jedynym ownerem pierwszego wyboru. Dla C dispatchuje `supply_cases.sourcing.request_alternative`. Recipient, quantity i required date pochodzą z trusted case/option snapshot, nigdy z UI lub narracji agenta.

Idempotency key:

```text
{caseId}:ALTERNATIVE_SUPPLY_REQUEST:{normalizedSupplier2Email}
```

Przed compose command robi `OutboundCorrelation.recordIfAbsent` z canonical RFC Message-ID. Ten sam Message-ID trafia do communication hub, aby reply mógł być skorelowany. Body jest czytelnym tekstem z SKU, ilością, required date i prośbą o cenę/walutę.

Wymagany transport seam:

- ten sam app idempotency key reużywa ten sam hub message i link;
- `messages.messages.compose` korzysta z istniejącego `idempotencyKey`;
- official `communicationChannelsSendAsUser` musi dostać minimalne, addytywne optional idempotency albo równoważny official helper;
- nie wolno użyć raw ORM ani HTTP self-call z `supply_cases`.

Po accepted compose status to `SENDING_ALTERNATIVE_REQUEST`. Dopiero scoped `communication_channels.message.sent` lub persisted terminal success jest delivery evidence i przełącza case na `WAITING_FOR_ALTERNATIVE_OFFER`. Exhausted delivery failure daje `NEEDS_ATTENTION: DELIVERY_FAILED`.

SMTP/Gmail ma semantykę at-least-once w crash window po zewnętrznym send. „Jeden RFQ” oznacza jeden logical request/message/link i brak drugiego compose wskutek replayu; spec nie obiecuje fizycznego exactly-once poza możliwościami providera.

## 📌 State Machine

| From | Trigger | To | Invariant |
|---|---|---|---|
| `RECEIVED` | workflow | `ANALYZING_INITIAL_IMPACT` | scoped snapshot |
| `ANALYZING_INITIAL_IMPACT` | analysis success | `AWAITING_SOURCING_DECISION` | facts + 3 options + proposal |
| `ANALYZING_INITIAL_IMPACT` | data/agent failure | `NEEDS_ATTENTION` | brak outbound |
| `AWAITING_SOURCING_DECISION` | SELECT C | `SENDING_ALTERNATIVE_REQUEST` | selected ID persisted once |
| `AWAITING_SOURCING_DECISION` | SELECT A/B | `SENDING_PLAN_ACCEPTANCE` | canonical pending seam, bez Supplier 2 |
| `AWAITING_SOURCING_DECISION` | REJECT | `REJECTED` | terminal, bez outbound |
| `SENDING_ALTERNATIVE_REQUEST` | delivery evidence | `WAITING_FOR_ALTERNATIVE_OFFER` | jeden logical RFQ |
| `SENDING_ALTERNATIVE_REQUEST` | retry exhausted | `NEEDS_ATTENTION` | `DELIVERY_FAILED` |
| `WAITING_FOR_ALTERNATIVE_OFFER` | timeout | `NEEDS_ATTENTION` | `WAIT_TIMEOUT` |
| `WAITING_FOR_ALTERNATIVE_OFFER` | correlated offer | `ANALYZING_CONFIRMED_OFFER` | Phase 3 seam |

Żaden stan Phase 2 nie ustawia `RESOLVED`.

## 📌 Workflow Steps, Commands and Events

### Workflow steps

| Step ID | Type | Responsibility |
|---|---|---|
| `start` | `START` | istniejący start |
| `calculate-initial-impact` | `AUTOMATED` | loader + impact service |
| `initial-impact-advisor` | parked signal + `INVOKE_AGENT` | forced human proposal |
| `apply-sourcing-decision` | `AUTOMATED` | dispatch wybranej branch |
| `send-alternative-request` | `AUTOMATED` | idempotent send C |
| `await-alternative-delivery` | `WAIT_FOR_SIGNAL` | delivery evidence |
| `await-reply` | `WAIT_FOR_SIGNAL` | istniejący ID, teraz Supplier 2 offer wait |

Workflow ID `supply_cases.inbound-case` i signal `supply_cases.inbound.reply` pozostają stabilne. Aktywne stare instancje nie są ręcznie przepisywane; demo/test fixture są resetowane, a nierozpoznany stary stan trafia do explicit reanalysis lub `NEEDS_ATTENTION`.

### Commands

- `supply_cases.analysis.record_initial`
- `supply_cases.sourcing.apply_decision`
- `supply_cases.sourcing.request_alternative`
- `supply_cases.resolution.request_confirmation` — wyłącznie A/B seam
- `supply_cases.case.mark_needs_attention`

Wszystkie writes używają command bus, Zod, trusted scope, optimistic lock i post-commit side effects.

### Events/signals

- istniejący `supply_cases.case.proposal_received`;
- nowy `supply_cases.initial_impact.recorded`;
- nowy `supply_cases.sourcing_decision.applied`;
- istniejące `communication_channels.message.sent` i `.delivery_failed`;
- nowy `supply_cases.alternative_request.sent`;
- istniejący signal `supply_cases.inbound.reply`.

Payloady zawierają IDs i scope, nie body, analysis ani customer snapshots.

## 📌 Data Model and Ownership

### Existing fields used

- `initialAnalysis`: typed facts, hash, data quality, agent narrative/recommendation.
- `initialOptions`: dokładnie trzy typed options.
- `selectedInitialOptionId`: null do skutecznego SELECT, potem immutable.
- `status`, `needsAttentionReason`, `updatedAt`: state, failure i locking.
- `workflowInstanceId`: scalar reference do workflows.

### Additive metadata

- `initialProposalId`: nullable scalar do AgentProposal.
- `initialAnalyzedAt`: timestamp.
- `initialFactsHash`: stale-decision guard.

W JSON demo te wartości mogą być częścią typed `initialAnalysis`, jeżeli read/command schemas mają jeden jawny kontrakt. Future ORM powinien użyć scalar columns. Agent Orchestrator pozostaje ownerem technical run/proposal/disposition, workflows ownerem instancji, communication hub ownerem body/delivery/retry, a `supply_cases` ownerem business facts, selection i `OutboundCorrelation`.

## 📌 API and UI Contracts

Istniejący `GET /api/supply-cases/{id}` zostanie rozszerzony po zakończeniu in-flight UI Phase 1. Response pokazuje:

1. wymagane `500`, on-time `300`, late `200`, shortage `200`;
2. required date i customer commitment;
3. data-quality issues i analysis timestamp;
4. agent summary, recommendation i confidence oznaczone jako evidence;
5. trzy kompletne karty: feasibility, quantities/dates, coverage, shortage, stock remaining, impact, koszt known/unknown, risks, confirmations i outbound effects;
6. decision panel bez preselection;
7. read-only history po decyzji;
8. delivery/wait/attention/conflict state bez zielonego success.

Decision mutation działa przez Caseload disposition lub guarded command route, z `useGuardedMutation(...).runMutation(...)`, optimistic-lock header i `surfaceRecordConflict`. Brak generycznego PATCH.

UI wymaga i18n `pl/en/de/es/ko`, semantic tokens, keyboard radio behavior, Cmd/Ctrl+Enter, Escape, focus na alert, live region, light/dark/narrow. Raw JSON, raw provider errors i niesanitized body nie są renderowane.

## 📌 Failure Handling

| Failure | Required behavior |
|---|---|
| brak planu/proposal/quantity/date | `NEEDS_ATTENTION`, brak agenta/decyzji/outbound |
| missing customer date | customer impact `UNKNOWN`, bez „on time” |
| agent unavailable/schema-invalid/hash mismatch | brak actionable proposal; `NEEDS_ATTENTION` |
| agent rekomenduje infeasible option | code feasibility wygrywa; manual review |
| stale proposal/version | 409, refetch, zero side effects |
| duplicate decision | idempotent same result albo 409 przy innym wyborze |
| forbidden/cross-scope | fail closed, brak existence leak |
| Supplier 2/channel missing | option infeasible lub `NEEDS_ATTENTION` |
| delivery pending | pozostaje `SENDING_ALTERNATIVE_REQUEST` |
| transient failure | bounded retry z tym samym logical message |
| exhausted failure | `NEEDS_ATTENTION: DELIVERY_FAILED` |
| offer timeout | `NEEDS_ATTENTION: WAIT_TIMEOUT`, bez auto-resend |
| restart | ta sama WorkflowInstance i wait |
| replay event | no-op po status/idempotency guard |

## 📌 Integration Coverage

Testy tworzą własny tenant/org fixture i sprzątają rekordy.

| Test ID | Scenario | Assertions |
|---|---|---|
| `TEST-005` | impact + initial agent dla 500, S1 300 Wed/200 Fri, customer Thu | facts 300/500, shortage 200, Friday breach; trzy IDs; no mutation |
| `TEST-005A` | missing/invalid facts i agent unavailable/schema-invalid | `NEEDS_ATTENTION`, no fabricated facts/proposal/outbound |
| `TEST-005B` | agent/prompt próbuje zmienić recipient/quantity | canonical option bez zmian, brak action path |
| `TEST-006` | explicit SELECT C, delivery, restart, replay | one logical RFQ/message/link; delivery evidence; same workflow waits after restart; no second RFQ |
| `TEST-006A` | SELECT A i B osobno | canonical pending plan; tylko Supplier 1 seam; zero Supplier 2; no production mutation |
| `TEST-006B` | recommendation only, REJECT, EDIT, stale, forbidden, cross-scope | zero outbound i zero efektów niewybranej opcji |
| `TEST-006C` | delivery retry/exhaustion | ten sam key; brak false waiting; final `DELIVERY_FAILED` |
| `TEST-006D` | browser/detail | no preselection, trzy karty, keyboard, select C, conflict/refetch, non-green wait |

`TEST-006` używa realnego database workflow engine i dowodzi restartu. Live e-mail smoke jest osobno tagowany i wymaga jawnych credentials.

## 📌 Security and Compatibility

- Każdy lookup/write/event jest scoped tenant + organization i fail-closed.
- Agent nie widzi credentiali, provider payloadów ani innych cases.
- Recipient Supplier 2 nie pochodzi z e-maila, modelu ani UI.
- Confidence nigdy nie jest autoryzacją.
- Publiczne IDs są addytywne; existing statuses, ACL IDs, workflow ID i reply signal pozostają.
- Optional idempotency extension communication facade nie zmienia zachowania callerów bez klucza.
- Nie uruchamiamy migracji; JSON schema ma backward-compatible defaults.

## 📋 Implementation Plan

1. **P2-01:** typed schemas, reason codes i canonical option types.
2. **P2-02:** scoped snapshot loader oraz pure impact service z referencyjnym testem.
3. **P2-03:** deterministic factory dokładnie trzech opcji.
4. **P2-04:** `initial_impact_advisor` i strict result validation.
5. **P2-05:** `analysis.record_initial`, events i attention paths.
6. **P2-06:** rozszerzenie istniejącego workflow o calculate/advisor/disposition; aktualizacja T-10b oracle.
7. **P2-07:** Caseload disposition bridge i `sourcing.apply_decision` z ACL/locking/idempotency.
8. **P2-08:** official optional idempotency seam w `communicationChannelsSendAsUser`; osobny focused framework test.
9. **P2-09:** `sourcing.request_alternative`, correlation claim, composer, delivery evidence, retry/timeout.
10. **P2-10:** realne A/B pending seams i `TEST-006A`.
11. **P2-11:** po zakończeniu UI Phase 1 rozszerzenie detail projection/cards/actions/conflict/i18n/a11y.
12. **P2-12:** TEST-005/006/006A, no-side-effect/security/UI suites, DB restart oracle, `yarn generate`, typecheck, focused lint/test i DS check.

## 📌 Acceptance Criteria

- [ ] Operator widzi `300/500`, shortage `200` i informację, że Friday nie spełnia customer Thursday.
- [ ] Widzi dokładnie trzy realne opcje oraz ich dobre i złe konsekwencje.
- [ ] Agent może rekomendować, ale nie mutuje, nie wysyła i nie preselectuje.
- [ ] Jawny, świeży `selectedOptionId` jest wymagany.
- [ ] Wybór C tworzy jeden logical `ALTERNATIVE_SUPPLY_REQUEST`.
- [ ] `WAITING_FOR_ALTERNATIVE_OFFER` następuje dopiero po delivery evidence.
- [ ] Workflow trwa po restarcie i czeka na ofertę.
- [ ] Replay nie tworzy drugiego logical RFQ.
- [ ] A/B nie kontaktują Supplier 2; C nie wykonuje efektów A/B.
- [ ] Missing data, agent failure, delivery failure i stale decision nie dają false success.
- [ ] Case nie jest `RESOLVED`, a UI nie pokazuje zielonego/finalnego stanu.
- [ ] `TEST-005`, `TEST-006`, `TEST-006A` i no-side-effect coverage przechodzą.

## 📌 Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Scope cohesion | pass | impact → human choice → RFQ/wait; Phase 3/4 tylko seams |
| Ownership | pass | app/workflow/orchestrator/channel boundaries jawne |
| Human authority | pass | no preselection/auto-approval |
| Failure safety | pass | attention/conflict/retry i no-side-effect tests |
| Testability | pass | każdy task ma named oracle |
| Backward compatibility | pass | addytywne kontrakty, istniejące IDs zachowane |

**Verdict: Ready for implementation.**

## Implementation decision addendum — 2026-09-19

The owner accepted the current Phase 2 mechanism: `WAIT_FOR_SIGNAL` for the initial impact result
and the app-owned guarded decision route for the human sourcing decision. This preserves propose-only
agent behavior, human authority, tenant/organization scope, optimistic locking and idempotency.
The planned `INVOKE_AGENT`/Caseload bridge is a future-compatible migration seam, not a Phase 2
exit-gate blocker.

`TEST-006B` is now covered by `phase2-decision.test.ts`: `REJECT` and `EDIT` assert zero outbound
effects, preserve the production plan, and keep replay idempotent. The remaining Phase 2 blockers
are environmental: one live provider run and one real RFQ delivery with platform delivery evidence.

## Implementation Status

Source doc: .ai/specs/2026-09-19-supply-cases-phase-2-initial-impact.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 2 — initial impact and first sourcing decision | in_progress | Phase 1 read-only queue and existing inbound workflow | TEST-005, TEST-005A/B, TEST-006, TEST-006A/B/C/D | Closure run 2026-09-19: local Playwright `supply-cases-phase2-decision.spec.ts` 1/1 passed with three unselected options, Supplier 2 selection, stale `409`, refetch, no direct PATCH and no false success; read-only browser 3/3 also passed. | **NOT met.** Browser evidence is complete for this slice, but no real RFQ has been delivered, no live provider run has occurred, and the remaining documented Phase 2 contract/test gaps remain open. |

### Phase 2 progress

- [x] deterministic impact slice: `data/initial-impact.ts`, `lib/impact/initialImpactService.ts`, supplier proposal snapshot wiring — reference shortage `300/500`, shortage `200`, Friday customer breach covered by `initial-impact.test.ts` — `yarn test src/modules/supply_cases/__tests__/initial-impact.test.ts --runInBand` passed
- [x] advisor contract slice: `ai-agents.ts`, `lib/impact/runInitialImpactAdvisor.ts`, DI invoker — strict facts hash/evidence validation and no action vocabulary covered — `yarn test src/modules/supply_cases/__tests__/initial-impact.test.ts src/modules/supply_cases/__tests__/inbound-triage-agent.test.ts --runInBand` passed
- [x] guarded command slice: `commands/initial-impact.ts`, `commands/sourcing.ts`, `lib/sourcing/alternativeRequest.ts` — scoped optimistic-lock/idempotency/no-direct-PATCH seams are present; focused command integration and outbound delivery evidence remain to be added
- [x] delivery evidence slice: scoped `communication_channels.message.sent` and terminal failure subscribers correlate through the trusted RFC Message-ID; accepted compose remains `SENDING_ALTERNATIVE_REQUEST`, confirmed delivery moves to `WAITING_FOR_ALTERNATIVE_OFFER`
- [x] focused decision slice: SELECT C creates one logical RFQ and replay creates none; SELECT A/B creates only a pending plan and does not contact Supplier 2 (`phase2-decision.test.ts`)
- [x] atomic decision claim: `phase2-decision.test.ts` — exactly one of two concurrent decisions claims the expected version; the guarded route returns `428` without the optimistic-lock header and a typed `409` with `currentUpdatedAt` on conflict (`read-api.test.ts`)
- [x] actionable read-model/API/UI option projection: `api/[id]/decision/route.ts` behind `supply_cases.decisions.apply`, plus `__integration__/supply-cases-phase2-decision.spec.ts` — three options rendered, none preselected, select C, stale submit `409`, conflict bar, refetch (TEST-006D)
- [x] explicit Phase 2 workflow transitions: `workflows.ts` declares `start → initial-impact-advisor → human-sourcing-decision → alternative-request-delivery → await-reply → end` with five named transitions
- [x] real database workflow restart/replay TEST-006: `__tests__/inbound-workflow-engine.db.test.ts` over live Postgres — SELECT C sends once, the instance parks at `alternative-request-delivery`, delivery evidence moves the case to `WAITING_FOR_ALTERNATIVE_OFFER` and the instance to `await-reply`, a real restart preserves both, and the replay returns `already_applied` with still exactly one send
- [x] timeout and exhausted transient retry handling: `phase2-decision.test.ts` TEST-006C, plus the assertion that the offer timeout starts only after delivery advances the workflow
- [x] browser decision closure: `__integration__/supply-cases-phase2-decision.spec.ts` 1/1 verifies three options without preselection, Supplier 2 selection, stale optimistic-lock `409`, refetch to the unchanged decision state, only `POST /api/supply_cases/{id}/decision`, no direct `PATCH`, and no false success status

#### Remaining for the Phase 2 exit gate

- [ ] **BLOCKED (environment): live provider run.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are empty in `.env`, so `initial_impact_advisor` has never executed against a real model. Every impact test injects the invoker through DI.
- [ ] **BLOCKED (never attempted): one real RFQ delivered.** The exit gate says "exactly one *real* RFQ is delivered". TEST-006 and `send-supplier-message.test.ts` both inject a `SupplierOutboundPorts.send` that appends to an array; `communicationChannelsSendAsUser` has never carried an `ALTERNATIVE_SUPPLY_REQUEST` over the live SMTP channel.
- [ ] **TEST-006B is partial.** Stale is covered by the concurrent-claim test and the browser 409; forbidden/cross-scope by `read-api.test.ts`. `REJECT` and `EDIT` have **no test at all** — both branches exist in `commands/sourcing.ts` and their zero-outbound, zero-plan-mutation property is unasserted.
- [ ] **Deviation needing an owner decision.** Plan step 4 and task P2-07 call for a workflow `INVOKE_AGENT` step and a Caseload disposition bridge. The implementation uses a `WAIT_FOR_SIGNAL` step (`initial-impact-advisor`) fed by `supply_cases.analysis.record_initial`, and routes the human decision through this module's own API. Propose-only and human authority are preserved, but the spec must either accept this design or the bridge must be built.
- [ ] **Known consequence of the A/B contract.** `commands/sourcing.ts` returns early for `ACCEPT_PRIMARY_DELAY` and `USE_INTERNAL_STOCK` without signalling `SOURCING_DECISION_SIGNAL`, so the instance stays parked at `human-sourcing-decision`. Correct for Phase 2's no-side-effect rule; that durable path needs a consumer in a later phase.

Audit record: [`../runs/2026-09-19-phase1-phase2-browser-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-browser-closure/STATE.md).

> **ID collision warning.** `__tests__/send-supplier-message.test.ts` labels the outbound-seam cases `TEST-005A`–`TEST-005I`, which are unrelated to this spec's `TEST-005A`/`TEST-005B`. Do not match by ID alone.

## 📌 Open Questions

Brak pytań blokujących. Implementacja ma użyć stabilnego Caseload surface; jeśli embedded surface nie jest publicznym kontraktem, obowiązuje deep-link fallback bez zmiany ownership.

## 📌 Changelog

| Data | Zmiana |
|---|---|
| 2026-09-19 | Audyt domknięcia Phase 1/Phase 2. Pięć pozycji wcześniej oznaczonych jako otwarte zostało zamkniętych realnie uruchomionymi oracles: atomic decision claim, actionable API/UI projection, real-DB `TEST-006` restart/replay, timeout/exhausted retry oraz explicit workflow transitions. Faza pozostaje `in_progress`, bo exit gate nadal nie jest spełniony: brak live provider run (puste klucze API), brak realnie dostarczonego RFQ (każdy test wstrzykuje fałszywy send port), `TEST-006B` bez pokrycia `REJECT`/`EDIT`, oraz niezaakceptowana odchyłka od kroku 4 / P2-07 (`INVOKE_AGENT` + Caseload bridge zastąpione `WAIT_FOR_SIGNAL` i własnym guarded route). Zapis: [`../runs/2026-09-19-phase1-phase2-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-closure/STATE.md). |
| 2026-09-19 | Pierwsza wersja Phase 2: impact, initial advisor, trzy opcje, human decision, idempotent RFQ i durable wait. |
