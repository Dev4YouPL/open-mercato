# Manufacturer Supply Exception: Email, Agent Analysis, Human Decisions, and Resolution

**Date:** 2026-09-18  
**Status:** Draft for user review  
**Scope:** Manufacturer A only

## 📣 TLDR

Manufacturer A odbiera prawdziwy e-mail o problemie dostawy, koreluje go z lokalnym zapotrzebowaniem i uruchamia trwały workflow. Propose-only agent analizuje wpływ na zapotrzebowanie, zapas, zlecenia produkcyjne i terminy klientów; człowiek najpierw wybiera sprawdzenie Supplier 2, a po otrzymaniu realnej oferty wybiera kompletny plan rezolucji. System wysyła decyzje do obu dostawców, czeka na wymagane potwierdzenia i dopiero wtedy atomowo aktualizuje lokalny plan, przelicza ryzyko oraz zamyka case jako `RESOLVED`.

## 📣 Problem Statement

Wiadomość od Supplier 1 informuje, że pierwotne zobowiązanie `500 × MAT-42` na środę jest zagrożone, a realna dostępność wynosi `300` w środę i `200` w piątek. Manufacturer A musi ustalić wpływ na swoje zlecenia produkcyjne i terminy klientów, rozważyć alternatywy, pozyskać prawdziwą ofertę Supplier 2 oraz uzyskać dwie decyzje człowieka bez przedwczesnego zapisu niepotwierdzonego planu.

Transport e-mail jest zawodny i co najmniej jednokrotny: wiadomości mogą być dostarczane ponownie, odpowiedzi mogą przyjść po restarcie procesu, a jedna z dwóch końcowych odpowiedzi może nie nadejść. Agent nie może wykonywać mutacji domenowych. Case staje się zielony wyłącznie po potwierdzeniu całego wybranego planu i jego atomowym zastosowaniu.

## 📣 Goals

- **REQ-001:** Prawdziwa, napisana naturalnym jezykiem wiadomosc od `supplier@hackon-om-wro.cloud` tworzy jeden zweryfikowany i zdeduplikowany `SupplyCase` w zakresie tenant + organization; fakty wyciaga propose-only agent triazu, a czlowiek widzi je obok oryginalnej tresci.
- **REQ-002:** Pierwsze uruchomienie agenta analizuje wpływ na zapotrzebowanie, zapas, zlecenia produkcyjne i terminy klientów, po czym proponuje trzy następne kroki bez mutacji.
- **REQ-003:** Pierwsza decyzja człowieka pozwala wybrać `CHECK_ALTERNATIVE_SUPPLIER`; dopiero ta dyspozycja wysyła zapytanie do Supplier 2.
- **REQ-004:** Workflow trwale czeka na prawdziwy `ALTERNATIVE_SUPPLY_OFFER` od `supplier2@hackon-om-wro.cloud` i wznawia się idempotentnie po jego korelacji.
- **REQ-005:** Drugie uruchomienie agenta porównuje trzy kompletne `ResolutionPlan` na podstawie potwierdzonej ceny i terminu Supplier 2.
- **REQ-006:** Druga decyzja człowieka wskazuje dokładny plan; dla planu C system wysyła akceptację do obu dostawców, ale nie aktualizuje jeszcze lokalnego planu produkcji.
- **REQ-007:** Dopiero potwierdzenia wymagane przez wybrany plan uruchamiają atomową komendę aktualizacji zobowiązań, pokrycia materiałowego i statusu ryzyka.
- **REQ-008:** UI pokazuje pełny lifecycle wybranej gałęzi, pierwszą decyzję oraz — dla `CHECK_ALTERNATIVE_SUPPLIER` — drugą decyzję; zielony stan oznacza potwierdzone pokrycie `500/500` i `RESOLVED`.
- **REQ-009:** Pełny scenariusz demonstracyjny przechodzi 3/3 bez duplikatów i mieści się w pięciu minutach.

## 📣 Non-goals

- Implementacja wewnętrznych systemów Supplier 1 lub Supplier 2.
- Wielorundowa negocjacja ceny, counter-offers lub automatyczne targowanie.
- Pełny APS/MRP, capacity planning albo optymalizacja wszystkich zleceń.
- Automatyczna akceptacja którejkolwiek z dwóch decyzji.
- Wspólna baza lub biznesowe API pomiędzy firmami.
- Automatyczna substytucja SKU i obsługa więcej niż jednego alternatywnego dostawcy w jednym case.

## 📣 Proposed Solution

Rozwiązanie wykorzystuje natywne mechanizmy Open Mercato 0.8.0:

- `communication_channels` + `channel_imap` odbierają i wysyłają prawdziwe wiadomości;
- nowy moduł aplikacyjny `supply_cases` jest właścicielem kontraktu, danych, sanitizacji, komend i UI;
- propose-only `inbound_triage_advisor` czyta wiadomość napisaną naturalnym językiem, wyciąga z niej fakty i wskazuje case, którego ona dotyczy;
- `workflows` jest jedynym właścicielem trwałego wykonania, oczekiwań, timeoutów i wznowień;
- `agent_orchestrator` uruchamia dwa propose-only procesy decyzyjne, zapisuje traces/proposals i kieruje oba wybory do Caseload;
- command bus wykonuje wysyłkę zapytania, prośbę o potwierdzenie planu oraz finalne zastosowanie potwierdzonej rezolucji.

Kod oblicza ilości, terminy, koszty i pokrycie. Agent interpretuje fakty, porównuje warianty i rekomenduje. Agent nigdy nie zapisuje stanu domenowego bezpośrednio.

### Agent runtime decision for the MVP

Pierwsza wersja agentów dostawowych używa runtime `in-process`, definiowanego w
TypeScript przez `defineAgent` i uruchamianego wewnątrz procesu aplikacji. Jest to
świadoma decyzja upraszczająca pierwszy vertical slice: nie wymaga osobnego
kontenera OpenCode, dodatkowego połączenia MCP ani osobnego cyklu restartowania
runtime'u.

W MVP:

- `inbound_triage_advisor`, `initial_impact_advisor` i `final_resolution_advisor`
  zachowują stabilne identyfikatory i są rejestrowane jako typed agents;
- instrukcje agenta pozostają w deklaracji TypeScript, a kontrakt wyniku jest
  walidowany schematem Zod;
- agent otrzymuje dane wejściowe przygotowane przez moduł/workflow i korzysta
  wyłącznie z jawnie zadeklarowanych read-only tools;
- wszystkie propozycje nadal przechodzą przez `AgentRun`, trace, disposition,
  Caseload i workflow — wybór runtime'u nie zmienia zasady propose-only;
- workflow i command/effector pozostają właścicielem trwałego wykonania oraz
  wszystkich mutacji domenowych.

OpenCode pozostaje przyszłą opcją runtime'u dla tych samych agentów. Można go
wdrożyć później, gdy instrukcje będą wymagały plików `AGENT.md`, `OUTCOME.md`,
`SKILL.md`, sub-agentów albo sandboxowanych skryptów. Przed migracją należy
utrzymać ten sam `agentId`, kształt wejścia i `resultKind: proposal`, tak aby
workflow nie musiał być przebudowywany. Migracja runtime'u nie może zmieniać
kontraktu biznesowego ani otwierać agentowi bezpośrednich mutacji.

Pierwszy agent zostanie uruchomiony bez dodatkowych tools, na danych przekazanych
w kontekście workflow. Read-only tools będą dodawane dopiero po przejściu pełnego
obiegu agent → Caseload → decyzja człowieka → wznowienie workflow. To ogranicza
zakres pierwszej implementacji i pozwala najpierw zweryfikować kontrakt decyzji.

### Scope cohesion and activation boundary

Specyfikacja opisuje jedną zdolność biznesową: doprowadzenie pojedynczego wyjątku dostawy od zweryfikowanego e-maila do potwierdzonego planu albo jawnego zamknięcia bez zmian. Warianty delay, stock i alternative są trzema odnogami tej samej decyzji i współdzielą case, workflow, confirmation join oraz finalny safety gate; nie są osobnymi produktami.

Fazy implementacyjne mogą być łączone osobno, ale `supply_cases.enabled` pozostaje wyłączone poza testami do przejścia exit gate Phase 4. Dzięki temu żadna częściowo zaimplementowana gałąź nie przyjmuje żywych wiadomości ani nie pozostawia case bez konsumenta potwierdzeń. Phase 5 jest bramką release/demo i obserwowalności dla tej samej zdolności, a nie osobno aktywowanym produktem.

Moduł jest aplikacyjny i wdrażany tylko w Manufacturer A. Mechanizmy są tenant- i organization-scoped, natomiast adresy dostawców, SKU, ilości, koszt zapasu i limit pięciu minut są konfiguracją/fixtures tej konkretnej demonstracji, a nie publicznym kontraktem platformy.

### Alternatives considered

1. **Jedna decyzja i szacunkowa cena Supplier 2:** odrzucone, bo człowiek zatwierdzałby koszt bez realnej oferty.
2. **Zapytanie do Supplier 2 bez decyzji człowieka:** odrzucone; użytkownik chce jawnie wybrać etap sourcingu.
3. **Natychmiastowa aktualizacja planu po drugim `Approve`:** odrzucone, bo dostawa Supplier 2 nie jest jeszcze potwierdzona.
4. **Dwa trwałe silniki procesu:** odrzucone; `WorkflowInstance` pozostaje jedynym lifecycle ownerem, a orchestrator dostarcza propozycje i dyspozycje.
5. **Sztywna koperta JSON (`SupplyEnvelope`) wklejana w treść e-maila:** odrzucone po przeglądzie. Był to pierwotny projekt tej specyfikacji i wymagał, żeby Supplier 1 i Supplier 2 implementowali wspólny, wersjonowany kontrakt — czyli dokładnie to biznesowe API pomiędzy firmami, które Non-goals wykluczają. Wariant był też samozaprzeczalny: dostawca zdolny wygenerować poprawną kopertę ma integrację, a wtedy webhook albo REST bije skrzynkę pocztową pod każdym względem. Cała wartość tego rozwiązania istnieje wyłącznie wtedy, gdy po drugiej stronie pisze człowiek. Deterministyczne właściwości, które koperta dawała za darmo — dedupe i causation — odzyskujemy z nagłówków RFC 5322, których nadawca nie wpisuje ręcznie.

