# Manufacturer Supply Exception: Email, Agent Analysis, Human Decisions, and Resolution

**Date:** 2026-09-18  
**Status:** Draft for user review  
**Scope:** Manufacturer A only

## 📣 TLDR

Manufacturer A odbiera prawdziwy e-mail o problemie dostawy, koreluje go z lokalnym zapotrzebowaniem i uruchamia trwały workflow. Propose-only agent analizuje wpływ na zapotrzebowanie, zapas, zlecenia produkcyjne i terminy klientów; człowiek najpierw wybiera sprawdzenie Supplier 2, a po otrzymaniu realnej oferty wybiera kompletny plan rezolucji. System wysyła decyzje do obu dostawców, czeka na wymagane potwierdzenia i dopiero wtedy atomowo aktualizuje lokalny plan, przelicza ryzyko oraz zamyka case jako `RESOLVED`.

## 🎯 Nadrzędny cel biznesowy (core)

Cały projekt ma doprowadzić każdy zweryfikowany problem z dostawą do potwierdzonego planu, który zabezpiecza pełne wymagane pokrycie, albo do jawnego zamknięcia sprawy bez zmian. Samo wykrycie problemu, rekomendacja agenta, wybór operatora, wysłanie akceptacji ani częściowa dostawa nie są sukcesem biznesowym.

Jedynym zielonym warunkiem sukcesu jest komplet wymaganych potwierdzeń od dostawców oraz potwierdzenie przez system, że zapotrzebowanie jest w pełni pokryte. W scenariuszu demonstracyjnym oznacza to: `500 wymagane → potwierdzone 500/500 → PROTECTED → RESOLVED`.

Główna ścieżka biznesowa, na której opieramy rozwój, wygląda tak: Supplier 1 zgłasza częściową dostawę, operator wybiera sprawdzenie Supplier 2, system odbiera i analizuje realną ofertę, operator wybiera ostateczny plan, dostawcy potwierdzają wykonanie, a dopiero potem system zamyka sprawę jako rozwiązaną. Opóźnienie, zapas magazynowy i alternatywny dostawca są odnogami tej samej zdolności, a nie osobnymi produktami.

Każdy nowy agent, workflow, komenda, ekran i test musi wspierać ten cel albo być jasno oznaczony jako infrastruktura pomocnicza. Nie wolno pokazywać zielonego sukcesu przed końcowym potwierdzeniem pokrycia; brak pełnego pokrycia oznacza sprawę nadal otwartą, wymagającą uwagi albo zamkniętą bez sukcesu.

## 📣 Problem Statement

Wiadomość od Supplier 1 informuje, że pierwotne zobowiązanie `500 × MAT-42` na środę jest zagrożone, a realna dostępność wynosi `300` w środę i `200` w piątek. Manufacturer A musi ustalić wpływ na swoje zlecenia produkcyjne i terminy klientów, rozważyć alternatywy, pozyskać prawdziwą ofertę Supplier 2 oraz uzyskać dwie decyzje człowieka bez przedwczesnego zapisu niepotwierdzonego planu.

Transport e-mail jest zawodny i co najmniej jednokrotny: wiadomości mogą być dostarczane ponownie, odpowiedzi mogą przyjść po restarcie procesu, a jedna z dwóch końcowych odpowiedzi może nie nadejść. Agent nie może wykonywać mutacji domenowych. Case staje się zielony wyłącznie po potwierdzeniu całego wybranego planu i jego atomowym zastosowaniu.

## 📣 Goals

- **REQ-001:** Prawdziwa, napisana naturalnym jezykiem wiadomosc od `supplier@hackon-om-wro.cloud` tworzy jeden zweryfikowany i zdeduplikowany `SupplyCase` w zakresie tenant + organization; fakty wyciaga propose-only agent triazu, a czlowiek widzi je obok oryginalnej tresci.
- **REQ-001A:** Jeżeli wiadomość jest pewnie rozpoznana jako `SUPPLY_PROPOSAL` dla `NEW_CASE`, SKU jest jawne i wskazuje dokładnie jeden lokalny `ProductionPlan`, brakujące pola oferty nie pozostawiają wiadomości poza kolejką: system tworzy i podłącza jeden `SupplyCase` w statusie `NEEDS_ATTENTION`, bez wymyślania dat lub commitments i bez uruchamiania workflow, initial-impact ani outbound.
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

The message is auto-applied only when the agent's `confidence` clears the configured threshold, its `unresolved` list is empty, and thread evidence and agent choice do not contradict each other. Otherwise it requires attention. Existing-case correlation remains fail-closed: low confidence, unresolved fields or contradictory thread evidence never links or mutates a candidate case, and a human picks the target from the same bounded candidate list. Ambiguity is never resolved by guessing.

There is one narrow `NEW_CASE` exception for visibility, not for automatic processing. When all of the following hold, the deterministic apply step creates a case shell and links the message even though `unresolved` is non-empty:

