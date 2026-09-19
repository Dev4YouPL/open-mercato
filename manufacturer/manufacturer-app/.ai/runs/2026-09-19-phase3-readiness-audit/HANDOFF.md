# Phase 3 implementation handoff — Manufacturer A

Status: `BLOCKED`

Ten dokument jest planem implementacji wynikającym z audytu aktualnego kodu i kontraktów. Nie jest zmianą kodu. Wszystkie ścieżki muszą pozostać app-owned w `manufacturer-app/src/modules/supply_cases`; nie zmieniać `packages/core` ani `packages/enterprise`.

## Kolejność realizacji

1. Domknąć i potwierdzić Phase 2: realny Supplier1 RFQ, delivery evidence, restart/replay i testy REJECT/EDIT. Bez tego P3 nie ma wiarygodnego anchoru.
2. P3-02: inbound offer claim, thread correlation, ten sam workflow i durable offer signal.
3. P3-03: final facts, dokładnie trzy plany, persistence/CAS/hash i invalidacja.
4. P3-04: final advisor, strict proposal, `INVOKE_AGENT`, binding i Caseload wait.
5. P3-05: disposed decision, dual authorization, selected-plan CAS, confirmation effects i delivery evidence.
6. P3-06: projection/API/UI/i18n.
7. P3-07: pełne testy i exit gates, w tym dowód braku mutacji produkcji.

Nie skracać tej kolejności przez dodanie UI przed ustaleniem stanu trwałego ani przez wywołanie istniejącego Phase4 `applyResolution`.

## P3-02 — inbound alternative offer

### Miejsca i symbole

- `src/modules/supply_cases/subscribers/inbound-message-accepted.ts`: rozdzielić ensure/start workflow, triage, offer record i zwykłą ścieżkę reply.
- `src/modules/supply_cases/commands/record-alternative-offer.ts`: zachować jako jedyny command walidujący i zapisujący ofertę; rozszerzyć wąski audit path dla linked `NEEDS_ATTENTION`.
- `src/modules/supply_cases/lib/inbound/triageContext.ts`, `lib/inbound/resolveThread.ts`: użyć `resumableMatch` i zamkniętych kandydatów, nigdy `caseId` z body jako dowodu.
- `src/modules/supply_cases/lib/resolution/offer.ts`: `resolveCurrentAlternativeOfferCorrelation` i `validateAlternativeOffer` pozostają źródłem reguł anchoru, sendera, recipienta, SKU, ilości, daty, ceny i waluty.
- `src/modules/supply_cases/data/repositories.ts`: `recordAlternativeOfferIfAbsent` pozostaje atomowym CAS; dodać scoped workflow signal helper tylko po commit.
- `src/modules/supply_cases/workflows.ts`: zmienić kontrakt reply wait tak, aby offer signal prowadził do finalnej ścieżki, a nie do bezwarunkowego `END`.

### Rekomendowany przebieg

1. `communication_channels.message.received` przechodzi przez `InboundMessageRepository.appendIfAbsent`; duplicate RFC Message-ID kończy się bez drugiego triage, offer claimu i sygnału.
2. Subscriber najpierw zapewnia jedną instancję przez istniejący `workflowInstanceId`/`correlationKey`, ale nie wysyła ogólnego reply signalu przed rozpoznaniem oferty.
3. Dla `ALTERNATIVE_SUPPLY_OFFER` command re-resolve’uje aktualny, niesuperseded RFQ po `inReplyTo`/`references`, scope, senderze i recipient email. Nie ufa samemu triage result ani body.
4. Po udanym `recordAlternativeOfferIfAbsent` emituje redagowany `supply_cases.alternative_offer.received` po persistence i sygnalizuje zapisany `workflowInstanceId`. Signal musi być idempotentny po `(workflowInstanceId, stepId, offerHash)`.
5. `already_recorded` dla tego samego source/hash nie emituje drugiego eventu, ale może ponowić idempotentny signal, aby zamknąć crash gap między commit a signalem. Inny source/hash kończy się `OFFER_CONFLICT` i bez resume.
6. Early offer zapisuje się przed wejściem workflow w wait. Wait musi wykonać read-through po scoped case i `alternativeOffer`; restart ładuje ten sam `workflowInstanceId`, a nie tworzy nowy.
7. Zwykła odpowiedź, która nie jest ofertą, zachowuje dotychczasowy generic reply/confirmation path.

### Invalid offer i audyt

