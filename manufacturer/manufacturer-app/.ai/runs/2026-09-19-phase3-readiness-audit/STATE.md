# Phase 3 readiness audit — Manufacturer A

Status: `BLOCKED`

Audited: 2026-09-19

Zakres audytu obejmował instrukcje repozytorium, specyfikację workflow dostawcy, stan i handoff wcześniejszego runu, aktualny workflow, komendy sourcingu i ofert, resolution, agentów, subscriberów, read model, API, UI oraz istniejące testy. Nie zmieniono kodu, specyfikacji głównej, `packages/core`, `packages/enterprise` ani nie uruchomiono `db:migrate`.

## Werdykt

Repozytorium nie jest gotowe do implementacji Phase 3 bez wcześniejszego domknięcia Phase 2 i zapisania kilku decyzji kontraktowych. Najważniejszy blocker jest funkcjonalny: obecny `supply_cases.inbound-case` kończy się po ogólnym sygnale odpowiedzi i nie zawiera kroku `INVOKE_AGENT`/Caseload dla finalnej analizy. P3 nie może wiarygodnie wejść na ten workflow, dopóki nie będzie gwarancji, że Supplier2 odpowiada do tego samego, rzeczywiście wysłanego RFQ i tej samej `WorkflowInstance`.

P3 ma już użyteczne fundamenty: ścisły snapshot oferty z hashem i CAS, resolver bieżącego RFQ/threadu, deterministyczny builder dokładnie trzech planów oraz statusy i ACL potrzebne dla docelowej ścieżki. Brakuje jednak trwałego spięcia tych elementów z inboundem, workflow, finalnym agentem, propozycją, decyzją Caseload, wysyłką i read modelem.

## Najważniejsze blokery wejścia

1. `manufacturer-app/src/modules/supply_cases/workflows.ts` ma tylko start, initial-impact wait, sourcing wait, delivery wait, reply wait i `END`. Nie ma aktywności finalnej analizy ani `INVOKE_AGENT` z `onResult: { alwaysAsk: true }`.
2. `manufacturer-app/src/modules/supply_cases/subscribers/inbound-message-accepted.ts` wysyła ogólny sygnał odpowiedzi przed zapisaniem oferty. Aktualny sygnał prowadzi do zakończenia instancji; nie ma read-through dla oferty, sygnału po commit ani obsługi early offer.
3. `commands/record-alternative-offer.ts` zapisuje ofertę lub redagowany event, ale nie sygnalizuje `WorkflowInstance`, a ścieżka invalid offer nie daje wymaganego audytowego linku do unikalnego bieżącego RFQ.
4. `lib/resolution/plans.ts` jest czystym builderem. Nie ma commandu i CAS dla trwałego `finalAnalysis`/trzech planów ani invalidacji przy zmianie źródłowych faktów.
5. `ai-agents.ts` rejestruje tylko inbound triage i initial-impact advisor. Nie ma `final_resolution_advisor`, strict proposal envelope ani bindingu propozycji do case.
6. Nie ma app subscriberów dla `agent_orchestrator.proposal.created` i `agent_orchestrator.proposal.disposed`, dual authorization ani komend `resolution.apply_decision`/`resolution.request_confirmation`.
7. `sendSupplierMessage` używa klucza case + phase + recipient. To za mało dla kilku efektów planu i retry częściowej wysyłki. `OutboundCorrelation` nie przechowuje plan/effect/delivery evidence.
8. `data/read-model.ts`, istniejące API i `SupplyCaseDetail.tsx` pokazują głównie initial analysis. Nie pokazują oferty, final facts, trzech planów, propozycji, delivery evidence ani stanów stale/partial/retry.
9. Testy pokrywają builder i podstawowy CAS, ale nie obejmują pełnego P3, realnego restartu workflow z ofertą, Caseload, decyzji, dostaw, tenant isolation ani dowodu braku mutacji danych produkcyjnych.

## Stan slice’ów

| Slice | Stan | Co istnieje | Czego brakuje |
|---|---|---|---|
| P3-02 | PARTIAL | triage, thread resolver, strict offer validator, offer CAS | subscriber → offer command → ten sam workflow, early/restart/replay, invalid audit link |
| P3-03 | PARTIAL | `buildResolutionPlans`, hashy, 3 planów, actual offer price | durable final facts/plans, CAS/version/source hash, stale/tamper rejection |
| P3-04 | BLOCKED | agent bridge i enterprise proposal events | final agent, envelope, workflow activity, proposal binding, Caseload wait |
| P3-05 | BLOCKED | P2 outbound seam i Phase4 confirmation code | disposed subscriber, dual auth, selected-plan CAS, plan-specific effects, delivery evidence |
| P3-06 | BLOCKED | istniejący detail API/UI i i18n bazowe | final comparison, proposal/delivery states, error/retry UX, locale keys |
| P3-07 | BLOCKED | 8 testów resolution i podstawowe testy P2 | DB/integration/browser/race/replay/nonmutation coverage |