- intent is exactly `SUPPLY_PROPOSAL`;
- correlation is exactly `NEW_CASE`;
- confidence still clears the configured threshold;
- `sku` is present and resolves, within the same tenant + organization, to exactly one local `ProductionPlan`;
- there is no thread contradiction.

The created case takes `sku`, `requiredQuantity`, `requiredDate`, production-plan/order references and customer snapshot only from that local plan. It is created directly as `NEEDS_ATTENTION` with the existing case reason `MISSING_DATA`; the linked `InboundMessage` retains `triageOutcome = NEEDS_ATTENTION`, `needsAttention = true` and `failureReason = NEEDS_ATTENTION:UNRESOLVED_FIELDS`. `triageDisposition` remains null because no human has confirmed the extraction. `supplier1Proposal` may contain only schema-valid facts actually extracted from the mail; absent quantities, dates or commitments stay absent/empty and are never copied from the local demand or synthesized.

This branch emits no `supply_cases.case.proposal_received`, starts no `WorkflowInstance`, leaves `workflowInstanceId` null, runs no initial-impact analysis and sends no RFQ or other outbound message. It only makes the accepted mail visible and actionable as a case. A later, explicitly guarded human remediation flow may complete the facts and start processing; defining that remediation command is outside this minimal change.

If SKU is absent, confidence is below threshold, no local plan matches, or multiple local plans make the target non-deterministic, no case is created. Existing-case replies, including replies with unresolved fields, keep their current correlation and review behavior unchanged.

`causationId` is no longer carried in the body. For every message that answers one of ours - the Supplier 2 offer and both confirmations - the reply chain supplies causation directly, which is what prevents a stale offer from resuming a newer wait. A reply whose `In-Reply-To` resolves to a superseded request is rejected for resumption and recorded.

**Invariants across all stages.**

- Every outbound message uses a durable idempotency key derived from case + phase + recipient, and its `Message-ID` is persisted so replies can be correlated later.
- Extraction failure, sender mismatch, an unusable body, or an unavailable/invalid LLM provider enter quarantine or `NEEDS_ATTENTION` without changing an existing case. The bounded `NEW_CASE` visibility branch may create a non-actionable case shell from a uniquely resolved local plan, but no path fabricates supplier commitments or dates to keep the demo moving.
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
- `unresolved` names every field the agent could not determine from the text. A non-empty list always forces human review; only the bounded `NEW_CASE` visibility branch may additionally create a linked, non-actionable `NEEDS_ATTENTION` case shell.
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

For the bounded unresolved `NEW_CASE` branch, no schema or migration is added. Existing fields represent the state: `status = NEEDS_ATTENTION`, `needs_attention_reason = MISSING_DATA`, `workflow_instance_id = null`, local-demand fields come from the uniquely matched `ProductionPlan`, and `supplier_1_proposal` contains only validated facts extracted from the mail. Missing supplier dates/commitments remain absent or empty rather than being populated from `required_date`.

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
| TEST-001E | unresolved data for an existing-case target, ambiguous target or unresolved SKU | `NEEDS_ATTENTION`; no candidate case is linked or mutated and no quantity, date, price or SKU is fabricated |
| TEST-001F | agent contradicts `threadMatch` | `NEEDS_ATTENTION`; no automatic assignment to the conflicting case |
| TEST-001G | provider unavailable/schema-invalid | `QUARANTINED`, `needs_attention=true`, no case or workflow effect |
| TEST-001H | replay of the same event | one inbound message, one triage invocation, one case, one workflow and one business event |
| TEST-001I | prompt-injection-like message text | body cannot select arbitrary `caseId`, bypass `candidateIndex`, invoke tools, send email or mutate data outside the system decision |
| TEST-001J | confident `SUPPLY_PROPOSAL` + `NEW_CASE` + resolved SKU/local plan, but missing dates or commitments | exactly one case shell is created from local-demand facts with `NEEDS_ATTENTION:MISSING_DATA`; inbound message links to it and retains `NEEDS_ATTENTION:UNRESOLVED_FIELDS`; extracted missing facts remain absent/empty; no `proposal_received`, workflow instance, initial-impact run, decision proposal, RFQ or outbound message; replay creates nothing else |
| TEST-001K | unresolved `NEW_CASE` without SKU, below confidence threshold, with zero plans or with ambiguous plan matches | no case is created or linked; message remains reviewable and no workflow/outbound side effect occurs |
| TEST-002 | duplicate proposal | no duplicate case, workflow or outbound effect |
| TEST-003 | HTML body, quoted reply history and channel footer | sanitizer yields only the author's new text; superseded quantities never reach the agent |
| TEST-003A | prose proposal with all facts present | extraction matches expected SKU, quantities and dates; `unresolved` empty |
| TEST-003B | vague prose with a missing date, and an unrelated message | `unresolved` non-empty always requires attention; only TEST-001J's bounded `NEW_CASE` branch may create a non-actionable case shell; `UNRELATED` -> quarantine |
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