Dla jednoznacznego bieżącego Supplier2 RFQ z brakującą lub invalid ofertą należy zachować link `message.caseId`/`correlationId` wyłącznie do audytu, pozostawić wynik nieautomatyczny i nie zaakceptować snapshotu. Case otrzymuje `NEEDS_ATTENTION` z `OFFER_INVALID`; nie emituje się offer-received ani workflow resume. Stale/superseded/wrong sender/cross-scope/ambiguous pozostają bez linku albo w quarantine.

Aktualny Zod nie zna `triageDisposition: NEEDS_ATTENTION`. Przed kodem zapisać decyzję, czy utrzymać rekomendowany model `triageOutcome: NEEDS_ATTENTION` + `triageDisposition: null`, czy rozszerzyć kontrakt.

## P3-03 — final facts i trzy plany

### Miejsca i symbole

- `src/modules/supply_cases/lib/resolution/plans.ts`: builder pozostaje pure; nie przyjmować planu od agenta ani klienta.
- `src/modules/supply_cases/data/types.ts`: zweryfikować/powiązać `FinalResolutionFacts`, `FinalResolutionAnalysis`, `ResolutionPlan`, `SupplyCase` i source-version fields.
- nowy app command, rekomendacja `commands/record-final-analysis.ts`: scoped load, fresh source read, build, validate, CAS, event.
- `data/repositories.ts` i JSON store: dodać atomowy zapis final analysis/plans z `expectedUpdatedAt` i source version.
- `lib/resolution/planContract.ts`: nie mieszać kontraktu P3 z Phase4 confirmation parserem; ewentualny adapter musi być jawny.

### Kontrakt CAS/hash

Command ma przyjąć tylko identyfikatory/scope/expected versions, nie caller-supplied facts ani plan body. Ładuje bieżący case, persisted offer i produkcyjny source snapshot, a następnie wywołuje `buildResolutionPlans`.

- `finalFactsHash = hashCanonical(finalFacts)`; fakty muszą obejmować wymagane quantity/date, stock, Supplier1 on-time/late, actual offer quantity/price i customer deadline oraz source version/hash.
- każdy plan ma `factsHash`, `offerHash`, `planHash`; `planHash` liczy się z całego canonical planu bez pola `planHash`, ze stabilnym porządkiem commitments/effects.
- expected case `updatedAt`, expected persisted `offerHash` i source version muszą być sprawdzone atomowo.
- ten sam facts/source/offer hash to idempotentny no-op; zmiana źródła albo wersji to stale i invalidacja starego analysis/proposal.
- odczyt, binding i apply muszą ponownie zweryfikować Zod oraz wszystkie hashe. Tampered analysis/plan/offer kończy się `ANALYSIS_FAILED`/`NEEDS_ATTENTION`, bez wysyłki.

Zapis powinien atomowo utrwalić `finalAnalysis`, dokładnie trzy `resolutionPlans` i status przejścia do oczekiwania finalnej propozycji. Event `supply_cases.final_analysis.recorded` ma być redagowany i emitowany dopiero po commit.

## P3-04 — final advisor i Caseload

### Rejestracja i envelope

- `src/modules/supply_cases/ai-agents.ts`: dodać `FINAL_RESOLUTION_ADVISOR_AGENT_ID = supply_cases.final_resolution_advisor` przez `defineAgent`.
- Agent powinien być propose-only, bez mutacyjnych tools/allowed actions, z wynikiem `kind: 'proposal'`.
- Envelope ma zawierać wyłącznie dokładnie trzy persisted option ids, rationale/confidence i canonical action `{ commandId: 'supply_cases.resolution.apply_decision', planId }`.
- Adapter result musi strict-parse envelope i porównać każdą opcję z persisted planem po `planId`, `factsHash`, `offerHash`, `planHash` i action. Unknown, missing, duplicate lub mutated option/action = fail closed.

### Workflow i binding

- `workflows.ts`: dodać stabilny final step z aktywnością `INVOKE_AGENT`, właściwym `agentId`, bounded input i `onResult: { alwaysAsk: true }`.
- Input powinien pochodzić z persisted, scoped `finalAnalysis`; nie przekazywać raw email/customer-private text.
- Workflow ma pozostać tą samą instancją i parkować na enterprise `agent_orchestrator.proposal.ready`; nie tworzyć drugiej instancji ani własnego approval endpointu.
- nowy subscriber dla `agent_orchestrator.proposal.created`: sprawdzić tenant/org, agentId, workflowInstanceId, stable step, run/proposal identity i scope, następnie jednokrotnie związać proposal z case przez CAS.
- Rekomendowane app-owned fields/binding: `finalProposalId`, `runId`, `workflowInstanceId`, `stepId`, `factsHash`, `offerHash`, `createdAt`. Duplicate same id = no-op; drugi lub niespójny proposal = attention.