### Development decision: file-backed simulation backend

Na potrzeby lokalnego developmentu, testów agenta i demonstracji przed gotowością docelowego modelu ORM dodajemy prosty backend symulujący bazę danych. Backend będzie zapisywał i odczytywał rekordy z plików JSON dla `ProductionOrder`, `ProductionPlan`, `SupplyCase`, `InboundMessage` i `OutboundCorrelation`.

Ta decyzja pozwala testować cały przepływ: korelację wiadomości, odczyt wpływu na produkcję, zapis oczekującego planu, wznowienie po restarcie procesu oraz deduplikację — bez uruchamiania migracji i bez tworzenia przedwcześnie pełnego modułu produkcyjnego. Dane będą trwałe pomiędzy uruchomieniami aplikacji, ale pozostaną lokalne i jawnie testowe.

Implementacja ma być schowana za interfejsem repozytorium/store, tak aby późniejsza zamiana JSON na MikroORM i PostgreSQL nie wymagała zmiany logiki agenta ani workflow. Domyślny katalog danych będzie konfigurowalny przez zmienną środowiskową i ignorowany przez Git. Osobne pliki mogą przechowywać kolekcje, np. `production-orders.json`, `production-plans.json`, `supply-cases.json`, `inbound-messages.json` i `outbound-correlations.json`.

Backend symulacyjny musi zachować najważniejsze właściwości docelowego przepływu: zakres `tenant_id` + `organization_id`, stabilne identyfikatory, unikalność `rfc_message_id`, append-only dla `InboundMessage` i `OutboundCorrelation`, deterministyczne fixture’y oraz bezpieczny zapis pliku przez zapis tymczasowy i podmianę. Nie jest to produkcyjny mechanizm bezpieczeństwa, współbieżności, szyfrowania ani skalowania i nie może przyjmować prawdziwych danych wrażliwych.

Na potrzeby demo JSON backend jest aktywnym backendem domenowym. Nie blokujemy na nim
zamknięcia scenariusza end-to-end ani nie tworzymy teraz ORM tylko po to, żeby formalnie
zamknąć T-03. JSON backend nie usuwa jednak przyszłego wymagania produkcyjnego: przed
wdrożeniem docelowym zostanie zastąpiony implementacją MikroORM za tym samym interfejsem
repozytoriów `SupplyCasesStore`.

Demo ma używać prawdziwego `WorkflowInstance` z modułu `workflows`; JSON przechowuje
rekordy domenowe, a workflow persistence przechowuje stan wykonania, oczekiwania,
timeouty i wznowienia. Wariant demo jest lokalny, single-process i nie jest przeznaczony
do prawdziwych danych wrażliwych ani równoległej pracy wielu instancji aplikacji.

Minimalny zakres spięcia JSON backendu z demo obejmuje: zapis inbound message przez
repozytorium, in-process triage agenta, utworzenie scoped `SupplyCase`, start workflow,
`INVOKE_AGENT` dla analizy wpływu, decyzję w Caseload, zapis wybranej opcji oraz reset i
seed scenariusza. Dopiero po tym przepływie podmieniamy adapter JSON na ORM.

### Market-pattern check