> **Exit gate status (audited 2026-09-19): NOT MET. Phase 1 is `IN_PROGRESS`.**
> Every deterministic oracle is green, including one durable `WorkflowInstance` per case verified on a
> live database (TEST-002A) and the read-only browser slice (3/3). Three things are missing:
> (1) **no live agent provider run** — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are empty in this
> environment, so `createAgentRuntimeInvoker` has never executed and every triage test injects a fake
> invoker; (2) **no live inbound mail run** — nothing records a real message from
> `supplier@hackon-om-wro.cloud` traversing the gate, so "after repeated polling" is unproven;
> (3) **TEST-UI-009/010/012 have no browser evidence.** Full record:
> [`../runs/2026-09-19-phase1-phase2-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-closure/STATE.md).

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
| T-09c | `TODO` | 9 | Add the bounded unresolved `NEW_CASE` visibility branch: resolve one local plan by SKU, create/link a `NEEDS_ATTENTION:MISSING_DATA` case shell from local facts, preserve unresolved extraction and suppress every downstream effect | TEST-001J and TEST-001K pass; focused existing-correlation tests remain green |
| T-10a | `DONE` | 10 | Emit `supply_cases.inbound_message.accepted` after the gate and `supply_cases.case.proposal_received` after deterministic triage apply, both post-commit | TEST-001A–C and TEST-001H pass; proposal event is declared and emitted only for a valid auto-applied supplier proposal |
| T-10b | `DONE` | 10 | Start exactly one inbound workflow instance for a valid supplier proposal; persist `workflow_instance_id`; signal an existing scoped workflow for replies | TEST-002A passes on the real engine over a live database: one `WorkflowInstance` per case, `workflow_instance_id` persisted, the run parked on `await-reply`, still there after a process restart, the next correlated message signalling that same instance, a replay creating no second instance and repeating no effect, and the instance unreachable from another tenant |
| T-11 | `WIP` | 11 | Case list + detail read surfaces: `RECEIVED`, original message text beside extracted facts, loading/empty/error states | Implementation ships and is covered: `read-model.test.ts` (scoped pagination, derived coverage, cross-tenant isolation, redaction without `messages.view`, degraded state), `read-api.test.ts` (auth/feature metadata, scoped list, invalid-filter rejection, 404 out of org) and `__integration__/supply-cases-read-only.spec.ts` 3/3 in the browser. NOT `DONE`: the row's oracle is manual verification against the Phase 1 exit gate, and that gate is unmet (no live provider run, no live inbound mail run, TEST-UI-009/010/012 unexecuted) |

**Ordering constraints.** T-02 precedes everything. The JSON repository's scoped dedupe contract (`BACKLOG-001`) enables T-07 for the demo; production T-03b must preserve the same unique claim invariant before the ORM backend is enabled. T-04a precedes T-06 (the allowlist compares normalized addresses). T-04b precedes T-09a (the schema is the agent's outcome contract). T-05a precedes T-05b. T-08a and T-08b precede T-09a (both feed the agent's input). T-09b precedes T-09c and T-10a/T-10b. T-11 is last.

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
- `T-10b` is `DONE`: the subscriber resolves the real `workflowExecutor`/`signalHandler`
  through DI, starts one instance per case, persists `workflow_instance_id` before
  executing it and signals the existing instance for a reply — and that is now verified
  against the engine itself. `__tests__/inbound-workflow-engine.db.test.ts` resolves the
  workflows module's own DI registrations over a live MikroORM connection, so the facts it
  asserts are persisted `workflow_instances` rows rather than harness call counts. The
  restart is a real one: the ORM connection and the JSON store are closed and rebuilt from
  the same durable state between the start and the reply.
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

Two things are left before Phase 1 closes, in this order:

1. **Exercise a live provider.** Every triage test injects the agent through
   `inboundTriageInvokerFactory`, so `createAgentRuntimeInvoker` itself has never run. The
   first real run is where a prompt or schema mismatch will surface.
2. **`T-11`**: case list and detail read surfaces — `RECEIVED`, the original message text
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

> **Exit gate status (audited 2026-09-19): NOT MET. Phase 2 is `IN_PROGRESS`.**
> The durability half is proven on a live database: `TEST-006` in
> `__tests__/inbound-workflow-engine.db.test.ts` runs SELECT C through one send, delivery evidence,
> a real restart and a replay, ending with one workflow, one logical RFQ and `already_applied`.
> TEST-005, TEST-005B, TEST-006A, TEST-006C and TEST-006D (browser) are green too, as are the atomic
> concurrent decision claim, the optimistic-lock decision route and the explicit workflow transitions.
> Missing: (1) **no real RFQ has ever been delivered** — every outbound assertion injects a fake
> `SupplierOutboundPorts.send`, and `communicationChannelsSendAsUser` has never carried an
> `ALTERNATIVE_SUPPLY_REQUEST`; (2) **no live provider run** for `initial_impact_advisor`;
> (3) **TEST-006B is partial** — `REJECT` and `EDIT` have no test; (4) **step 4's `INVOKE_AGENT` step
> and P2-07's Caseload disposition bridge were not built** — the implementation uses a
> `WAIT_FOR_SIGNAL` step plus the app's own guarded decision route, which needs to be accepted here or
> implemented. Full record:
> [`../runs/2026-09-19-phase1-phase2-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-closure/STATE.md).