## P3-05 — decyzja, wysyłka i delivery

### Disposed subscriber i authorization

- nowy `subscribers/final-proposal-disposed.ts` dla `agent_orchestrator.proposal.disposed`.
- `selectedOptionId` z eventu jest jedynym źródłem wyboru; nie inferować z rank/order ani z `proposal.ready`.
- subscriber weryfikuje proposal binding, agent/workflow/step/scope, status i optimistic version.
- Enterprise dispose permission nie wystarcza: ponownie sprawdzić `supply_cases.decisions.apply` dla `dispositionBy` przez RBAC w scope. `alwaysAsk` powinno oznaczać user UUID; `rule:threshold` nie jest akceptowalną autoryzacją tej ścieżki.
- `approved` przechodzi tylko dla dokładnie persisted, feasible planu z pasującymi facts/offer/plan hashes.
- `rejected`, `edited`, malformed, unauthorized, stale, guardrail, timeout i agent error są audytowane, nie wysyłają i pozostają non-green. Obecny disposed event nie przenosi edited payload, więc edited nie może bezpiecznie trafić do produkcyjnego planu.

### Commands i selected-plan CAS

Dodać:

- `supply_cases.resolution.apply_decision`: przyjmuje case/proposal/selectedPlan ids, hashy, expectedUpdatedAt i idempotency key; reładuje wszystkie dane i nie przyjmuje plan body.
- `supply_cases.resolution.request_confirmation`: po ponownej walidacji atomowo zapisuje `selectedResolutionPlanId`, immutable `pendingResolutionPlan`, proposal/decision identity i stan per-effect **przed** network call.

Nie wywoływać istniejącego Phase4 `supply_cases.resolution.apply_confirmed` ani `lib/resolution/applyResolution.ts`; P3 nie może zmienić production plan, order, stock ani commitment.

### Efekty i delivery evidence

Implementować dokładnie plan-specific effects:

- `ACCEPT_DELAY`: Supplier1 accept delayed + Supplier2 decline;
- `USE_STOCK`: Supplier1 amend 300 + Supplier2 decline;
- `USE_ALTERNATIVE`: Supplier1 amend 300 + Supplier2 accept 200 actual offer.

Rozszerzyć wyłącznie appowy outbound seam o deterministic per-effect idempotency key zawierający case, selected plan, effect, phase i normalized recipient. Zachować P2 default key. Dodać app-owned mapping effect → outbound correlation/evidence/status.

Subscriber `communication_channels.message.sent` dla `SUPPLY_ACCEPTANCE` zapisuje delivery evidence po RFC/link scope. Dopiero komplet evidence dla wszystkich wymaganych efektów może atomowo ustawić `WAITING_FOR_SUPPLIER_CONFIRMATIONS` i emitować `plan_acceptance.sent`. Accepted enqueue nie jest delivery. Failure/exhausted ustawia attention; partial retry wysyła tylko missing effects, zachowując już udane.

## P3-06 — read model, API, UI i i18n

### Backend

- `data/read-model.ts`: rozszerzyć list/detail schemas i `hydrateCase`/`toDetail` o summary of alternative offer, recomputed impact, final facts/hash, dokładnie trzy plany, feasibility/reasons, selected plan, proposal binding, decision/disposition i per-effect delivery status.
- Nie ujawniać raw body domyślnie; nadal respektować messages.view i tenant/org scope.
- `api/[id]/route.ts` i `api/openapi.ts`: użyć istniejącego detail GET i zaktualizować schema/OpenAPI. Nie tworzyć równoległego approval endpointu.
- operational retry/mutation ma iść przez command + guarded mutation + optimistic lock, nie przez bezpośrednią zmianę z UI.

### Frontend

- `components/SupplyCaseDetail.tsx`: dodać offer summary i neutralny comparison trzech planów, actual price/currency, commitments, stock cost basis, coverage/shortage, production/customer impact, required confirmations i reasons.
- Nie preselectować planu; infeasible disabled. Caseload link pokazać tylko dla związanego proposal i właściwej autoryzacji.
- Pokazać `NEEDS_ATTENTION`, stale/conflict, timeout, partial-send, retry, loading/error/404/permission; nie pokazywać zielonego resolved przed Phase4.
- Użyć istniejących `apiCall`, `readApiResultOrThrow`, `LoadingMessage`, `ErrorMessage`, `useGuardedMutation`, optimistic lock, semantic status tokens i istniejącego focus/keyboard/a11y pattern.

### Locale