Projekt stosuje osobne user tasks dla pracy człowieka oraz message/signal waits dla zewnętrznych odpowiedzi. To odpowiada wzorcowi rozdzielania human task od korelowanej wiadomości opisanemu w [Camunda user tasks](https://docs.camunda.io/docs/8.7/reference/glossary/) i [Camunda message correlation](https://docs.camunda.io/docs/components/modeler/bpmn/message-events/). Pomijamy BPMN authoring, rozbudowaną negocjację i generic procurement marketplace, ponieważ nie są potrzebne do Level 3.

## 📣 Architecture

### End-to-end lifecycle

```text
plain-language e-mail from Supplier 1
  -> channel_imap / communication_channels.message.received
  -> supply_cases inbound subscriber
  -> deterministic transport gate:
       active channel/provider + tenant/organization scope
       + sender allowlist + atomic RFC5322 Message-ID claim
  -> persist generic InboundMessage with raw and sanitized body
  -> emit supply_cases.inbound_message.accepted
  -> start one inbound WorkflowInstance
  -> INVOKE_AGENT inbound triage agent (classify + extract + pick correlation target)
  -> deterministic triage apply:
       SUPPLY_PROPOSAL -> create SupplyCase and emit proposal_received
       existing case reply -> signal the existing scoped workflow
       customer/unrelated/ambiguous -> quarantine or NEEDS_ATTENTION
  -> continue the same WorkflowInstance for a newly created SupplyCase
  -> deterministic impact calculation
  -> INVOKE_AGENT initial-impact agent
  -> FIRST HUMAN DECISION in Caseload
       A accept Supplier 1 delay
       B use internal stock
       C check Supplier 2
  -> demo selects C
  -> command sends ALTERNATIVE_SUPPLY_REQUEST
  -> WAIT_FOR_SIGNAL alternative offer
  -> ALTERNATIVE_SUPPLY_OFFER from Supplier 2
  -> deterministic recomputation
  -> INVOKE_AGENT final-resolution agent
  -> SECOND HUMAN DECISION in Caseload
       A accept Supplier 1 delay, reject Supplier 2
       B use stock, reduce Supplier 1, reject Supplier 2
       C take 300 from Supplier 1 + 200 from Supplier 2
  -> demo selects C
  -> command persists pending plan and sends SUPPLY_ACCEPTANCE to S1 and S2
  -> WAIT_FOR_SIGNAL confirmations required by selected plan
  -> both confirmations received
  -> command atomically applies confirmed plan
  -> recalculate material coverage and production/customer risk
  -> 500/500, PROTECTED, RESOLVED
```

### State machine

```text
RECEIVED
ANALYZING_INITIAL_IMPACT
AWAITING_SOURCING_DECISION
SENDING_ALTERNATIVE_REQUEST
WAITING_FOR_ALTERNATIVE_OFFER
ANALYZING_CONFIRMED_OFFER
AWAITING_RESOLUTION_APPROVAL
SENDING_PLAN_ACCEPTANCE
WAITING_FOR_SUPPLIER_CONFIRMATIONS
APPLYING_RESOLUTION
RESOLVED
```

Terminal states: `RESOLVED`, `REJECTED`, `CANCELLED`. `NEEDS_ATTENTION` is resumable and records a typed reason such as `WAIT_TIMEOUT`, `DELIVERY_FAILED` or `CONFIRMATION_MISMATCH`; an operator may retry the same idempotent step, request reanalysis where applicable, or cancel the case. `QUARANTINED` is a message disposition, not a case terminal state. Status transitions occur only through commands or workflow-owned state; UI never writes them directly.

### Initial decision options

| ID | Meaning | External effect after human selection |
|---|---|---|
| `ACCEPT_PRIMARY_DELAY` | keep `300 Wed / 200 Fri` | ask Supplier 1 to confirm the delayed plan |
| `USE_INTERNAL_STOCK` | use `200` internal stock and take `300 Wed` | ask Supplier 1 to confirm `300 Wed` |
| `CHECK_ALTERNATIVE_SUPPLIER` | obtain a real quote for missing `200` | send `ALTERNATIVE_SUPPLY_REQUEST` to Supplier 2 |

The demo follows `CHECK_ALTERNATIVE_SUPPLIER`. The proposal is multi-option, so Caseload must require an explicit `selectedOptionId`; recommendation ranking cannot preselect an option.

The other two choices are complete, supported branches rather than decorative alternatives:

- `ACCEPT_PRIMARY_DELAY` creates the canonical `ACCEPT_DELAY` pending plan, skips Supplier 2 and the second agent run, then asks Supplier 1 for confirmation;
- `USE_INTERNAL_STOCK` creates the canonical `USE_STOCK` pending plan, skips Supplier 2 and the second agent run, then asks Supplier 1 to confirm its reduced commitment;
- `CHECK_ALTERNATIVE_SUPPLIER` is the only branch that sends an RFQ, waits for an offer and opens the second human decision.

All three branches converge on the same confirmation join and `resolution.apply_confirmed` safety gate. Supplier 2 is contacted only in the branch that explicitly selected it.

### Final ResolutionPlan options

| ID | Supplier 1 | Supplier 2 | Internal stock | Customer | Additional cost | Required confirmations |
|---|---|---|---:|---|---:|---|
| `ACCEPT_DELAY` | `300 Wed / 200 Fri` | reject offer | `0` | delayed | `0 PLN` | Supplier 1 |
| `USE_STOCK` | `300 Wed`, cancel remaining `200` | reject offer | `200` | on time | `300 PLN` fixture | Supplier 1 |
| `USE_ALTERNATIVE` | `300 Wed`, cancel remaining `200` | `200 Wed` | `0` | on time | actual offer, demo `1,400 PLN` | Supplier 1 + Supplier 2 |

Each option is a complete, immutable plan snapshot. It declares supplier commitments, stock usage, cost, customer/production impact, outbound messages, confirmations and the final command inputs. Editing a proposal replaces actions only in the selected option and preserves the other evidence.

### Agent contracts

1. `supply_cases.inbound_triage_advisor`
   - type: `extractor`;
   - input: sanitized plain-text body of ONE inbound message, plus a deterministically built candidate list (see *Inbound understanding and correlation*);
   - result: proposal containing the extracted `InboundSignal` and the chosen correlation target;
   - allowed action: none — its result is consumed by `supply_cases.inbound.apply_triage`;
   - no tools, no mutation tools, no network access.
2. `supply_cases.initial_impact_advisor`
   - type: `decision_maker`;
   - input: deterministic impact facts and case snapshot;
   - result: proposal with the three initial decision options;
   - allowed action: `supply_cases.sourcing.apply_decision`, parameterized by the selected option;
   - no mutation tools.
3. `supply_cases.final_resolution_advisor`
   - type: `decision_maker`;
   - input: initial facts plus validated Supplier 2 offer;
   - result: proposal containing the three complete `ResolutionPlan` options;
   - allowed action: `supply_cases.resolution.apply_decision`, parameterized by the selected plan;
   - no mutation tools.

The two decision proposals are forced to human disposition regardless of confidence. The triage proposal is auto-applied only when it clears the confidence and consistency bar defined below; otherwise it, too, reaches a human. Auto-approval is disabled for these agent/action pairs. The workflow resumes only through the proposal-ready signal emitted after disposition.

### Inbound understanding and correlation

Inbound mail is written by a person in natural language. There is no machine-readable envelope and none is expected. The inbound path is therefore split into a deterministic transport gate, one bounded agent step, and a deterministic apply step. Every security-relevant decision happens BEFORE the agent runs, and the agent never widens its own input.

**Stage 1 - transport gate (deterministic, no LLM).**

- The platform event is technical evidence that a message was observed, not proof that the message belongs to this business flow. The inbound subscriber accepts only an active, configured `channelLinkId`/provider that is enabled for the module; an unknown or mismatched channel is rejected and audited.
- The event scope and the authenticated channel scope must resolve to the same tenant + organization. Missing, conflicting or cross-scope values fail closed and never fall back to an unrestricted lookup.
- The RFC 5322 `Message-ID` header is the durable dedupe key, unique per tenant + organization + direction. It is assigned by the sending MTA, not by the message author, so it survives re-delivery, restarts and `UIDVALIDITY` changes. The claim is a transactional insert against that unique index; losing the race is a normal outcome, not an error.
- The authenticated mail envelope determines the sender. Any address appearing in the message text is informational and never authorizes processing.
- A sender outside the allowlist, or a message whose tenant + organization scope cannot be resolved, is rejected and audited. Missing scope is never treated as unrestricted, and the rejection reveals nothing about other scoped records.

**Stage 2 - sanitization (deterministic, no LLM).**

The body is reduced to the author's NEW text: HTML is converted to plain text, quoted history and channel/thread footers are removed, and the result is length-capped. This is a correctness requirement before it is a cost one - a supplier thread repeats every earlier quantity and date, and an agent shown the full history will extract superseded numbers. The removed content is preserved verbatim in the encrypted raw body for audit; only the reduced text reaches the agent.

**Stage 3 - triage agent (the only LLM step).**

`supply_cases.inbound_triage_advisor` receives the sanitized text and a candidate list, and returns a schema-constrained `InboundSignal` (see *Internal Contracts*). Two properties bound it:

- **Closed-set correlation.** The candidate list is built by code: open cases in the SAME tenant + organization in which this authenticated sender is a participant. The agent picks one candidate by its list index, or answers `NEW_CASE`. It cannot name an arbitrary case, so message text can never route a message into a record the sender has no part in.
- **Data, never instructions.** The agent has no tools, no actions and no network access, and its output is validated against a closed schema. Message text attempting to issue instructions cannot reach any effect, because no effect is available to it.

**Stage 4 - apply (deterministic).**

RFC 5322 `In-Reply-To` / `References` are resolved against our own recorded outbound `Message-ID`s and mark matching candidates as `threadMatch`. A thread match is strong evidence - we sent the message being answered - but it does not override the agent, because a supplier commonly replies to an old thread simply to reuse the address. The agent sees the flag and may select a different candidate, in which case it must state why.

The message is auto-applied only when the agent's `confidence` clears the configured threshold, its `unresolved` list is empty, and thread evidence and agent choice do not contradict each other. Otherwise the case enters `NEEDS_ATTENTION` and a human picks the target from the same candidate list. Ambiguity is never resolved by guessing.

`causationId` is no longer carried in the body. For every message that answers one of ours - the Supplier 2 offer and both confirmations - the reply chain supplies causation directly, which is what prevents a stale offer from resuming a newer wait. A reply whose `In-Reply-To` resolves to a superseded request is rejected for resumption and recorded.

**Invariants across all stages.**

- Every outbound message uses a durable idempotency key derived from case + phase + recipient, and its `Message-ID` is persisted so replies can be correlated later.
- Extraction failure, sender mismatch, an unusable body, or an unavailable/invalid LLM provider enter quarantine or `NEEDS_ATTENTION` without changing the case. No path fabricates domain values to keep the demo moving.
- The human reviewing a case always sees the original message text next to the extracted facts, so an extraction error is visible rather than silently authoritative.
- Every wait has a configurable timeout. On expiry the case enters `NEEDS_ATTENTION`; manual resume re-enters the same wait without changing its correlation identity, while cancel moves it to terminal `CANCELLED`. A timeout never marks the case `RESOLVED`.

## 📣 Internal Contracts

Nothing here is an inter-company contract. Suppliers send ordinary prose and are never asked to adopt a format. These schemas are internal: they constrain what the triage agent may return and what the rest of the module is allowed to act on. They are owned by `supply_cases` and versioned with it.

### InboundSignal

The triage agent's entire output surface. Validated with Zod; anything failing validation is quarantined.

```json
{
  "intent": "SUPPLY_PROPOSAL",
  "correlation": { "kind": "EXISTING_CASE", "candidateIndex": 0 },
  "sku": "MAT-42",
  "commitments": [
    { "quantity": 300, "date": "2026-09-23" },
    { "quantity": 200, "date": "2026-09-25" }
  ],
  "price": { "amount": 1400, "currency": "PLN" },
  "confidence": 0.86,
  "unresolved": [],
  "rationale": "Supplier states Wednesday delivery drops to 300 with the remainder on Friday."
}
```

- `correlation.kind` is `EXISTING_CASE` or `NEW_CASE`. `candidateIndex` addresses the code-built candidate list by position - never a free-form case ID.
- `unresolved` names every field the agent could not determine from the text. A non-empty list forces human review.
- `price` is present only for an offer intent. Amounts and dates are extracted, never invented; a value absent from the text is `unresolved`, not a default.
- `rationale` quotes or paraphrases the deciding sentence so a reviewer can check the extraction against the original in one glance.

### Message intents

These are classifications the triage agent assigns to inbound prose, and the shapes the module composes for outbound prose. They are not formats any supplier must produce.

| Intent | Direction | Facts the module needs |
|---|---|---|
| `SUPPLY_PROPOSAL` | Supplier 1 -> Manufacturer | original and feasible commitments |
| `ALTERNATIVE_SUPPLY_REQUEST` | Manufacturer -> Supplier 2 | requested SKU, quantity, required date |
| `ALTERNATIVE_SUPPLY_OFFER` | Supplier 2 -> Manufacturer | offered quantity/date and `price { amount, currency }` |
| `SUPPLY_ACCEPTANCE` | Manufacturer -> Supplier 1 or Supplier 2 | accepted commitments, cancellations, selected plan ID |
| `SUPPLY_COMMITMENT_CONFIRMED` | Supplier 1 or Supplier 2 -> Manufacturer | confirmed commitments and accepted plan ID |
| `UNRELATED` | inbound | none - quarantine without touching any case |

Outbound messages are written as readable prose addressed to a person. They carry no machine block; correlation of the eventual reply rests on the persisted `Message-ID` and the reply chain, not on anything the recipient must copy back.

## 📣 Data Model

### SupplyCase

| Field | Notes |
|---|---|
| `id` | UUID |
| `tenant_id`, `organization_id` | required scope and composite indexes |
| `correlation_id` | unique inside tenant + organization |
| `status` | state machine value |
| `sku`, `required_quantity`, `required_date` | local demand snapshot |
| `supplier_1_email`, `supplier_2_email` | normalized participant snapshots |
| `production_order_ids` | scalar UUID array/snapshot, no cross-module ORM relation |
| `customer_commitment_snapshot` | encrypted JSONB |
| `original_commitment`, `supplier_1_proposal` | encrypted JSONB |
| `alternative_offer` | encrypted JSONB, nullable |
| `initial_analysis`, `initial_options` | encrypted JSONB |
| `selected_initial_option_id` | nullable until first disposition |
| `final_analysis`, `resolution_plans` | encrypted JSONB |
| `selected_resolution_plan_id`, `pending_resolution_plan` | nullable until second disposition |
| `estimated_additional_cost`, `actual_additional_cost`, `currency` | numeric values calculated by code |
| `supplier_1_confirmed_at`, `supplier_2_confirmed_at` | confirmation evidence |
| `workflow_instance_id` | scalar reference, no ORM relation |
| `resolved_at`, `created_at`, `updated_at`, `deleted_at` | optimistic locking and lifecycle |

### InboundMessage

`InboundMessage` is the application-owned intake record for every accepted inbound
email before business classification. It is deliberately neutral: at this point the
message may be a supplier proposal, a reply to an existing case, a customer message,
or unrelated traffic. It is not evidence that a `SupplyCase` exists.

| Field | Notes |
|---|---|
| `id` | UUID |
| `tenant_id`, `organization_id`, `case_id` | scoped; nullable until triage links the message to a `SupplyCase` |
| `rfc_message_id` | RFC 5322 `Message-ID`; unique dedupe key in the scoped inbound stream |
| `in_reply_to`, `references` | RFC 5322 threading headers; the causation graph |
| `correlation_id` | our own case identifier, assigned after triage and never parsed from the body |
| `message_intent` | triage classification; null until triage runs, may then be `UNRELATED`, and is not limited to supplier traffic |
| `sender_email`, `recipient_email` | normalized snapshots |
| `sanitized_body` | encrypted text actually shown to the triage agent |
| `extraction`, `extraction_confidence` | encrypted `InboundSignal` and its score; nullable before triage |
| `triage_disposition` | `AUTO_APPLIED`, `HUMAN_CONFIRMED`, `HUMAN_REASSIGNED` or `QUARANTINED` |
| `triage_outcome` | explicit business result: `AUTO_APPLIED`, `NEEDS_ATTENTION` or `QUARANTINED` |
| `candidate_indexes` | the bounded candidate positions retained for manual review; never a case id supplied by the body |
| `needs_attention` | operator-visible flag; true for low confidence, unresolved/contradictory or provider/schema failures |
| `payload`, `raw_body` | encrypted JSONB/text with retention policy; `raw_body` keeps quoted history for audit |
| `provider_message_id`, `failure_reason` | inbound transport evidence |
| `received_at`, `created_at` | append-only intake history |

`InboundMessage` is append-only for received facts. The only narrow post-acceptance write is
the validated triage result (`triage_outcome`, extraction, bounded candidate evidence and
the resulting scalar `case_id`); raw body, headers and sender facts are never rewritten.
Every accepted inbound message remains auditable, including quarantined and
`NEEDS_ATTENTION` messages. `SupplyCase` is user-visible/editable state and therefore
uses `updated_at` optimistic locking. Migrations and module snapshots ship with the change;
no local `db:migrate` is run without explicit approval.

Agent Orchestrator owns the technical `AgentRun` and `AgentProposal` records. `InboundMessage`
stores only the business triage result and does not create an ORM relation to those records.
If a future release links them, it uses scalar `agent_run_id`/`agent_proposal_id` values and
keeps the ownership and retention rules of `agent_orchestrator` intact.

### OutboundCorrelation

The Commands section requires `request_alternative` and `request_confirmation` to
create **durable outbound records** before enqueueing transport, and T-08b has to
resolve a reply against a `Message-ID` it can attribute to a case and a phase.
The platform's transport rows carry neither, so the module owns a thin anchor.

It is explicitly NOT an outbound transport record: no body, no delivery status,
no retry state. Those stay in `communication_channels`.

| Field | Notes |
|---|---|
| `id` | UUID |
| `tenant_id`, `organization_id` | required scope |
| `case_id` | the case the message was sent for |
| `phase` | `ALTERNATIVE_SUPPLY_REQUEST` or `SUPPLY_ACCEPTANCE`; a subset of the message intents, asserted at compile time |
| `recipient_email` | normalized participant snapshot |
| `rfc_message_id` | the `Message-ID` we issued; unique in the scoped outbound stream |
| `idempotency_key` | derived from case + phase + recipient; unique in scope, so a retry reuses the anchor instead of mailing twice |
| `created_at` | append-only send history |

There is deliberately no `superseded_at` column. Supersession is **derived**: the
newest anchor for a given case + recipient states where the conversation stands,
and every earlier one has been answered past. A stored flag would need updating
on every send and would drift from the records it describes on the first missed
write. The lane is case + recipient rather than case + phase + recipient because
the idempotency key already forbids two anchors in the narrower lane, which would
make supersession unreachable by construction.

`OutboundCorrelation` is append-only too: what we sent is a historical fact. Outbound
**transport** records — body, delivery status, retries — remain owned by
`communication_channels`, and neither app-owned record duplicates them.

## 📣 Command and Event Contracts

### Commands

- `supply_cases.inbound.apply_triage`
- `supply_cases.case.create_from_proposal`
- `supply_cases.analysis.record_initial`
- `supply_cases.sourcing.apply_decision`
- `supply_cases.sourcing.request_alternative`
- `supply_cases.offer.record_alternative`
- `supply_cases.analysis.record_final`
- `supply_cases.resolution.apply_decision`
- `supply_cases.resolution.request_confirmation`
- `supply_cases.confirmation.record`
- `supply_cases.resolution.apply_confirmed`
- `supply_cases.case.mark_needs_attention`

All writes use command bus, scope tenant + organization, validate input with Zod and emit audit events. `sourcing.apply_decision` validates the first disposition and dispatches exactly one branch. `resolution.apply_decision` validates the second disposition and creates the selected immutable pending plan. `request_alternative` and `request_confirmation` create durable outbound records before enqueueing transport and reuse the same idempotency key on retry. `apply_confirmed` refuses execution unless every confirmation declared by the selected plan is present and still matches the plan snapshot.

### Events and workflow signals

- `communication_channels.message.received` is a generic technical event emitted by the configured transport. It is consumed by the `supply_cases` inbound subscriber and does not start a supplier case workflow directly.
- `supply_cases.inbound_message.accepted` is emitted only after the deterministic transport gate and message persistence succeed. Its subscriber builds the candidate list and thread evidence, invokes the triage advisor, validates the signal and applies the deterministic decision.
- `supply_cases.case.proposal_received` is emitted once only after a valid supplier proposal clears the auto-apply bar and is linked to a case. It is never emitted for unrelated, quarantined or `NEEDS_ATTENTION` messages.
- `supply_cases.alternative_offer.received`
- `supply_cases.commitment.confirmed`
- `supply_cases.resolution.applied`
- `supply_cases.case.timed_out`

After triage, `supply_cases.case.proposal_received` is a business event and audit boundary. Only a valid supplier proposal starts the case's durable `WorkflowInstance`; the JSON-backed `SupplyCase` stores its scalar `workflow_instance_id`. A reply to an existing case signals that scoped instance and never creates a second one. Duplicate messages produce no second triage, workflow or business effect. A message classified as customer traffic is outside the current `supply_cases` domain and must not be converted into `SUPPLY_PROPOSAL`; it is quarantined or routed to a future customer-owned handler. All inbound messages remain auditable regardless of the result.

## 📣 UI/UX

### Surfaces

- `/backend/supply-cases`: `DataTable` with status, SKU, missing quantity, current wait and risk.
- `/backend/supply-cases/[id]`: facts, production/customer impact, message timeline, agent analyses, selected options, confirmation checklist and final coverage.
- Agent Orchestrator Caseload: one proposal disposition on every case and a second one only on the Supplier 2 branch; each requires explicit option selection and a reason on reject/edit.
- Existing workflow instance view: technical trace and retry/timeout evidence.

### Visible sequence

```text
AT RISK
-> INITIAL ANALYSIS READY
-> DECISION REQUIRED: choose next step
-> REQUEST SENT TO SUPPLIER 2
-> WAITING FOR ALTERNATIVE OFFER
-> OFFER RECEIVED: +1,400 PLN
-> FINAL ANALYSIS READY
-> DECISION REQUIRED: choose ResolutionPlan
-> WAITING FOR SUPPLIER 1 (pending/confirmed)
-> WAITING FOR SUPPLIER 2 (pending/confirmed)
-> APPLYING CONFIRMED PLAN
-> COVERAGE 500/500, CUSTOMER ON TIME, RESOLVED
```

Dialogs support Cmd/Ctrl+Enter and Escape. All copy uses i18n. Statuses use semantic tokens; loading, empty, error, permission denied, conflict and timeout states are explicit.

## 📣 Edge Cases & Failure Scenarios

| Scenario | Required behavior |
|---|---|
| duplicate inbound message | one message claim, one state transition, one workflow effect |
| unreadable body or failed/schema-invalid extraction | quarantine, preserve encrypted raw body, no case mutation |
| extraction incomplete or low confidence | NEEDS_ATTENTION with the original text beside the extracted facts; human picks from the same candidate list |
| message text attempting to instruct the agent | treated as data; no tool, action or routing effect is reachable from it |
| sender not on allowlist | reject and audit without revealing other scoped data |
| Supplier 2 offer arrives before wait is active | persist offer; workflow reads pending correlated offer when entering wait |
| stale offer for an older RFQ | reject by reply chain: `In-Reply-To` resolves to a superseded outbound `Message-ID`; keep as quarantined/unmatched evidence |
| supplier replies on an old thread about a new problem | `threadMatch` is evidence, not a verdict; the agent may select another candidate or `NEW_CASE` and must record why |
| first or second proposal rejected | terminal `REJECTED`; no undeclared outbound effect; restarting requires a new case |
| one final confirmation missing | remain non-green; timeout to resumable `NEEDS_ATTENTION`, retain received confirmation |
| supplier confirms different quantity/date | enter `NEEDS_ATTENTION`; operator may request a new final analysis from current evidence or cancel; never apply the mismatched plan |
| outbound delivery fails | bounded retry; after exhaustion enter `NEEDS_ATTENTION` and expose idempotent retry |
| worker/application restart | workflow and message state resume without resending successful effects |
| optimistic-lock conflict on disposition | reject stale action with 409/conflict UI |
| LLM missing or invalid output | deterministic fallback produces valid options; never invent quantities/prices |

## 📣 Risks & Impact Review

- **External side effects are not undoable:** cancelling or accepting via e-mail cannot be silently rolled back. Local pending state is reversible before confirmation; after confirmation, correction requires a new compensating case/message.
- **AI evidence vs authorization:** confidence never authorizes a decision. Both multi-option proposals always require explicit human selection.
- **Sensitive business data:** payloads, analyses, customer deadlines and production snapshots use the platform encryption service and scoped decryption helpers.
- **Cross-module coupling:** production/customer records are referenced by scalar IDs and snapshots; effects route through registered commands/events, never direct ORM relations.
- **Polling latency:** demo configuration exposes polling interval and wait timeout. Before freeze, three measured round trips must fit the five-minute budget; a manual `poll now` remains an operator fallback, not a success-path dependency.
- **Compatibility:** all new APIs, events, entities, commands and ACL features are additive app-owned contracts. Future renames follow `BACKWARD_COMPATIBILITY.md`.
- **Rollback:** disabling `supply_cases`, `workflows` and enterprise agent flags stops new executions without deleting historical rows. Applied supplier commitments require compensating commands, not database rollback.

## 📣 Integration Coverage

| ID | Scenario | Assertions |
|---|---|---|
| TEST-001 | deterministic backend E2E from `communication_channels.message.received` | the event bus, transport gate, inbound persistence, accepted subscriber, fake agent boundary, validation, decision and business effect are exercised; no final function is called directly |
| TEST-001A | new valid supplier proposal | one accepted `InboundMessage`, `AUTO_APPLIED`, extraction/confidence/intent/caseId persisted, one `proposal_received`, one `WorkflowInstance` boundary |
| TEST-001B | reply to an existing case | no second case, message links to the offered candidate, existing workflow receives a signal, no duplicate effect |
| TEST-001C | customer/unrelated message | `QUARANTINED`, reason persisted, inbound audit retained, no case proposal event or business workflow |
| TEST-001D | low confidence | `NEEDS_ATTENTION`, `needs_attention=true`, candidate indexes retained, no case mutation |
| TEST-001E | unresolved data | `NEEDS_ATTENTION`; no quantity, date, price or SKU is fabricated |
| TEST-001F | agent contradicts `threadMatch` | `NEEDS_ATTENTION`; no automatic assignment to the conflicting case |
| TEST-001G | provider unavailable/schema-invalid | `QUARANTINED`, `needs_attention=true`, no case or workflow effect |
| TEST-001H | replay of the same event | one inbound message, one triage invocation, one case, one workflow and one business event |
| TEST-001I | prompt-injection-like message text | body cannot select arbitrary `caseId`, bypass `candidateIndex`, invoke tools, send email or mutate data outside the system decision |
| TEST-002 | duplicate proposal | no duplicate case, workflow or outbound effect |
| TEST-003 | HTML body, quoted reply history and channel footer | sanitizer yields only the author's new text; superseded quantities never reach the agent |
| TEST-003A | prose proposal with all facts present | extraction matches expected SKU, quantities and dates; `unresolved` empty |
| TEST-003B | vague prose with a missing date, and an unrelated message | `unresolved` non-empty -> NEEDS_ATTENTION; `UNRELATED` -> quarantine; neither mutates a case |
| TEST-003C | message text instructing the agent to reassign, approve or contact a supplier | no effect; instruction text is extracted as data or ignored, never obeyed |
| TEST-003D | LLM provider unavailable or returning schema-invalid output | quarantine plus NEEDS_ATTENTION; no fabricated values, no case mutation |
| TEST-004 | unauthorized sender / cross-org lookup | fail closed, no data leak |
| TEST-004A | candidate list construction | contains only open cases in scope where the sender is a participant; an out-of-scope case is unreachable even when the body names it |
| TEST-004B | reply on a stale thread and reply on an old thread about a new problem | superseded `In-Reply-To` rejected for resumption; agent override of `threadMatch` recorded with its reason |
| TEST-005 | initial agent run | facts deterministic; three typed options; no mutation |
| TEST-006 | first disposition selects sourcing | one RFQ to Supplier 2; status waits for offer |
| TEST-006A | first disposition selects delay or stock | no Supplier 2 contact; canonical plan waits only for Supplier 1 confirmation |
| TEST-007 | duplicate/stale Supplier 2 offer | one resume; stale causation rejected |
| TEST-008 | final agent run | three complete plans use actual Supplier 2 offer |
| TEST-009 | final plan C approved | pending plan stored; exactly two acceptances sent; no production mutation |
| TEST-010 | confirmations arrive S1 then S2 | final command runs once after second confirmation |
| TEST-011 | confirmations arrive S2 then S1 | same result as TEST-010 |
| TEST-012 | only one confirmation | timeout; case not green; no final mutation |
| TEST-013 | confirmation differs from plan | manual exception; no final mutation |
| TEST-014 | retry/restart at every outbound/wait boundary | idempotent continuation, no repeated mail |
| TEST-015 | stale proposal disposition | optimistic-lock conflict surfaced |
| TEST-016 | no/invalid LLM provider during a DECISION step | case holds in NEEDS_ATTENTION; no decision is synthesized |
| TEST-017 | UI lifecycle | branch-specific decisions, waits, checklist, needs-attention and resolved states |
| TEST-018 | complete real-email demo | three consecutive runs under five minutes |

All integration tests create and clean their own fixtures and cannot depend on pre-existing demo rows. The real-email smoke suite is separately tagged because it requires live mailboxes.

## 📋 Phasing

### Phase 1: Domain and inbound foundation

Ships a safe vertical slice in which a real Supplier 1 proposal creates exactly one visible case.

1. Add `workflows` and enterprise agent activation prerequisites to the app configuration without changing provider credentials (see *Phase 1 delivery notes* below).
2. Scaffold app module `supply_cases` with `index.ts`, `acl.ts`, `setup.ts`, i18n and module activation.
3. Add `SupplyCase` and append-only `InboundMessage` entities, encryption maps, migration and snapshot.
4. Add Zod schemas for `InboundSignal`, the message intents and normalized e-mail addresses.
5. Implement the body sanitizer (HTML to text, quoted-history and footer removal, length cap) with a quarantine result.
6. Implement the deterministic inbound transport gate: verify the active channel/provider, resolve and compare tenant/organization scope, apply the sender/domain allowlist, and fail closed.
7. Implement atomic inbound claim/dedupe on the RFC 5322 `Message-ID`.
8. Implement deterministic candidate-list construction and thread resolution from `In-Reply-To` / `References`.
9. Register the in-process `supply_cases.inbound_triage_advisor` (no tools, no actions) and the `supply_cases.inbound.apply_triage` command, including the auto-apply bar and the NEEDS_ATTENTION fallback.
10. Emit `supply_cases.inbound_message.accepted` after the gate, start one inbound workflow instance, and emit `supply_cases.case.proposal_received` only after deterministic triage apply while continuing that same instance for a new case.
11. Add minimal case list/detail read surfaces showing `RECEIVED`, the original message text and the extracted facts side by side.
12. Add TEST-001 through TEST-004B and run generation, typecheck and targeted tests.

**Exit gate:** a live, plain-language proposal from Supplier 1 produces one scoped case with reviewable extracted facts after repeated polling, and remains inspectable after restart.

#### Phase 1 delivery notes — step 1 (activation prerequisites)

`src/modules.ts` enables three core modules beyond the ones this app already had:

| Module | Why it is required |
|---|---|
| `workflows` | Owner of durable execution, waits, timeouts and resumes. |
| `business_rules` | Hard dependency of `workflows`: its `setup.ts`, `data/validators.ts` and `cli.ts` import the rule engine and the `BusinessRule` entity at module load. |
| `api_keys` | Hard dependency of `agent_orchestrator`: its `di.ts` registers `agentTokenService`, which imports the `ApiKey` entity. |

`.env` and `.env.example` set `OM_ENABLE_ENTERPRISE_MODULES=true` (adds `record_locks`, `system_status_overlays`) and `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` (adds `agent_orchestrator` plus the upstream `agent_examples` showcase module). Provider credentials are untouched, as the step requires.

##### Upstream generator patch: `@open-mercato/cli` 0.8.0

Enabling `agent_orchestrator` in a standalone app made `yarn typecheck` fail with two `TS2307` errors inside `.mercato/generated/file-agents.generated.ts`.

Cause: `renderManifest()` in `lib/generators/extensions/agent-files.ts` hard-codes the manifest's two type imports as `../lib/sdk/outcomeSchema` and `../lib/tokens/types`. Those resolve only in the monorepo layout, where the manifest is written next to the module (`packages/enterprise/src/modules/agent_orchestrator/generated/`). In a standalone app the same generator writes to `<app>/.mercato/generated/`, from which `../lib/*` is not the module at all. `resolveAgentFilesTargets()` already documents the two layouts but does not switch the imports.

`tsconfig.json` `exclude` cannot work around it: `defineAgent.ts` does `import('@/.mercato/generated/file-agents.generated')` and the `@/.mercato/*` path mapping pulls the real file back into the program, beating the package's ambient `file-agents-generated.d.ts` shim.

Fix: a committed `yarn patch` (`.yarn/patches/@open-mercato-cli-npm-0.8.0-*.patch`, referenced from `package.json` `dependencies`) that threads the already-available standalone signal (`resolver && !resolver.isMonorepo()`) into `renderManifest()` and emits the published subpath `@open-mercato/enterprise/modules/agent_orchestrator/lib/...` in standalone builds. The monorepo path is unchanged. Both `src/` and `dist/` are patched because `yarn generate` executes `dist/`.

Remove the patch once this is fixed upstream; the emitted specifier follows the same form the app already uses for `.../lib/sdk/defineAgent`.

##### Verification

`yarn generate`, `yarn typecheck`, `yarn lint` (0 errors; 8 warnings pre-existing in untouched files) and `yarn build` all pass with agents enabled. No migrations were generated or applied in this step.

#### Phase 1 execution breakdown

Each row is one commit-sized task that must leave the app buildable. `Oracle` is the single check that proves the task done. Tests are owned by the task that creates the behaviour, not deferred to a final test step.

**This table is the only place Phase 1 status is recorded.** Do not mark progress in the numbered step list above or anywhere else. `Status` is one of `TODO`, `WIP`, `DONE`, `DEFERRED` or `BLOCKED`; a task moves to `DONE` only once its oracle has actually been run and passed. `DEFERRED` requires a reason in the row, and means the task is intentionally outside the local demo path rather than completed.

| # | Status | Spec step | Task | Oracle |
|---|---|---|---|---|
| T-01 | `DONE` | 1 | Activation prerequisites: `workflows`, `business_rules`, `api_keys`, enterprise + agent flags, `@open-mercato/cli` patch | generate + typecheck + lint + build, all green |
| T-02 | `DONE` | 2 | Module scaffold complete: `index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `i18n/{en,pl,de,es,ko}.json` and the `src/modules.ts` entry | complete module discovery + `yarn typecheck`, both green |
| T-03a | `DEFERRED` | 3 | Production ORM `SupplyCase` entity + encryption map; `updated_at` optimistic locking | Deferred until the demo flow works; JSON store is the active demo backend |
| T-03b | `DEFERRED` | 3 | Production ORM `InboundMessage` entity, append-only, UNIQUE index on (`tenant_id`, `organization_id`, `rfc_message_id`) | Deferred until the demo flow works; the JSON store now enforces the same scoped claim |
| T-03c | `DEFERRED` | 3 | `yarn db:generate`, review scoped SQL + module snapshot. **Do not apply** | Deferred with T-03a/T-03b; ask before `db:migrate` |
| T-04a | `DONE` | 4 | E-mail normalization (case folding, display-name stripping, comparison form) | focused normalization tests pass |
| T-04b | `DONE` | 4 | Zod: `InboundSignal`, message intents, `z.infer` types | focused inbound-signal tests pass |
| T-05a | `DONE` | 5 | Body to plain text: HTML conversion, whitespace normalization, length cap, typed quarantine result | focused sanitizer tests pass |
| T-05b | `DONE` | 5 | Strip quoted history and channel/thread footers; keep original in `raw_body` | `prepareInboundBody` bridges sanitize+strip; raw/sanitized split persisted and covered |
| T-06 | `DONE` | 6 | Deterministic inbound transport gate: active channel/provider, tenant/organization scope, sender/domain allowlist, failing closed, no cross-scope disclosure | TEST-004 |
| T-07 | `DONE` | 7 | Atomic inbound claim/dedupe on `rfc_message_id`; losing the race is a normal outcome | TEST-002 |
| T-08a | `DONE` | 8 | Deterministic candidate-list construction (open cases in scope where the sender participates) | TEST-004A |
| T-08b | `DONE` | 8 | Thread resolution from `In-Reply-To` / `References` against persisted outbound `Message-ID`s; `threadMatch` flag | TEST-004B |
| T-09a | `DONE` | 9 | Register `inbound_triage_advisor`: no tools, no actions, no network; `InboundSignal` as outcome contract | TEST-003A, TEST-003C pass over T-08a's real `InboundCandidate`; a live provider run is still unexercised (no key in this environment) |
| T-09b | `DONE` | 9 | `supply_cases.inbound.apply_triage`: auto-apply bar (confidence + empty `unresolved` + no thread contradiction), else NEEDS_ATTENTION | TEST-003B, TEST-003D pass against the real JSON store, including idempotent redelivery and the no-mutation assertions |
| T-10a | `DONE` | 10 | Emit `supply_cases.inbound_message.accepted` after the gate and `supply_cases.case.proposal_received` after deterministic triage apply, both post-commit | TEST-001A–C and TEST-001H pass; proposal event is declared and emitted only for a valid auto-applied supplier proposal |
| T-10b | `WIP` | 10 | Start exactly one inbound workflow instance for a valid supplier proposal; persist `workflow_instance_id`; signal an existing scoped workflow for replies | Production code resolves the real `workflowExecutor`/`signalHandler` and the deterministic event E2E verifies one start/signal boundary; live database-backed WorkflowInstance restart coverage remains |
| T-11 | `TODO` | 11 | Case list + detail read surfaces: `RECEIVED`, original message text beside extracted facts, loading/empty/error states | manual verification against the exit gate |

**Ordering constraints.** T-02 precedes everything. The JSON repository's scoped dedupe contract (`BACKLOG-001`) enables T-07 for the demo; production T-03b must preserve the same unique claim invariant before the ORM backend is enabled. T-04a precedes T-06 (the allowlist compares normalized addresses). T-04b precedes T-09a (the schema is the agent's outcome contract). T-05a precedes T-05b. T-08a and T-08b precede T-09a (both feed the agent's input). T-09b precedes T-10a/T-10b. T-11 is last.

#### Implementation audit — 2026-09-18

- `T-01` is `DONE`: activation prerequisites and standalone generator patch are in place.
- `T-02` is `DONE`: metadata, DI factory, activation entry, `acl.ts`, `setup.ts` and the
  five i18n locale files are all picked up by discovery (`modules.generated.ts` binds
  `features`, `setup` and every locale). ACL declares `supply_cases.view`,
  `supply_cases.messages.view`, `supply_cases.manage` and `supply_cases.decisions.apply`;
  `setup.ts` grants `admin: ['supply_cases.*']` and seeds the demo scenario into the JSON
  store only when the scope has no `SC-001` case, so re-running init is non-destructive.
  The i18n skeleton covers the enums that exist in `data/types.ts` (case status,
  needs-attention reason, plan risk, order status, commitment status, message intent,
  triage disposition, outbound phase) with identical key sets across all five locales. The
  `direction` and `deliveryStatus` keys were dropped with the enums themselves when the
  intake record became inbound-only.
- `BACKLOG-001` is `DONE` as a local simulation slice: the scoped JSON repositories,
  deterministic fixtures, atomic writes, restart persistence, append-only messages,
  scope isolation and coverage calculation are implemented, and its focused store suite
  passes. (Absolute test counts are deliberately not quoted here — they move with every
  task and were wrong within a day the last three times.)
- `T-03a` through `T-03c` are intentionally `DEFERRED`: the JSON store is sufficient
  for the local demo and remains behind the repository contract until production
  persistence is needed.
- `T-04a`, `T-04b` and `T-05a` are `DONE`: normalization, `InboundSignal` validation
  and body sanitization exist, each with its own focused suite.
- `T-05b` is `DONE`: `prepareInboundBody` bridges sanitization and stripping, and the
  intake record keeps the delivered body in `raw_body` while only the author's new
  text reaches `sanitized_body`.
- `T-06` and `T-07` are `DONE`: the deterministic transport gate (channel/provider,
  tenant + organization scope, envelope sender against the allowlist, failing closed)
  and the atomic scoped claim on `rfc_message_id` are implemented and covered.
- `T-08a` and `T-08b` are `DONE`: the candidate list is built from scoped open cases
  the sender participates in, and the reply chain resolves against an app-owned
  `OutboundCorrelation` anchor with derived supersession. `assembleTriageContext` composes
  both into the scoped context `lib/triage/triageInput.ts` narrows for the agent.
- `T-09a` and `T-09b` are `DONE` as units: `ai-agents.ts` registers the advisor with no
  tools, actions or network; `runInboundTriage` is the only supported entry point and
  re-validates every result with `createInboundSignalSchema(candidates.length)`; and
  `commands/inbound-triage.ts` exposes `supply_cases.inbound.apply_triage` over the pure
  `decideTriage` bar. A live provider run is still unexercised — no key in this environment.
- **The inbound path is joined through the accepted-event subscriber, which reaches
  triage through the command.** `supply_cases:inbound-message-accepted` invokes
  `supply_cases.inbound.apply_triage` as a trusted system caller; the command rebuilds the
  scoped context, runs the agent, applies the deterministic bar, records the result and
  creates or links the case. The subscriber keeps only what the command has no business
  knowing: starting and signalling the durable workflow.
- `T-10a` is `DONE`: accepted and proposal events are declared and emitted after their
  respective persistence boundaries, from ONE site each. `proposal_received` fires only
  when a case is opened — TEST-001A asserts one event for a new proposal, TEST-001B
  asserts none for a reply onto an existing case.
- `T-10b` is `WIP`: the subscriber resolves the real `workflowExecutor`/`signalHandler`
  through DI, starts one instance per case, persists `workflow_instance_id` before
  executing it and signals the existing instance for a reply. What remains is verification
  against a live database-backed `WorkflowInstance` — the E2E drives a workflow harness,
  so restart and signal delivery are asserted at the boundary, not through the engine.
- `T-11` remains `TODO`: there is no API or UI for supply cases.
- IMAP transport is connected: `channel_imap`, `communication_channels` and the
  app-owned `mailbox_seed` connect the configured mailbox. `supply_cases` consumes
  `communication_channels.message.received`, persists an `InboundMessage`, emits
  `supply_cases.inbound_message.accepted`, and the accepted subscriber runs the
  deterministic triage path. A live provider run is still intentionally absent.
- Phase 2 and later remain `TODO`: there are no supplier decision agents, durable
  workflow steps, Caseload dispositions, outbound RFQ/acceptance commands or
  confirmation join in the app-owned module yet.

#### Next implementation step

Phase 1 is joined end to end. A live message now travels transport gate -> claim ->
`InboundMessage` -> `supply_cases.inbound_message.accepted` -> triage command ->
`SupplyCase` + `supply_cases.case.proposal_received` -> one workflow instance, and a reply
signals that instance instead of starting a second one.

Three things are left before Phase 1 closes, in this order:

1. **Finish `T-10b` against a real engine.** The E2E asserts start/signal at the DI
   boundary with a workflow harness. A database-backed `WorkflowInstance` is what proves
   the restart requirement, and it is the one Phase 1 claim currently resting on a fake.
2. **Exercise a live provider.** Every triage test injects the agent through
   `inboundTriageInvokerFactory`, so `createAgentRuntimeInvoker` itself has never run. The
   first real run is where a prompt or schema mismatch will surface.
3. **`T-11`**: case list and detail read surfaces — `RECEIVED`, the original message text
   beside the extracted facts, explicit loading/empty/error states. That is also the
   phase's exit gate, a manual check against a live mailbox.

Phase 2 then opens the outbound half, which is what `OutboundCorrelation` and
`buildOutboundIdempotencyKey` were built for; nothing writes an anchor yet outside
fixtures.

**Parallelizable.** T-04a/T-04b, T-05a and T-06 are independent of one another once T-02 lands. T-08a and T-08b are independent of the T-05 chain.

**Scope note.** T-03a/T-03b are the production persistence track and are intentionally
deferred for the local demo. The file-backed store in `BACKLOG-001` is the active demo
implementation behind the same repository interface; it does not remove the future
ORM migration requirement.

#### Decisions taken in T-10a / T-10b

- **The subscriber reaches triage through the command, not around it.** The auto-apply
  bar, the candidate list and the agent run all live behind
  `supply_cases.inbound.apply_triage`. A second caller invoking `applyTriageOutcome`
  directly would give the module two places deciding whether a message may touch a case;
  the CLI and a future operator action enter the same way for the same reason.
- **A system caller states its scope; a request may not.** `resolveScope` honours an
  input `scope` only under `ctx.systemActor`, because an event subscriber has no
  authenticated actor to derive one from. A request that supplies `scope` is rejected with
  `403` rather than silently ignored — a caller convinced it selected a tenant and quietly
  given another is worse than an error — and a system call without `scope` fails with
  `400`. Missing scope never means "every scope".
- **`proposal_received` fires only when a case is OPENED.** A reply correlated onto an
  existing case is not a new proposal, and announcing one would make every subscriber
  re-handle a case it has already seen. A replay returns `already_settled` and emits
  nothing. There is exactly ONE emission site.
- **How the agent is reached is a DI seam.** The command resolves
  `inboundTriageInvokerFactory` and falls back to `createAgentRuntimeInvoker`. Without the
  seam the E2E could only test the command by stubbing the command, which would prove
  nothing about the path production takes.
- **The workflow starts after triage, not from a declarative trigger.** An event trigger
  on `inbound_message.accepted` would start an instance for every accepted message —
  quarantines, replies and messages held for review included — and the flow would then
  have to kill the extras. Starting it once triage has produced a case keeps "one case,
  one instance" true by construction rather than by cleanup.
- **`workflow_instance_id` is persisted before the instance is executed.** A crash during
  execution must not leave a running instance the case cannot name, because the next
  message would start a second one.

#### Decisions taken in T-08a / T-08b

- **Participation is necessary; thread evidence is never sufficient.** A candidate
  enters the list only when the case is open in scope AND the authenticated sender
  is one of its recorded participants. A reply chain resolving to a case the sender
  has no part in is kept as `unreachableThreadMatches` for audit and cannot widen
  the list. T-09b MUST NOT re-add a case from that field.
- **The candidate order is part of the contract.** The agent answers with an index,
  so the ordering is total and stable: current thread match, then superseded thread
  match, then no evidence; within a rank, newest case first with the id breaking
  ties. A replayed run therefore resolves `candidateIndex` to the same case.
- **Supersession is derived, not stored**, and its lane is case + recipient. See the
  `OutboundCorrelation` note in *Data Model* for why the narrower lane cannot work.
- **A superseded match stays in the candidate list.** It loses only the right to
  resume: `selectResumableMatch` skips it, so a stale Supplier 2 offer cannot resume
  a newer wait, while the agent may still legitimately read it as a new problem
  raised on an old thread — and must record why if it selects something else.
- **`resumableMatch` is reachability-checked.** Being current is not enough; the
  matched case must also be in the sender's candidate list, or a reply from a
  non-participant could resume a wait on a case deliberately kept out of its view.
- **The triage input never reads the body.** Sender and reply chain come from the
  envelope snapshot the transport gate persisted, so what the message says cannot
  widen what the agent is allowed to see.

#### Decisions taken in T-04a / T-04b / T-05a / T-05b

Four pure modules, no DI and no database, each with its own suite (`lib/email/normalizeEmail.ts`,
`data/inbound-signal.ts`, `lib/inbound/sanitizeBody.ts`, `lib/inbound/stripQuotedHistory.ts`).
The decisions below are recorded because later tasks depend on them.

- **Address identity is case folding only.** Plus-addressing and dots in the local part are preserved: stripping either merges addresses a receiving server may treat as distinct mailboxes, which would let one supplier's mail satisfy another's allowlist entry. RFC 5321 permits a case-sensitive local part; no server in this deployment behaves that way, and honouring it would reject a supplier who capitalizes their own address. A quoted local part (`"odd@name"@example.com`) is rejected rather than parsed, and an address that fails to normalize never matches anything, including itself. T-06 MUST compare through `emailsMatch` / `normalizeEmailOrNull`, never raw strings.
- **The candidate bound lives in a schema factory.** `createInboundSignalSchema(candidateCount)` applies the upper bound on `candidateIndex` per run, because the static schema cannot know how many candidates were offered; with zero candidates, `EXISTING_CASE` is unreachable by construction. **T-09a MUST use the factory, not the exported `inboundSignalSchema`** — the static schema validates shape but not the closed set, so using it would leave the correlation guarantee unenforced.
- **Registration and invocation carry different halves of that contract.** `defineAgent` runs once at import time and cannot know how many candidates a future message will be offered, so the registered `result.schema` is the static shape — what the model is asked to produce. The closed set is enforced per invocation: `runInboundTriage` re-validates every result with `createInboundSignalSchema(candidates.length)` and is the only supported way to run the agent. A signal that reached `decideTriage` from any other path is bounds-checked there too, so an out-of-range index is quarantined rather than resolved.
- **Every object in the contract is `.strict()`**, so an extra key the model invents is a parse failure rather than silently ignored input.
- **Two cross-field rules sit in the schema, not the apply step**, so a violating result is rejected before anything reads it: an `UNRELATED` message cannot select an existing case, and a `price` is valid only on `ALTERNATIVE_SUPPLY_OFFER`.
- **A quote-only message strips to empty text on purpose.** `stripQuotedHistory` does not fall back to the full body when the cut leaves nothing, because a message that is only history carries no new statement. T-09b MUST treat empty text as quarantine rather than re-reading the quoted part, which is exactly where the superseded quantities live.
- **`From:` alone never cuts.** It is too common in prose, so it counts as a forwarded-header block only when a `Sent:`/`To:`/`Subject:` line or its Polish equivalent follows within three lines. Polish marker variants are included throughout because both supplier mailboxes in this deployment write Polish.

**Message record reconciled with the current contract.** `data/types.ts` and the JSON store were
written for the earlier envelope design; they now match the natural-language contract:

| Was | Is |
|---|---|
| `businessMessageId` | `rfcMessageId` (RFC 5322 `Message-ID`) |
| `causationId` | `inReplyTo` + `references[]` |
| `messageType`, with `UNKNOWN` | `messageIntent`, re-exported from `data/inbound-signal.ts`, with `UNRELATED` |
| — | `sanitizedBody`, `extraction`, `extractionConfidence`, `triageDisposition` |
| `DuplicateBusinessMessageIdError` | `DuplicateRfcMessageIdError` |
| `findByBusinessMessageId(scope, id)` | `findByRfcMessageId(scope, id)` |

Two things changed beyond a rename:

- **The dedupe key is tenant + organization + `rfcMessageId`, with no direction segment.** An
  interim design added one, to stop a supplier client that echoes our `Message-ID` from colliding
  with our own outbound record and having its reply silently swallowed as a duplicate. The
  `SupplyMessage` to `InboundMessage` split removed the collision instead of guarding it: the
  collection holds inbound intake only, and what we sent lives in `communication_channels` plus
  the `OutboundCorrelation` anchor. The lookup and the append-time duplicate check share one
  `matchesDedupeKey` helper so they cannot drift.
- **`messageIntent` is re-exported, not redeclared.** The intent a stored message carries and the
  intent the triage agent may return are the same closed set; two copies would drift the moment
  one gained a value. `extraction` is validated by `inboundSignalSchema` on write, so a stored
  extraction cannot violate the contract that T-09a enforces.

### Phase 2: Initial impact and first human decision

Ships the first useful agent loop and real RFQ to Supplier 2.

1. Implement deterministic impact service for requirements, stock, production orders and customer deadlines.
2. Define the typed in-process `initial_impact_advisor` result schema and three option actions.
3. Register only read-only fact tools and namespaced allowed actions.
4. Add the first `INVOKE_AGENT` step and forced human disposition.
5. Implement `sourcing.apply_decision`: branches A/B create their canonical pending plan; branch C invokes `sourcing.request_alternative`.
6. Compose/send `ALTERNATIVE_SUPPLY_REQUEST` to Supplier 2 through `communication_channels`.
7. Wait for delivery evidence before entering `WAITING_FOR_ALTERNATIVE_OFFER`.
8. Add retry, timeout and manual retry UI.
9. Add TEST-005, TEST-006 and TEST-006A plus no-side-effect assertions for unselected options.

**Exit gate:** the user selects `CHECK_ALTERNATIVE_SUPPLIER`, exactly one real RFQ is delivered, and the durable workflow waits after restart.

### Phase 3: Offer correlation and final decision

Ships the second analysis based on real supplier evidence.

1. Atomically claim the inbound reply by its RFC 5322 `Message-ID` and run it through sanitization and triage.
2. Validate sender and scope, resolve the reply chain to the RFQ we sent, and validate the extracted quantity, date, amount and currency; an offer whose price or date is `unresolved` goes to NEEDS_ATTENTION rather than into the comparison.
3. Persist the encrypted offer and resume/read-through the waiting workflow.
4. Recompute impacts with actual offer values.
5. Define the typed in-process `final_resolution_advisor` and three complete `ResolutionPlan` options.
6. Add the second `INVOKE_AGENT` step and forced human disposition.
7. Render plan comparison including both suppliers, stock, cost, production and customer impact.
8. Implement `resolution.request_confirmation` to persist the immutable pending plan.
9. Send plan-specific `SUPPLY_ACCEPTANCE` messages only after the second disposition.
10. Add TEST-007 through TEST-009 and TEST-015/016.

**Exit gate:** a real Supplier 2 offer yields three grounded plans; approving plan C sends two acceptances but leaves production data unchanged.

### Phase 4: Confirmation join and atomic resolution

Ships the safe business completion.

1. Parse and claim `SUPPLY_COMMITMENT_CONFIRMED` from either supplier.
2. Validate each confirmation against the selected plan and its causation chain.
3. Record confirmations idempotently in any order.
4. Derive the required-confirmation set from the selected plan.
5. Keep the case non-green until the set is complete.
6. Implement `resolution.apply_confirmed` with optimistic lock and command-side preconditions.
7. Update local supplier commitments, inventory allocation and production requirement snapshots through owning commands.
8. Recalculate coverage and customer risk; require `500/500` and `PROTECTED` before `RESOLVED`.
9. Add timeout/manual-exception paths and compensating-case guidance.
10. Add TEST-010 through TEST-014.

**Exit gate:** confirmations in either order produce one final mutation; missing or changed confirmations never produce green state.

### Phase 5: Release verification, UI, and observability

Verifies and releases the complete capability as a repeatable five-minute demonstration; it does not add a separately deployable business flow.

1. Complete DataTable/detail timeline, two-decision history and confirmation checklist.
2. Add semantic status presentation, i18n, keyboard and accessibility states.
3. Expose correlation IDs, delivery failures, retries, agent runs and workflow instance links without raw sensitive payloads.
4. Document the existing fixture/reset procedure without adding a production reset endpoint or command.
5. Measure IMAP polling and configure demo timeout values.
6. Run full validation: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, `yarn build`.
7. Run TEST-017 and the live TEST-018 three times from a clean fixture state.

**Exit gate:** 3/3 runs complete under five minutes and end with visible `500/500`, `PROTECTED`, `RESOLVED` evidence.

## 📋 Implementation Plan

Execute phases strictly in order. Each numbered step is a separate testable task and must leave the application buildable. For PR delivery, use one PR per phase or a resumable execution plan that records every numbered step. Keep `supply_cases.enabled` off outside isolated tests until Phase 4 passes, then activate the complete workflow; do not expose partial live branches after Phase 1–3. Database migrations are generated and reviewed but not applied locally without explicit approval. After module/discovery changes run `yarn generate`; after ACL changes run the idempotent role-ACL sync for the existing demo tenant.

## 📋 Backlog

| ID | Priority | Status | Task | Outcome |
|---|---|---|---|---|
| `BACKLOG-001` | P0 | DONE | Implement a local JSON file backend for `ProductionOrder`, `ProductionPlan`, `SupplyCase`, `InboundMessage` and `OutboundCorrelation`. | Implemented behind repository contracts; the focused store suite covers persistence, reset, scope isolation, deduplication, append-only enforcement, atomic-write recovery and coverage calculation. |

### BACKLOG-001 — JSON file backend for local simulation

Implement a small repository/store layer used only by local development, automated tests and the Manufacturer A demo. The layer must expose typed operations for creating records, finding by ID, listing by tenant and organization, updating mutable records, resetting seeded data and reading the current state after an application restart.

Required behavior:

- store the five record types in configured JSON files under a Git-ignored local data directory;
- use stable UUIDs or deterministic fixture IDs and preserve `tenant_id` + `organization_id` on every record;
- enforce unique `rfc_message_id` within the scoped inbound message stream;
- reject updates and deletes for append-only `InboundMessage` and `OutboundCorrelation` records;
- support updates for `SupplyCase`, `ProductionOrder` and `ProductionPlan` only where the simulation contract allows them;
- write files atomically so an interrupted write does not leave invalid JSON;
- provide seed and reset helpers for the complete scenario, including the Supplier 1 proposal, production demand, production plan and optional Supplier 2 offer;
- keep the store behind a repository interface so the future ORM implementation can replace it without changing agent or workflow contracts;
- return explicit not-found, duplicate, scope-mismatch and append-only mutation errors;
- never treat the JSON files as production data, encrypted storage or a substitute for tenant isolation enforced by the real database.

Acceptance criteria:

- a clean reset creates deterministic records for all five types;
- a create followed by a new process instance and read returns the same records from disk;
- duplicate `rfc_message_id` does not create a second `InboundMessage`;
- a message replay produces one message and one workflow effect;
- records from another tenant or organization cannot be listed or read through the scoped repository;
- `InboundMessage` cannot be updated or deleted;
- a simulated interrupted write leaves the previous valid JSON state readable;
- the agent impact calculation and resolution flow can run against the JSON backend without a database connection;
- tests cover create/read/update, reset, deduplication, scope isolation, append-only enforcement and restart persistence.

This backlog item is the recommended first implementation step for local simulation. It does not remove the Phase 1 requirement for real entities and reviewed migrations when the feature moves from a local demo to a production-like Open Mercato module.

## 📣 Acceptance Criteria

- [ ] A real Supplier 1 proposal creates one case and one durable workflow.
- [ ] The first agent presents three grounded next steps and cannot mutate data.
- [ ] Only the first human selection of `CHECK_ALTERNATIVE_SUPPLIER` sends the RFQ.
- [ ] A real Supplier 2 offer resumes the correct case and provides the actual price.
- [ ] The second agent presents three complete plans using the real offer.
- [ ] Plan C approval sends two acceptances but does not yet mutate production planning.
- [ ] Both required confirmations can arrive in either order and are idempotent.
- [ ] Final mutation runs once, only after the selected plan is fully confirmed.
- [ ] `RESOLVED` requires `500/500` coverage and `PROTECTED` risk.
- [ ] Reject, timeout, malformed, stale, duplicate, delivery-failure and conflict paths are observable and non-green.
- [ ] Manufacturer A exposes no supplier-internal data and uses no cross-company database/API shortcut.
- [ ] The live demo succeeds 3/3 in less than five minutes.

## Changelog

| Date | Change |
|---|---|
| 2026-09-18 | Initial Manufacturer-only e-mail resolution draft. |
| 2026-09-18 | Added real Supplier 1 and Supplier 2 mailboxes and customer seed mapping. |
| 2026-09-18 | Reworked lifecycle after user approval: two agent analyses, two human decisions, pre-decision RFQ, three complete final plans, plan-specific confirmation join, and final mutation only after confirmation. |
| 2026-09-18 | Added `BACKLOG-001` for a local JSON file backend and documented why it is a temporary simulation layer before the real ORM/database implementation. |
| 2026-09-18 | Replaced the frozen `SupplyEnvelope` JSON contract with natural-language inbound mail plus a propose-only triage agent. Recorded the rejected alternative and its reason (it required an inter-company API that Non-goals exclude). Correlation now rests on RFC 5322 `Message-ID` / `In-Reply-To` for dedupe and causation, and on closed-set agent selection over a code-built candidate list for the first message in a chain. |
| 2026-09-19 | Converged the two parallel T-10 implementations. `supply_cases:inbound-message-accepted` now reaches triage through `supply_cases.inbound.apply_triage` instead of calling `applyTriageOutcome` directly, so the auto-apply bar has one entry point. The command accepts `scope`, honoured only under `ctx.systemActor` (a request supplying it gets `403`, a system call omitting it gets `400`), and resolves the agent through the `inboundTriageInvokerFactory` DI seam so the E2E exercises the real command. `supply_cases.case.proposal_received` is emitted from a single site and only when a case is opened; a reply onto an existing case emits nothing. Workflow start/signal and `workflow_instance_id` persistence stay in the subscriber. Added `apply-triage-command-scope.test.ts`; `inbound-flow.e2e.test.ts` drives a real `CommandBus`. |
| 2026-09-18 | Spec consistency pass after two sessions edited it in parallel. Corrected claims that had become false: the dedupe key no longer carries a direction segment (the reconciliation block still described the interim design and contradicted a later entry); the i18n enum list dropped `direction`/`deliveryStatus`, and the dead keys were removed from all five locales; `message_intent` is nullable before triage; the JSON backend is five record types, not four; `supply_cases.inbound.apply_triage` was missing from the command list; the `InboundMessage` closing note had been stranded under `OutboundCorrelation`. Reconciled the audit with the task table (T-09 `DONE`, T-10a `WIP` because the accepted event already ships) and named the real remaining gap: nothing subscribes to `supply_cases.inbound_message.accepted`, so the inbound path is built but not joined. Dropped absolute test counts from the audit. |
| 2026-09-18 | T-08a/T-08b implemented: deterministic candidate-list construction (open, in-scope, sender-participates) and reply-chain resolution with derived supersession, composed by `assembleTriageContext` into the scoped context T-09a projects for the agent. Added the app-owned `OutboundCorrelation` anchor the Commands section already required but the Data Model table omitted, plus `buildOutboundIdempotencyKey` (case + phase + recipient). |
| 2026-09-18 | T-05b/T-06/T-07 implemented. Renamed the app-owned intake record from `SupplyMessage` to `InboundMessage` (neutral before triage: nullable `case_id`, nullable `message_intent`, no direction/delivery/sent fields), added `prepareInboundBody` (raw kept verbatim, only the author's new text reaches the agent), the deterministic transport gate (`resolveInboundEnvelope` + `evaluateInboundTransport` + `acceptInboundMessage`) and the `communication_channels.message.received` subscriber, plus the `supply_cases.inbound_message.accepted` event. Scoped dedupe on `rfcMessageId` is now direction-free because the collection is inbound-only. |
| 2026-09-18 | T-09a/T-09b completed. Corrected the agent's result kind to `research`: a `proposal` result is reshaped by the runtime into the `{ options, rationale }` envelope, which would have mangled the extracted `InboundSignal`. Converged on T-08a's `InboundCandidate` as the one candidate contract, with `lib/triage/triageInput.ts` narrowing it to an index-only projection that omits `caseId`. Added `recordTriage` — the single narrow exception to the intake record's append-only rule, refusing to re-decide a disposed message — the `supply_cases.inbound.apply_triage` command (input is a message id and nothing else; the bar is rebuilt inside), `createAgentRuntimeInvoker` over `agentRuntime.run`, and `NO_LOCAL_DEMAND` for a `NEW_CASE` answer whose SKU no production plan requires. 231/231 tests, typecheck, lint and ds:check green. |
| 2026-09-18 | T-09a/T-09b first implemented against fixtures (superseded by the row above). `ai-agents.ts` registers `supply_cases.inbound_triage_advisor` via `defineAgent` with `tools: []`, `allowedActions: []` and read-only mutation policy; `lib/triage/` adds the index-only agent input (the internal `caseId` is never shown), `runInboundTriage` (the only supported entry point, re-validating every result with `createInboundSignalSchema(candidates.length)`) and the pure `decideTriage` bar. Recorded why the registered schema is the static one and the factory runs per invocation. Pending: the real candidate list (T-08a), `threadMatch` (T-08b) and persisting the decision (T-10a/T-10b). |
| 2026-09-18 | Reconciled `data/types.ts`, the JSON store, errors, fixtures and their tests with the natural-language contract (`rfcMessageId`, `inReplyTo`/`references`, `messageIntent`, extraction fields) and made the dedupe key direction-scoped, fixing a defect where an echoed Message-ID could swallow a real reply. Unblocks T-07 and T-08b. |
| 2026-09-18 | T-04a/T-04b/T-05a/T-05b implemented as pure modules with unit suites; recorded the decisions later tasks depend on (candidate bound in a schema factory, strict objects, quote-only strips to empty) and the `data/types.ts` divergence that blocks T-07/T-08b. |
| 2026-09-18 | Added a `Status` column to the Phase 1 execution breakdown and made that table the single source of truth for Phase 1 progress; added T-01 so the table covers the whole phase. |
| 2026-09-18 | Added the Phase 1 execution breakdown (T-02..T-11) with per-task oracles, ordering constraints and parallelizable work, after the natural-language rewrite grew Phase 1 from 9 to 12 steps. |
| 2026-09-18 | Phase 1 step 1 implemented: enabled `workflows`, `business_rules`, `api_keys` and the enterprise agent modules; recorded the `@open-mercato/cli` 0.8.0 standalone manifest-import patch that unblocks `yarn typecheck`. |
| 2026-09-18 | Decided to start the supplier agents with the simpler `in-process` runtime; OpenCode with Markdown-authored agents/skills remains a future runtime migration behind the same stable agent and outcome contracts. |
| 2026-09-18 | Completed `T-02`: added `acl.ts` (four scoped features), `setup.ts` (admin role wildcard plus a non-destructive demo seed guarded on `SC-001`) and the five i18n locale files covering the module's existing enums. Discovery binds all of them; `yarn typecheck`, `yarn lint`, `yarn ds:check` and `92/92` tests are green. |
| 2026-09-18 | Audited the repository against the task table: marked `BACKLOG-001` `DONE` after `32/32` focused tests; marked T-04a/T-04b/T-05a `DONE`, kept T-05b `WIP`, deferred T-03 for production persistence, and recorded that IMAP still needs a supply-specific event bridge. |
| 2026-09-18 | Clarified the target inbound architecture: the generic IMAP event first passes a deterministic channel/scope/allowlist/dedupe gate, then starts one triage workflow; `case.proposal_received` is emitted only after triage and does not directly classify raw mail or create a second workflow. |
| 2026-09-18 | Renamed the generic pre-classification record from `SupplyMessage` to `InboundMessage`; it may represent supplier, customer, reply or unrelated inbound traffic, while outbound records remain owned by `communication_channels`. |
| 2026-09-19 | Added TEST-001A–I for the event-driven inbound path, persisted business triage outcomes on auditable `InboundMessage` records, and marked T-09a/T-09b/T-10a done. T-10b remains WIP pending live database-backed `WorkflowInstance` restart and signal verification. |