### Phase 3: Offer correlation and final decision

Ships the second analysis based on real supplier evidence.

#### Entry gate and ownership

Phase 3 is app-owned. All runtime changes belong below
`manufacturer-app/src/modules/supply_cases`; it must not modify `packages/core`,
`packages/enterprise`, or the contracts owned by those packages. It extends the existing
`InboundMessage`, `OutboundCorrelation`, `SupplyCase`, command bus, event bus, workflow and
Caseload contracts instead of introducing a parallel orchestration or messaging layer.

Implementation may start only after the Phase 2 exit gate is green: the SAME durable workflow
instance must have created and delivered exactly one `ALTERNATIVE_SUPPLY_REQUEST`, persisted its
correlation anchor, and be paused waiting for Supplier 2. The current repository does not yet meet
that gate: `src/modules/supply_cases/workflows.ts` still implements only
`START -> WAIT_FOR_SIGNAL(await-reply) -> END`. Phase 3 must extend the completed Phase 2 graph,
not replace or bypass it.

The local JSON backend remains a demo/test adapter behind the existing repositories. It is not
encrypted production storage and must never be described as such. Phase 3 tests and the demo use
synthetic, non-sensitive mailbox content. The future ORM adapter must map offer/body fields through
Open Mercato encryption helpers and `findWithDecryption`/`findOneWithDecryption`; do not add custom
cryptography to the JSON adapter.

#### Inbound offer correlation, claim and triage

The existing intake path remains authoritative:

1. `communication_channels.message.received` passes the deterministic channel, scope and sender
   gate, then `InboundMessageRepository.appendIfAbsent` atomically claims the normalized RFC 5322
   `Message-ID` within tenant and organization scope. A replay returns the existing record and
   produces no second triage, offer, signal or workflow effect.
2. `prepareInboundBody` stores the raw synthetic demo body and sends only sanitized new author text
   to the triage agent. Quote-only text is empty and is quarantined; quoted quantities are never
   re-read as a new offer.
3. `assembleTriageContext` builds the closed candidate list. A Supplier 2 offer is eligible only if
   the normalized sender is a participant of the case, the case is in the same tenant and
   organization, and `In-Reply-To`/`References` resolves to the current, non-superseded
   `ALTERNATIVE_SUPPLY_REQUEST` `OutboundCorrelation` for that case and recipient.
4. The existing `supply_cases.inbound.apply_triage` command invokes the propose-only triage agent.
   It must return `ALTERNATIVE_SUPPLY_OFFER` plus the candidate index and extracted commitments;
   free-form case IDs remain forbidden.

The current narrow `AUTO_APPLY` path continues unchanged for ordinary messages. Phase 3 adds one
deterministic audit exception: when a message resolves uniquely to the current Supplier 2 RFQ but
its offer fields are incomplete or invalid, it may set `InboundMessage.caseId` to that resolved case
while retaining `triageDisposition = NEEDS_ATTENTION`. This makes the original message visible in
the case timeline without treating it as accepted evidence. Ambiguous, stale, superseded,
cross-scope or wrong-sender messages remain unlinked/quarantined.

#### Offer validation and atomic persistence

Add strict schemas beside the existing inbound schemas, and a pure validator under
`lib/resolution/`. A usable Supplier 2 offer requires all of the following:

- intent is `ALTERNATIVE_SUPPLY_OFFER` and the candidate is the uniquely correlated open case;
- extracted SKU equals the case SKU;
- quantity is a positive integer and equals the outstanding RFQ quantity; this MVP cannot safely
  prorate a total offer price;
- each commitment date is a valid `YYYY-MM-DD` calendar date and quantities sum to the offered
  quantity;
- total amount is finite and non-negative;
- currency is exactly three uppercase letters and equals the case currency; no FX conversion is
  available in this phase;
- the correlated RFQ is current, not superseded, and the case is waiting for this alternative offer.

A later-than-required date is valid evidence and is persisted; it makes `USE_ALTERNATIVE`
infeasible during recomputation rather than making the message malformed. Missing/unresolved
quantity, date, amount or currency; a quantity/currency mismatch; conflicting second offer; or an
invalid calendar date sets the case to `NEEDS_ATTENTION`, records a bounded reason, emits no resume
signal and creates no resolution plans. Raw bodies and amounts must not be copied into events or
logs.