## Kontrakty, które trzeba zapisać przed implementacją

- Invalid offer: obecny `InboundMessage.triageDisposition` nie ma wartości `NEEDS_ATTENTION`. Rekomendacja: zachować `triageDisposition: null`, ustawić `triageOutcome: NEEDS_ATTENTION`, zachować `caseId` i `correlationId` wyłącznie dla jednoznacznego bieżącego RFQ oraz użyć `failureReason: NEEDS_ATTENTION:OFFER_INVALID`. Jeśli produkt wymaga literalnego disposition, potrzebna jest osobna decyzja o zmianie schematu.
- Stale detection: `FinalResolutionFacts` nie zawiera wersji źródła production planu. Należy dodać `productionPlanUpdatedAt` albo canonical source snapshot hash, inaczej zmiana wersji o tych samych wartościach może nie unieważnić planu.
- Proposal binding: `SupplyCase` nie ma `finalProposalId` ani kompletnego stanu bindingu. Rekomendowany jest app-owned binding z `finalProposalId`, `runId`, `workflowInstanceId`, `stepId`, `factsHash`, `offerHash`, `createdAt`, albo osobny rekord bindingu.
- Delivery state: same `OutboundCorrelation` nie wystarcza do rozróżnienia efektów i evidence. Potrzebny jest app-owned effect/delivery projection lub rozszerzenie appowego rekordu o `planId`, `effectId`, status i evidence message id.
- Workflow input: bieżący context ma tylko `caseId`, `inboundMessageId`, `correlationId`. Trzeba ustalić, czy finalny krok otrzyma bounded snapshot przez sygnał/context, czy aktywność odczyta `finalAnalysis` z repozytorium. Rekomendacja: aktywność odczytuje scoped persisted analysis, a do agenta przekazuje wyłącznie bounded snapshot.
- Plan-specific idempotency: P3 musi dodać klucz zawierający `caseId`, `selectedPlanId`, `effectId`, `SUPPLY_ACCEPTANCE` i znormalizowanego odbiorcę, zachowując dotychczasowy klucz P2 dla RFQ.

## Zależności

`Phase 2 green` → `P3-02` → `P3-03` → `P3-04` → `P3-05` → `P3-06` → `P3-07`.

P3-02 dostarcza trwałą ofertę i ten sam workflow. P3-03 zapisuje dane, na których może bezpiecznie pracować agent. P3-04 tworzy jedną propozycję i parkowanie Caseload. P3-05 jest jedyną ścieżką od autoryzowanej decyzji do plan-specific outbound effects. P3-06 może być zbudowany wcześniej jako read-only projection, ale jego finalne stany zależą od kontraktów P3-03/P3-05. P3-07 powinien rosnąć slice po slice, a nie dopiero na końcu.

## Dowody i ograniczenia audytu

Istniejące testy unit obejmują ścisłą walidację oferty, deterministyczne trzy plany i atomowy CAS. Historyczny zapis runu wskazuje też focused eslint pass, ale nie wykonywałem ponownie gate’ów. Historyczny `typecheck` miał błędy w dirty worktree, w tym nieobsługiwane właściwości workflow i import testowy nieeksportowanego typu. Phase 2 closure audit wskazuje brak live provider run, realnego RFQ delivery oraz pełnego testu REJECT/EDIT. Te wyniki traktuję jako sygnały do naprawy, nie jako nową walidację tego audytu.

Po implementacji należy uruchomić w ustalonej kolejności lokalnej (brak dowodu działającego compose app): `yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn lint`, testy focused, testy DB/integration/browser, a na końcu pełną listę z `.ai/agentic.config.json`. `yarn db:migrate` nie jest częścią tego audytu ani planu bez osobnej zgody.

## Status końcowy

`BLOCKED`

Powód: nieosiągnięty P2 entry gate oraz brak rozstrzygniętych kontraktów invalid audit link, source-version stale detection, proposal binding i per-effect delivery state. Handoff implementacyjny znajduje się w `HANDOFF.md`.