Uzupełnić wszystkie istniejące locale `de/en/es/ko/pl` o final statuses, offer/plan labels, feasibility reasons, disposition/delivery states, stale/conflict/attention/partial/retry errors, Caseload link, keyboard and accessibility labels. Nie dodawać hard-coded user-facing strings ani Tailwind status colors.

## P3-07 — test plan

### Unit

- offer schema: quantity/date/amount/currency/SKU, sender/recipient, current vs superseded RFQ, late valid offer, scope;
- canonical offer/facts/plan hashes, stable ordering, actual price, tampered persisted values;
- final-analysis CAS: same-hash replay, stale case, changed production source version, malformed stored analysis, duplicate events;
- strict final proposal envelope, exact plan echo, unknown/missing/duplicate/mutated action, no fallback;
- deterministic per-effect keys, redacted events and no raw body/full plan leakage.

### DB/workflow

- real workflow: offer before wait, offer after wait, restart, same instance, read-through, replay;
- exactly one final `INVOKE_AGENT`/proposal with `alwaysAsk`, proposal.created/disposed replay;
- scoped signals and proposal events across tenants; no cross-tenant read or resume;
- durable pending plan and effect state across process restart.

### Integration

- duplicate RFC Message-ID, invalid unique current RFQ audit link, stale/superseded/wrong sender/cross-scope quarantine;
- competing offers: one CAS winner, one conflict, no duplicate resume/effects;
- final analysis stale/tampered → no send; one proposal; no send before disposition;
- A/B/C exact effect recipients/decisions/commitments, with plan C exactly two logical messages;
- approved/rejected/edited/unauthorized/stale/malformed/guardrail/timeout/partial delivery;
- proposal/event replay and retry produce no duplicates; retry only missing effect;
- two scopes with same-shaped identifiers prove tenant/org isolation;
- before/after byte-level snapshots of production plan, production order, stock and commitment fields for every P3 path, including C and replay. Assert no call to Phase4 apply command.

### Browser

Add API-created fixture + cleanup Playwright coverage in existing integration setup, without seeded/demo assumptions:

- actual three-plan comparison and offer values;
- neutral no-preselection, infeasible disabled, plan reasons and Caseload deep link;
- non-green waiting confirmations, retry/error/conflict/timeout/partial states;
- loading/error/404/permission, narrow layout, light/dark, keyboard `Ctrl/Cmd+Enter` and `Escape`, accessible names/focus;
- locale smoke for all five locales.

## Potential collisions with Phase 2 and Phase 4

- Phase 2 currently owns initial sourcing, RFQ delivery and generic reply wait. Do not remove or reinterpret its signals until live delivery and restart are green.
- `supply_cases.sourcing.apply_decision` and `requestAlternativeSupplier` already use optimistic state transitions. P3 offer signal must be sequenced after their delivery evidence and must not create a second workflow.
- Phase4 `commands/resolution.ts`, `lib/resolution/confirmationJoin.ts`, `lib/resolution/applyResolution.ts` use the same resolution domain and mutate production. P3 names and schemas must remain distinct; `pendingResolutionPlan` currently has a Phase4 contract that cannot be silently reused for P3 without an explicit adapter.
- `sendSupplierMessage` and `OutboundCorrelation` are append-only/P2-oriented. Extend app-owned behavior with additive optional fields or a separate projection; do not break P2 idempotency.
- Current dirty worktree contains unrelated Phase2/Phase4 and test changes. Implementation must isolate P3 edits and not “fix” unrelated type/test failures as part of this slice.

## Exit gates

1. Phase 2 is green with live provider evidence, exactly one RFQ anchor and restart/replay proof.
2. A real current Supplier2 offer is claimed once, linked to the same workflow instance, and works before/after wait and after restart.
3. Final facts and exactly three deterministic plans persist with actual values and verifiable hashes.
4. One `final_resolution_advisor` proposal is created with strict envelope and `alwaysAsk`; Caseload selection uses dual authorization and selectedOptionId.
5. Approved plan is persisted immutably before send; plan C produces exactly two plan-matching, delivery-evidenced `SUPPLY_ACCEPTANCE` messages; replay/partial retry is safe.
6. Production plans, orders, stock and commitments are byte-for-byte unchanged throughout P3.
7. Every invalid/stale/tampered/conflict/unauthorized/rejected/edited/timeout/partial path is auditable and non-green.
8. Generate, package build, typecheck, lint, focused unit/DB/integration/browser tests and the repository’s configured full validation sequence pass. `db:migrate` remains outside this plan unless separately approved.

## Implementation handoff status

`BLOCKED` — start with Phase 2 closure and the five contract decisions in `STATE.md`; after those are recorded, implement slices in the order above.