Extend `SupplyCase.alternativeOffer` as a typed snapshot containing at least:
`schemaVersion`, `supplierId`, `sourceInboundMessageId`, `sourceRfcMessageId`,
`sourceOutboundCorrelationId`, `requestedQuantity`, `offeredQuantity`, normalized commitments,
`priceTotal { amount, currency }`, `offerHash`, and `recordedAt`. `offerHash` is a canonical hash of
the decision-relevant normalized fields, not the raw body.

Implement repository operation `recordAlternativeOfferIfAbsent(scope, caseId, expectedUpdatedAt,
offer)` inside the SupplyCase collection's existing serialized write lock. The compare-and-set,
empty-slot check and write are one critical section:

- same source message and same `offerHash` is an idempotent no-op;
- a different source/hash never overwrites accepted evidence and yields `OFFER_CONFLICT`;
- stale `expectedUpdatedAt` yields the standard optimistic-lock conflict;
- a scope mismatch is indistinguishable from not found.

After the offer commits, emit `supply_cases.alternative_offer.received` and signal the already
persisted `workflowInstanceId`. If the workflow has not reached its wait yet, the engine's durable
signal/read-through contract must consume the recorded offer when entering the step. A signal may
be retried; the `(workflowInstanceId, stepId, offerHash)` effect is idempotent. Never create a second
workflow instance for the offer.

#### Recompute and immutable resolution plans

Re-run the existing deterministic impact service using the persisted offer snapshot. Code, not the
LLM, creates exactly three complete plans and their action payloads. Add the strict `ResolutionPlan`
schema to `data/types.ts` (or a dedicated schema imported there) and pure construction under
`lib/resolution/`. Every plan contains:

- `schemaVersion`, stable `id`, `factsHash`, `offerHash` and canonical `planHash`;
- feasibility plus bounded infeasibility reasons;
- Supplier 1 accepted/cancelled commitments and Supplier 2 accepted/declined commitments;
- stock allocation and remaining stock;
- on-time quantity, shortage, production impact and customer/deadline impact;
- `additionalCost { amount, currency, basis }`;
- the exact required confirmation set;
- ordered outbound effects with recipient, technical phase and expected quantities/dates;
- the exact namespaced command action later allowed for that plan.

For the frozen `SC-001` demo fixture the plans are:

| ID | Supplier 1 | Supplier 2 | Stock | Coverage / customer | Additional cost | Required confirmations |
|---|---|---|---|---|---|---|
| `ACCEPT_DELAY` | accept 300 Wednesday + 200 Friday | decline offer | 0 | late 200; customer risk remains exposed | `0 PLN` | Supplier 1 |
| `USE_STOCK` | accept 300 Wednesday; cancel 200 Friday | decline offer | allocate 200 | 500 on time; protected | `300 PLN` demo stock policy | Supplier 1 |
| `USE_ALTERNATIVE` | accept 300 Wednesday; cancel 200 Friday | accept 200 using actual offer commitments | 0 | 500 on time only when offer dates satisfy the deadline | actual persisted offer total, `1400 PLN` in the fixture | Supplier 1 and Supplier 2 |

The `300 PLN` stock basis is an app-owned deterministic demo policy, isolated in a named
resolution policy module; it is not a platform pricing rule. An infeasible plan remains visible and
labelled but cannot be approved. Persist the final facts snapshot, all three plans, their hashes and
`finalFactsHash` on `SupplyCase` before invoking the agent. A repeat with equal facts/offer hashes is
a no-op; changed facts invalidate the earlier analysis and proposal.

#### `final_resolution_advisor` and second human disposition

Register `supply_cases.final_resolution_advisor` in the existing `ai-agents.ts` using the in-process
runtime and canonical `kind: 'proposal'` envelope. It receives only the bounded deterministic facts
and three code-built plans, has no tools, no mutation policy, and may explain/rank but may not create
or alter plans. Validate its output against the persisted options: every option ID, `planHash` and
action payload must match exactly; unknown, missing, duplicated or mutated plans fail closed with
`ANALYSIS_FAILED` and `NEEDS_ATTENTION`. There is no actionable LLM-generated fallback.

Add the second stable `INVOKE_AGENT` workflow step with the installed contract:
`agentId: 'supply_cases.final_resolution_advisor'`, a bounded input mapping, strict output mapping,
and `onResult: { alwaysAsk: true }`. Its subject identifies the SupplyCase without embedding mail
bodies or customer/supplier-private text. Forced review creates one Caseload proposal and parks the
same workflow; replay must resolve the existing run/proposal, not create another.

Use app-owned persistent subscribers for the installed proposal events:

- `agent_orchestrator.proposal.created` binds the proposal ID to this case only when agent ID,
  workflow instance, stable final step ID and scope all match;
- `agent_orchestrator.proposal.disposed` is the authoritative bridge for `selectedOptionId`, because
  `agent_orchestrator.proposal.ready` does not carry it. Locate the bound case in scope, verify the
  proposal/workflow/step, and invoke `supply_cases.resolution.apply_decision` idempotently.

The Caseload user needs both `agent_orchestrator.proposals.dispose` and
`supply_cases.decisions.apply`. The app subscriber must re-authorize `dispositionBy` for the latter
before any app side effect; enterprise authorization alone is insufficient. `approved` accepts only
an exact feasible persisted option. `edited` cannot safely supply the edited payload through the
current event contract, so it sends nothing and moves the case to `NEEDS_ATTENTION` for reanalysis.
`rejected` records a terminal human decision and sends nothing. Unauthorized, stale, malformed,
guardrail-blocked, timed-out or errored dispositions send nothing and remain non-green.

#### Decision effect and plan-specific communication

Add these app command handlers using strict zod inputs and the existing command bus:

- `supply_cases.offer.record_alternative`
- `supply_cases.analysis.record_final`
- `supply_cases.analysis.bind_final_proposal`
- `supply_cases.resolution.apply_decision`
- `supply_cases.resolution.request_confirmation`
- `supply_cases.case.mark_needs_attention`

`resolution.apply_decision` reloads the case, proposal binding and exact selected plan; verifies
scope, disposition, actor authorization, `updatedAt`, `factsHash`, `offerHash`, `planHash` and case
status; then calls `resolution.request_confirmation`. No command accepts a caller-supplied plan body
as authority.

`resolution.request_confirmation` performs a scoped compare-and-set that persists
`selectedResolutionPlanId`, an immutable copy in `pendingResolutionPlan`, the decision/proposal
identity and a sending status before any network side effect. It then uses the existing
`sendSupplierMessage` seam with phase `SUPPLY_ACCEPTANCE`. The selected plan is the sole source of
recipients, quantities and dates:

- `ACCEPT_DELAY`: send Supplier 1 its accepted delayed commitments and Supplier 2 a decline notice;
- `USE_STOCK`: send Supplier 1 the 300-unit accepted/amended commitment and Supplier 2 a decline;
- `USE_ALTERNATIVE`: send Supplier 1 the 300-unit accepted/amended commitment and Supplier 2 the
  200-unit acceptance using the actual persisted offer.

The existing technical phase name `SUPPLY_ACCEPTANCE` covers both acceptance/amendment and the
Supplier 2 decision notice; the rendered message states the business decision explicitly. Decline
notices require no confirmation. Every outbound effect has a deterministic idempotency key derived
from case, selected plan/effect, phase and normalized recipient, and persists its
`OutboundCorrelation` before send. A replay reuses the RFC Message-ID and cannot create a second
logical send. If plan C's second send fails, retain the first result and retry only the missing
effect. Do not roll back or mutate production data.

Case state advances to `WAITING_FOR_SUPPLIER_CONFIRMATIONS` only after
`communication_channels.message.sent` evidence exists for every declared effect. Acceptance by the
communication hub is not SMTP delivery evidence. Delivery failure/timeout records the failed
effect, remains non-green, and exposes an idempotent retry. Phase 3 never updates production plans,
production orders, inventory allocation or supplier commitments; those remain Phase 4 work after
the confirmation join.

#### Events, privacy and failure reasons

Extend `events.ts` with scoped, additive event IDs:

- `supply_cases.alternative_offer.received`
- `supply_cases.final_analysis.recorded`
- `supply_cases.resolution_decision.applied`
- `supply_cases.plan_acceptance.requested`
- `supply_cases.plan_acceptance.sent`

Payloads contain tenant/organization identifiers plus record IDs, bounded status, hashes and effect
counts only. They must not contain raw/sanitized bodies, addresses beyond existing correlation IDs,
customer data, offer amounts or complete plans. Emit after successful persistence. Consumers and
handlers re-read scoped state and are replay-safe.

Reuse existing failure reasons where they are semantically exact (`MISSING_DATA`,
`ANALYSIS_FAILED`, `STALE_DECISION`, `WAIT_TIMEOUT`, `DELIVERY_FAILED`) and add only the bounded
app-level reasons needed to distinguish `OFFER_INVALID`, `OFFER_CONFLICT` and
`DECISION_UNAUTHORIZED`. Each path records an auditable reason without leaking raw content.

#### UI, ACL and i18n

Extend the existing detail API and `/backend/supply-cases/[id]`; do not add a parallel decision
screen. The scoped read model exposes the alternative offer summary, recomputed impact, exactly
three plans, feasibility, supplier/stock/cost/production/customer comparison, decision state,
delivery state and proposal link. It does not expose raw email bodies by default.

The comparison must:

- show actual Supplier 2 price/currency and commitments, the `300 PLN` stock-cost basis, affected
  quantities/dates, required confirmations and infeasibility reasons;
- make all options neutral with no preselection and disable infeasible approval;
- deep-link to the canonical Caseload route `/backend/caseload/[proposalId]` for disposition rather
  than implementing a second approval endpoint;
- show `NEEDS_ATTENTION`, stale/conflict, timeout, partial-send and retry states; never show green
  before Phase 4 completes;
- use `LoadingMessage`, `ErrorMessage`, `apiCall`, guarded mutations where applicable, semantic
  design-system tokens, keyboard operation, focus management and accessible labels.

Keep the existing app ACL IDs. Viewing requires `supply_cases.view`; message evidence requires
`supply_cases.messages.view`; retry/operational actions require `supply_cases.manage`; final
disposition requires both the enterprise dispose feature and `supply_cases.decisions.apply`.
Add every Phase 3 label, status, failure reason, field, action, toast and conflict message to all five
existing module locale files. No user-facing string or status color is hard-coded.

#### Failure, concurrency and timeout behavior

- Offer arrives before the workflow wait: persist once and consume by read-through on wait entry.
- Duplicate message/signal/event: no new case, offer, analysis, proposal, disposition or send.
- Two different offers race: one compare-and-set wins; the other records `OFFER_CONFLICT` and cannot
  overwrite the accepted snapshot.
- Facts or offer change after analysis: hashes fail, the proposal is stale, no send occurs and a new
  analysis is required.
- Two dispositions race: proposal optimistic locking plus SupplyCase compare-and-set permits one
  decision effect; the loser receives/records conflict without duplicate sends.
- Agent malformed output, guardrail stop, error or timeout: `NEEDS_ATTENTION`, no actionable
  fallback and no outbound side effect.
- Proposal rejected/edited/unauthorized: audited non-green outcome and no outbound side effect.
- Workflow restart at either wait: same instance, persisted offer/proposal/plan and replay-safe
  continuation.
- Partial delivery: retain successful anchors/evidence, retry missing effects only, and never advance
  until every required Phase 3 outbound effect has delivery evidence.

#### Implementation slices and verification

Implement in this order, keeping each slice testable:

1. Offer schemas, pure validation, typed snapshot and repository compare-and-set.
2. Correlated inbound command/subscriber path, NEEDS_ATTENTION mapping and same-instance resume.
3. Recompute service and deterministic construction/hash validation of all three plans.
4. Typed `final_resolution_advisor`, final `INVOKE_AGENT`, proposal binding and forced human wait.
5. Disposition bridge, dual authorization, decision/request-confirmation commands and idempotent
   plan-specific sends.
6. Detail read model/API/UI, ACL-aware actions, i18n and failure/retry presentation.
7. Focused unit, integration and browser suites, then the Phase 3 exit gate.

Required unit coverage includes strict offer validation (quantity/date/amount/currency), canonical
hashes, exact three-plan math/feasibility, tampered agent output rejection, event redaction and
idempotency-key stability. Required integration coverage is self-contained and includes:

- duplicate, stale, superseded, wrong-sender and cross-scope offer intake;
- atomic competing-offer and optimistic-lock races;
- uniquely correlated invalid offer linked for audit but not applied/resumed;
- early-offer read-through and restart of the SAME workflow instance;
- one final agent run/proposal with `alwaysAsk`, and no sends before disposition;
- approved A/B/C, including exactly two logical plan-C acceptance sends, exact persisted plan
  payloads, retries and no production/inventory mutations;
- rejected, edited, unauthorized, stale, malformed-agent, timeout and partial-delivery paths;
- proposal and event replay producing no duplicate decision or send.

Required Playwright coverage uses API-created fixtures and cleanup, not seed assumptions. It verifies
the three-plan comparison with the real offer, neutral/no-preselection state, infeasible state,
Caseload deep-link and disposition, non-green state after approval, retry/error/conflict UI,
keyboard operation, accessible names, narrow viewport, and light/dark semantic rendering. Keep the
live mailbox/provider scenario separately tagged; deterministic CI tests use the existing transport
seams.

Documentation-only specification validation is not the implementation gate. The implementation
must run the smallest focused suites while iterating, then `yarn generate` when discovery files
change, `yarn typecheck`, `yarn lint`, `yarn ds:check`, focused Jest and Playwright suites, and the
repository's ordered CI validation gate. Do not run `yarn db:migrate` without explicit approval.

**Phase 3 exit gate:** a real, correctly correlated Supplier 2 offer is claimed once, survives
restart, resumes the same workflow and yields exactly three deterministic, grounded plans using its
actual values. One forced Caseload disposition is required. Approving `USE_ALTERNATIVE` persists the
immutable pending plan and produces exactly two delivered, plan-matching `SUPPLY_ACCEPTANCE`
communications under replay, while production plans, production orders, stock allocations and
supplier commitments remain byte-for-byte unchanged. Every invalid, stale, unauthorized, timeout,
conflict and partial-delivery path is auditable and non-green.

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
- [ ] A confident unresolved `NEW_CASE` with a unique local-plan match creates and links exactly one visible `NEEDS_ATTENTION:MISSING_DATA` case without inventing supplier dates/commitments and without starting workflow, impact analysis or outbound communication.
- [ ] Unresolved replies to existing cases and unresolved/low-confidence/ambiguous `NEW_CASE` inputs do not mutate or link a case automatically.
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
| 2026-09-19 | Specified the minimal unresolved-inbound visibility branch: a confident `SUPPLY_PROPOSAL` selecting `NEW_CASE`, with explicit SKU and exactly one scoped local production-plan match, creates and links a `NEEDS_ATTENTION:MISSING_DATA` case shell while retaining `NEEDS_ATTENTION:UNRESOLVED_FIELDS` on the message. The branch cannot fabricate commitments/dates, emit `proposal_received`, start workflow/initial-impact, or send RFQ/outbound. Existing-case correlation is unchanged. Added T-09c, TEST-001J/K and acceptance criteria; no schema or migration is required. |
| 2026-09-19 | Phase 1 / Phase 2 closure audit. Re-ran every automated oracle: typecheck, 26 suites / 332 tests, the live-database workflow suite (TEST-002A **and** TEST-006, both passing against real Postgres), eslint, `ds:check`, and both Playwright specs (read-only 3/3, Phase 2 decision 1/1). Recorded both exit gates as **NOT met** and both phases as `IN_PROGRESS`, blocked on the same thing: nothing has ever run against a live provider — the API keys are empty, so no agent has executed for real, and no RFQ has ever been delivered through `communicationChannelsSendAsUser`. Resolved the `T-11` contradiction (the table said `TODO`, the status file said complete) by marking it `WIP` with its real evidence, since its oracle is the unmet exit gate. Named four further gaps: TEST-UI-009/010/012 have no browser evidence, TEST-006B's `REJECT`/`EDIT` branches have no test, the planned `INVOKE_AGENT`/Caseload bridge was replaced by a `WAIT_FOR_SIGNAL` step plus the app's own decision route without a spec decision, and SELECT A/B leave the instance parked at `human-sourcing-decision` with no consumer. No code, migration or `yarn generate` in this run. Record: [`../runs/2026-09-19-phase1-phase2-closure/`](../runs/2026-09-19-phase1-phase2-closure/STATE.md). |
| 2026-09-19 | Expanded Phase 3 into an implementation-ready contract grounded in the current app-owned repositories, inbound correlation, workflow `INVOKE_AGENT`, Caseload proposal events and outbound seam. Defined atomic offer persistence, strict offer validation, deterministic immutable plans, forced final disposition, dual authorization, replay-safe plan sends, UI/i18n, failure behavior, tests, Phase 2 dependency and the Phase 3 exit gate; no core or enterprise changes are required. |
| 2026-09-18 | Initial Manufacturer-only e-mail resolution draft. |
| 2026-09-18 | Added real Supplier 1 and Supplier 2 mailboxes and customer seed mapping. |
| 2026-09-18 | Reworked lifecycle after user approval: two agent analyses, two human decisions, pre-decision RFQ, three complete final plans, plan-specific confirmation join, and final mutation only after confirmation. |
| 2026-09-18 | Added `BACKLOG-001` for a local JSON file backend and documented why it is a temporary simulation layer before the real ORM/database implementation. |
| 2026-09-18 | Replaced the frozen `SupplyEnvelope` JSON contract with natural-language inbound mail plus a propose-only triage agent. Recorded the rejected alternative and its reason (it required an inter-company API that Non-goals exclude). Correlation now rests on RFC 5322 `Message-ID` / `In-Reply-To` for dedupe and causation, and on closed-set agent selection over a code-built candidate list for the first message in a chain. |
| 2026-09-19 | `T-10b` closed against the real engine. Added `__tests__/inbound-workflow-engine.db.test.ts` (TEST-002A): it registers `supply_cases.inbound-case` in the workflow code registry, calls the workflows module's own `register()` so `workflowExecutor` and `signalHandler` are the production services, and runs them over a live MikroORM Postgres connection. The suite asserts one `WorkflowInstance` per case, `workflow_instance_id` persisted on the case, the run parked `PAUSED` on `await-reply`, survival of a real restart (ORM connection and JSON store closed and rebuilt from the same durable state), the next correlated message signalling that SAME instance through to `COMPLETED`, a replay of either message creating no second instance and adding no `WorkflowEvent` row, and the instance being invisible to another tenant and refusing a foreign-scope signal with `INSTANCE_NOT_FOUND`. No production change was needed — the oracle was falsified first by disabling the subscriber's signal branch, which produced two instances. The suite skips with a printed reason when `DATABASE_URL` is unset and fails, never skips, when it is set but unreachable. `jest.config.cjs` adds `kysely` to the transform allowlist because `@mikro-orm/sql` reaches it and it ships ESM only. |
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
