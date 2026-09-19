# Human-readable activity stream and supply-case timeline

**Date**: 2026-09-19  
**Status**: Ready for implementation  
**Owner role**: supply operations / operator

## TLDR

Moduł aplikacyjny `supply_cases` otrzyma trwały, tenant- i organization-scoped strumień aktywności biznesowej, który tłumaczy istniejące fakty e-mail, agentów, workflow i spraw na komunikaty zrozumiałe dla operatora: „Otrzymano nowy e-mail”, „Agent analizuje wiadomość”, „Rozpoznano dostawcę”, „Wykryto ofertę 300 szt. w środę i 200 szt. w piątek” oraz „Brakuje 200 szt. na wymagany termin”. Ten sam read model zasili kompaktowy globalny podgląd „Co się dzieje” na `/backend/supply-cases` oraz pełny timeline na `/backend/supply-cases/{id}`.

DOM Event Bridge/SSE będzie wyłącznie sygnałem do odświeżenia autoryzowanego API, nigdy źródłem historii ani kanałem dla treści wiadomości. MVP pozostaje w `supply_cases`, wykorzystuje obecny JSON-backed `SupplyCasesStore`, istniejące eventy, `useAppEvent`, list/detail i agent-orchestrator; nie tworzy ogólnoplatformowego audytu ani drugiego trace viewera.

## Resolved assumptions (autonomous defaults)

| ID | Chosen answer | Rationale |
|---|---|---|
| Q1 | MVP należy do aplikacyjnego modułu `supply_cases`, nie do nowego modułu platformowego. | Najmniejszy odwracalny zakres; nie ustanawia przedwcześnie publicznego kontraktu aktywności dla wszystkich modułów. |
| Q2 | Globalny podgląd obejmuje wyłącznie supply operations i jest panelem na `/backend/supply-cases`; nie powstaje osobna aplikacja, inbox ani nowa pozycja nawigacji. | Globalny preview i timeline sprawy są dwoma zapytaniami do jednego read modelu, a nie niezależnymi produktami. |
| Q3 | Activity entries są append-only. Start, rezultat, failure i retry to osobne wpisy połączone `groupKey`; wpisów nie edytuje się „w miejscu”. | Zapewnia audytowalność, idempotencję i czytelne retry bez optimistic locking dla logu. |
| Q4 | W MVP szczegóły techniczne są deep-linkiem do istniejącego agent-orchestrator execution/trace UI, gdy istnieje bezpieczna referencja i użytkownik ma `agent_orchestrator.trace.view`; inline tool calls są poza zakresem. | Reuse istniejącego ACL, redakcji i trace UI zamiast kopiowania danych technicznych do `supply_cases`. |
| Q5 | Nie zapisujemy w aktywności tematu ani body e-maila, pełnego adresu, promptu, outputu modelu, tool arguments ani failure stack. | Pozwala utrzymać standardowy feed bez PII i sekretów; dowody pozostają u właścicieli i są pobierane osobno z właściwym ACL. |
| Q6 | MVP używa obecnego file-backed store i nowej kolekcji `activity-entries.json`; produkcyjna migracja ORM pozostaje za tym samym repozytorium i nie jest częścią tej specyfikacji. | Obecny `supply_cases` celowo działa na symulacyjnym JSON backendzie; spec nie uruchamia ani nie projektuje przedwczesnej migracji DB. |

## Problem Statement

Istniejący detail sprawy składa timeline ad hoc z `SupplyCase`, `InboundMessage` i `OutboundCorrelation`. Użytkownik widzi ogólne wpisy „Wiadomość przychodząca”, „Utworzono sprawę” i „Zaktualizowano sprawę”, ale nie rozumie przebiegu automatyzacji: kiedy agent zaczął pracę, co rozpoznał, jakie fakty wyciągnął, kiedy wyliczono niedobór, na co system czeka ani dlaczego proces stanął.

Samo nasłuchiwanie SSE nie rozwiązuje problemu. Event może nadejść, gdy karta jest zamknięta, połączenie może się odnowić bez replay, a część technicznych eventów nie zawiera bezpiecznej korelacji z case. Surowe event IDs, statusy workflow, trace spans i tool calls są natomiast zbyt techniczne i mogą zawierać dane, których zwykły supply viewer nie powinien zobaczyć.

Potrzebne są dwie perspektywy:

1. organization-wide preview ostatnich istotnych aktywności supply operations, aby operator widział przepływ pracy bez otwierania każdej sprawy;
2. pełny kontekstowy timeline jednej sprawy, który zachowuje historię po reloadzie i łączy kroki e-mail → agent → case → decyzja → potwierdzenia.

Oba widoki muszą opierać się na jednym trwałym, bezpiecznym read modelu. Inaczej komunikaty, kolejność i uprawnienia zaczną się rozjeżdżać.

## Overview and Success Measures

- **Primary outcome:** operator rozumie aktualny etap i ostatnie zakończone kroki sprawy bez czytania raw logs, JSON ani trace’ów.
- **Leading indicators:** 100% przyjętych wiadomości supply ma wpis intake; każde uruchomienie obsługiwanego agenta ma start oraz terminal success/failure; każdy wykryty shortage ma liczbowy, deterministyczny wpis; wpis pojawia się w otwartym UI po evencie bez ręcznego reloadu.
- **Reliability target:** replay tego samego source eventu nie tworzy drugiego wpisu; reload/reconnect nie usuwa historii; awaria projektora nie cofa domenowego zapisu i kończy się retry persistent subscriber.
- **Performance target:** pierwszy globalny page ≤20 wpisów, case timeline ≤50 wpisów; limit API ≤100; jeden refetch na co najmniej 500 ms burst eventów.
- **Baseline:** istnieje prosty `timeline` w detail response, lecz nie ma trwałych wpisów aktywności ani globalnego preview.
- **Market / product reference:** przyjmujemy wzorzec Odoo Chatter, gdzie record timeline pokazuje trwałe, opisowe zmiany i wiadomości związane z rekordem ([Odoo Chatter](https://www.odoo.com/documentation/18.0/applications/productivity/discuss/chatter.html)). Z Sentry przyjmujemy progressive disclosure: activity jest chronologiczna i ludzka, a breadcrumbs/trace są diagnostycznym szczegółem ([Sentry Issue Details](https://docs.sentry.io/product/issues/issue-details/)). Odrzucamy pokazywanie historii wykonania workflow jako głównej narracji; durability workflow, jak w Temporal, jest mechanizmem wykonawczym, nie językiem produktu ([Temporal docs](https://docs.temporal.io/)).

## Goals

- **REQ-001 — Business narration:** operator widzi lokalizowane komunikaty biznesowe zamiast event IDs, command IDs i statusów runtime.
- **REQ-002 — Durable projection:** wszystkie wpisy są trwałe, append-only, idempotentne i odtwarzalne po reloadzie.
- **REQ-003 — Correlation:** intake, analiza agenta, case, workflow i dowody są korelowane bez zgadywania „najnowszego runu”.
- **REQ-004 — Contextual timeline:** detail sprawy pokazuje pełną chronologię, failure/retry/stale states i dozwolone evidence/technical links.
- **REQ-005 — Global preview:** lista spraw pokazuje organization-wide „Co się dzieje” z linkiem do właściwej sprawy, bez mieszania organizacji.
- **REQ-006 — Live refresh:** nowe wpisy odświeżają oba widoki przez istniejący DOM Event Bridge, z koalescencją i recovery po reconnect/focus.
- **REQ-007 — Privacy and access:** standardowy feed nie kopiuje PII ani raw agent/trace data; scope, ACL i redakcja są egzekwowane po stronie API.
- **REQ-008 — Failure honesty:** started, completed, failed, retry i stale mają jednoznaczną semantykę; brak terminalnego wpisu nie jest prezentowany jako sukces.

## Non-goals

- Ogólnoplatformowy activity/audit module dla wszystkich Open Mercato modules.
- Zastępowanie logów technicznych, telemetry, `AgentSpan`, `AgentToolCall`, workflow history lub agent-orchestrator traces.
- Inline viewer promptów, model output, tool arguments/results, tokenów, kosztów lub stack traces.
- Notification center, unread counters, per-user read state, subscriptions, desktop notifications lub email digests.
- Ręczne dodawanie komentarzy/notes, @mentions, attachments lub follow-up tasks.
- Portal/customer-facing activity stream.
- Wyszukiwanie full-text i zaawansowane filtry feedu w MVP.
- Backfill całej historycznej osi z niejednoznacznych `updatedAt`; MVP zaczyna wiarygodną projekcję od aktywacji i może bezpiecznie zseedować tylko jednoznaczne istniejące fakty.
- Nowa migracja ORM albo użycie JSON backendu dla produkcyjnych danych wrażliwych.

## Proposed Solution

W `supply_cases` powstaje append-only `SupplyActivityEntry` za interfejsem obecnego `SupplyCasesStore`. Persistent subscribers mapują istniejące eventy oraz trzy addytywne rodziny faktów (`analysis.*`, `case.stage_changed`, `case.risk_detected`) na stabilne `kind`, `titleKey`, `detailKey` i bezpieczne parametry. Projekcja zapisuje wpis przez atomiczne `appendIfAbsent(scope, dedupeKey, entry)` i emituje mały event `supply_cases.activity.recorded` tylko po pierwszym zapisie.

UI nigdy nie renderuje treści z event payloadu SSE. `useAppEvent('supply_cases.activity.recorded', ...)` koalescuje sygnały i ponownie pobiera autoryzowany read model. Globalny preview wywołuje endpoint bez `caseId`; timeline detailu wywołuje ten sam endpoint z `caseId`.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| App-owned projection w `supply_cases` | Jedna domena, istniejący store, UI i ACL | Generic `activity` platform module | Przedwczesny publiczny kontrakt i znacznie większy blast radius |
| Trwały read model | Reload/reconnect i audit wymagają historii | Render bezpośrednio z SSE | Brak replay i utrata wpisów |
| Event → translation key + typed params | i18n, testowalność, brak model-generated prose | Zapisywanie gotowego tekstu | Utrwala locale, utrudnia korekty i może kopiować PII |
| Append-only start/result/failure | Uczciwa historia i prosta idempotencja | Aktualizowanie jednego „running” row | Traci próby i wymaga concurrency/locking |
| SSE jako invalidation hint | ACL i prawda pozostają w API | Pełny ActivityEntry w SSE | Payload org-wide, 4 KB cap, ryzyko ujawnienia danych |
| Jeden cursor API | Jedna semantyka dla global/detail | Osobne endpointy i mappingi | Duplikacja i drift |
| Technical deep-link | Reuse agent-orchestrator | Kopia spans/tool calls | Łamie ownership, ACL i redakcję |
| Bez cache w MVP | Małe strony i wymóg świeżości | Cache read modelu | Invalidation zwiększa złożoność bez mierzalnej potrzeby |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Activity fact | Jeden zakończony lub rozpoczęty biznesowy krok, nie linia logu | source event + projector mapping | Nieznany event jest ignorowany i raportowany technicznie, bez generycznego tekstu dla użytkownika |
| Activity entry | Niezmienny, scoped zapis jednego activity fact | `SupplyActivityEntry` | Duplicate `dedupeKey` zwraca istniejący wpis bez kolejnej emisji |
| `kind` | Stabilny machine enum sterujący ikoną, translatorami i grupowaniem | `data/activity.ts` | Nieznany kind odrzuca schema przed zapisem |
| `groupKey` | Łączy start/terminal/retry tej samej logicznej operacji | case/message + phase + operation/attempt | Brak groupKey nie blokuje wpisu, ale wyłącza grupowanie |
| `dedupeKey` | Deterministyczna unikalność jednego faktu w tenant+org | source event identity + milestone | Replay jest no-op |
| Global preview | Ostatnie aktywności ze wszystkich spraw bieżącej organizacji | activity API bez `caseId` | Brak org scope daje 400; nigdy tenant-wide fallback |
| Contextual timeline | Wszystkie dostępne wpisy jednego case w bieżącym scope | activity API z `caseId` | Case z innej org zachowuje się jak 404/empty bez ujawnienia istnienia |
| Stale activity | `started` bez terminalnego wpisu w tej samej grupie po progu | read-model derivation, nie mutacja wpisu | Pokazuje „trwa dłużej niż zwykle”, nigdy „failed” bez faktu failure |
| Evidence | Opaque ref do wiadomości/sprawy/workflow; bez body w entry | owning record | Ref jest ukryty, jeśli użytkownik nie ma odpowiedniego feature |
| Technical detail | Link do istniejącego execution/trace UI | agent-orchestrator | Brak bezpiecznej referencji lub ACL = brak linku, nie błąd feedu |

### Canonical activity kinds

`email_received`, `analysis_started`, `sender_classified`, `supplier_offer_extracted`, `analysis_completed`, `risk_detected`, `case_created`, `stage_changed`, `waiting_external`, `decision_recorded`, `confirmation_recorded`, `case_resolved`, `operation_failed`, `retry_started`.

`status` przyjmuje wyłącznie `info | running | success | warning | error | waiting`. Status służy prezentacji; nie zastępuje statusu domenowego case.

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Supply viewer | Business title/detail bez message content i trace links | trusted tenant + selected organization | `supply_cases.view` |
| Message viewer | Jak wyżej plus evidence link do istniejącej, zredagowanej sekcji wiadomości | ten sam scope | `supply_cases.view`, `supply_cases.view_messages` |
| Trace viewer | Jak supply viewer plus technical deep-link | ten sam scope; agent-orchestrator ponownie autoryzuje target | `supply_cases.view`, `agent_orchestrator.trace.view` |
| System projector | Append activity po persistent event | trusted subscriber context only | system actor; brak user role |

`tenantId` i `organizationId` są pobierane z zaufanego event/subscriber context albo request auth context. Payload może zawierać kopię scope dla zgodności istniejących eventów, ale projector nie używa jej, gdy trusted context istnieje. Brak obu zaufanych wartości kończy projekcję fail-closed. Globalny endpoint wymaga wybranej organizacji; „all organizations” nie agreguje feedu w MVP.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Owner | Integration seam | Why |
|---|---|---|---|---|
| Supply lifecycle and case status | reuse | `supply_cases` | current commands/store/events | Jedno źródło prawdy |
| Activity projection | app-own | `supply_cases` | `SupplyCasesStore.activities` | Read model specyficzny dla tej narracji |
| Email intake | reuse | `communication_channels` + current supply subscriber | `supply_cases.inbound_message.accepted` | Feed nie czyta provider payloadu |
| Agent execution | reuse | `agent_orchestrator` | current `agentRuntime.run`, workflow/run refs | Agent data nie są duplikowane |
| Live transport | reuse | `events` DOM Event Bridge | `clientBroadcast`, `useAppEvent` | Brak nowego WebSocket/polling systemu |
| Existing case UI | extend | `supply_cases` | `SupplyCasesTable`, `SupplyCaseDetail` | Najmniejsza liczba nowych surfaces |
| Message evidence | reuse | existing supply detail projection | opaque inbound message ref + `view_messages` | Ownership i redakcja pozostają bez zmian |
| Trace/tool details | reuse | `agent_orchestrator` | deep-link only | Istniejące `trace.view` i `TraceView` |

## Architecture and Data Flow

```text
communication_channels.message.received
  -> existing supply intake gate
  -> supply_cases.inbound_message.accepted (persistent)
  -> activity subscriber -> appendIfAbsent(email_received)

supply command / agent wrapper
  -> domain write or agent invocation
  -> supply_cases.analysis.* / case.stage_changed / case.risk_detected
  -> persistent activity subscriber
  -> SupplyActivityEntry (append-only JSON collection)
  -> supply_cases.activity.recorded (clientBroadcast, ids only)
  -> useAppEvent -> coalesced GET /api/supply_cases/activity
  -> global preview OR case timeline
```

- **Module boundary:** wszystkie nowe zapisy należą do `supply_cases`. Nie ma direct ORM relation ani importu encji z `communication_channels`/`agent_orchestrator`.
- **Side-effect boundary:** cross-module fakty docierają eventami. Wewnątrz modułu command call sites emitują addytywne fakty po udanym commit-point albo przed/po agent invocation; projector nie zmienia case.
- **Failure isolation:** domain command nie czeka na activity projection. Persistent subscriber retry naprawia opóźnioną projekcję; activity failure nie cofa e-mail intake, analizy ani resolution.
- **Read boundary:** UI dostaje wyłącznie gotowe business activities. Nie mapuje event ID → tekst i nie wylicza shortage.
- **SSE boundary:** `activity.recorded` jest derived read-model echo z `excludeFromTriggers: true`, aby nigdy nie uruchamiał workflow ani własnego projectora.

### Normalized source event envelope

Każdy projector adapter normalizuje source event do wewnętrznego, niepublicznego envelope przed mappingiem:

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | literal `1` | Reject other versions |
| `source.eventId` | string | Exact declared event ID |
| `source.occurrenceId` | string | Stable source record/event occurrence identity |
| `source.occurredAt` | ISO timestamp | Business occurrence time, fallback to subscriber receive time only when source lacks a timestamp |
| `scope.tenantId` | string | Trusted context only |
| `scope.organizationId` | string | Trusted context only |
| `correlation.caseId` | string/null | Scoped lookup only; never global lookup by id |
| `correlation.inboundMessageId` | string/null | Opaque evidence reference |
| `correlation.workflowInstanceId` | string/null | Technical deep-link candidate |
| `correlation.agentRunId` | string/null | Set only when delivered authoritatively; never inferred by timestamp |
| `correlation.operationId` | string | Idempotent logical attempt identity |
| `fact.kind` | canonical kind enum | Mapping input |
| `fact.status` | activity status enum | Mapping input |
| `fact.values` | strict typed object | Quantity/date/SKU/status only; no arbitrary model text |
| `privacy.classification` | `business_safe | restricted_ref` | Controls response projection, not client-side hiding |

Envelope jest walidowany Zod przed projekcją. Nie jest zapisywany w całości; `SupplyActivityEntry` przechowuje tylko pola wymagane przez business read model.

### Source-to-business mapping

| Source fact | Dedupe key pattern | Business activity | Safe parameters | Correlation |
|---|---|---|---|---|
| `supply_cases.inbound_message.accepted` | `inbound:{inboundMessageId}:accepted` | `email_received` / `supply_cases.activity.emailReceived` | receivedAt, supplier role if known | inbound message; case nullable |
| `supply_cases.analysis.started` kind `inbound_triage` | `analysis:{operationId}:started` | `analysis_started` / `...agentCheckingEmail` | agent label key | inbound message; case nullable |
| `supply_cases.analysis.completed` kind `inbound_triage` + accepted apply | `analysis:{operationId}:classified` | `sender_classified` / `...senderClassifiedAsSupplier` | confidence bucket optional, never raw rationale | message + case if created |
| `supply_cases.case.proposal_received` | `case:{caseId}:proposal:{inboundMessageId}` | `supplier_offer_extracted` | SKU, commitment quantities/dates from validated extraction | case + message |
| same event with `caseCreated=true` | `case:{caseId}:created` | `case_created` | correlationId | case |
| `supply_cases.analysis.started` kind `initial_impact` | `analysis:{operationId}:started` | `analysis_started` / `...agentCheckingImpact` | case correlation label | case + workflow |
| `supply_cases.analysis.completed` kind `initial_impact` | `analysis:{operationId}:completed` | `analysis_completed` / `...offerComparedWithDemand` | required, coveredOnTime, missing | case + workflow |
| `supply_cases.case.risk_detected` | `case:{caseId}:risk:{factsHash}` | `risk_detected` | missingQuantity, requiredDate, riskStatus | case |
| `supply_cases.case.stage_changed` | `case:{caseId}:stage:{toStatus}:{version}` | localized `stage_changed` or `waiting_external` | only mapped status-specific values | case + workflow |
| `supply_cases.alternative_offer.received` | `case:{caseId}:alternative:{offerHash}` | `supplier_offer_extracted` | offered quantity/date/price only if business-safe contract exposes it | case + message |
| `supply_cases.case.confirmation_recorded` | `case:{caseId}:confirmation:{inboundMessageId}` | `confirmation_recorded` | supplier role, verdict, planned quantity/date | case + message |
| `supply_cases.case.resolved` | `case:{caseId}:resolved:{planId}` | `case_resolved` | coveredQuantity, requiredQuantity, riskStatus | case |
| `supply_cases.analysis.failed` or attention transition | `operation:{operationId}:failed:{reasonCode}` | `operation_failed` | localized reason code, retryability | case/message/workflow |
| repeated start with new operationId | `analysis:{operationId}:started` | `retry_started` when prior group failed/staled | attempt number | same `groupKey` |

Mapping is allowlist-based. Raw `errorMessage`, model output, agent rationale, message body, subject and email address never become `params`. If a source does not provide enough validated values for a specific message, projector emits a less detailed but truthful key; it never fabricates numbers.

### Correlation rules

1. Inbound activity starts with `inboundMessageId`; before case creation `caseId=null` and entry appears in global preview.
2. When triage authoritatively links the message, wcześniejszy immutable intake nie jest przepisywany. Case-scoped read service najpierw pobiera w jednym scoped query identyfikatory inbound messages należących do case, a następnie dołącza entries spełniające `caseId = requestedCaseId` **lub** `evidenceType = inbound_message AND evidenceId IN scopedCaseMessageIds`. Dzięki temu detail zawiera pierwotne „Otrzymano nowy e-mail”, global preview może po korelacji wyświetlić link do case, a storage pozostaje append-only. Brak message linku pozostawia intake global-only.
3. Case activity carries `caseId` and stored display snapshot `caseCorrelationId`; reads still verify the case belongs to the request scope.
4. Initial/final agent calls pass existing `workflowInstanceId`, stable phase `stepId` and idempotent `invocationId` through the supported `AgentRunCtx` where available. No lookup uses „latest run after timestamp”.
5. `agentRunId` remains nullable because current `agentRuntime.run()` returns only `AgentResult`. MVP technical link may target `/backend/processes/{workflowInstanceId}`. Exact `/backend/traces/{runId}` is used only when an authoritative run ID exists in a future/current call site.
6. Triage occurs before case workflow creation; it has no fabricated workflow/run reference. Its business entries remain valid without technical deep-link.

## Data Models

### `SupplyActivityEntry` (file-backed read model)

| Field | Type / nullability | Scope / index semantics | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | stable tie-break | no | immutable |
| `tenantId` | string, required | first scope component | no | trusted context only |
| `organizationId` | string, required | second scope component | no | trusted context only |
| `caseId` | string/null | scoped case filter | opaque ref | immutable; no ORM relation |
| `caseCorrelationId` | string/null | display snapshot only | low sensitivity | immutable snapshot |
| `kind` | canonical enum | filter-ready future field | no | strict Zod enum |
| `status` | activity status enum | display/filter-ready | no | strict Zod enum |
| `actorType` | `system | agent | user | external` | — | no | no actor display name copied |
| `actorRef` | string/null | agent id or user id by value | restricted ref | omitted from standard API unless needed and permitted |
| `titleKey` | string, required | — | no | allowlisted namespace `supply_cases.activity.*` |
| `detailKey` | string/null | — | no | allowlisted namespace |
| `params` | strict JSON object | never queried | business-safe only | kind-specific Zod schema; no arbitrary strings |
| `occurredAt` | ISO timestamp | primary descending order | no | source occurrence time |
| `recordedAt` | ISO timestamp | projection latency evidence | no | store clock |
| `dedupeKey` | string, required | unique within tenant+org | no | deterministic, max bounded length |
| `groupKey` | string/null | lifecycle grouping | no | deterministic logical operation |
| `sourceEventId` | string, required | diagnostics | no | declared event ID |
| `sourceOccurrenceId` | string, required | diagnostics/dedupe | opaque | never shown as body text |
| `evidenceType` | `inbound_message | case | workflow | null` | — | no | allowlisted |
| `evidenceId` | string/null | opaque ref | restricted ref | response-gated |
| `technicalRefType` | `workflow_instance | agent_run | null` | — | no | response-gated |
| `technicalRefId` | string/null | opaque ref | restricted ref | response-gated |

Nie ma `updatedAt` ani `deletedAt`: record jest append-only i nie jest user-editable. JSON adapter dodaje kolekcję `activity-entries.json`, używa istniejącego atomic temp-write-and-replace oraz jednej atomic mutation do check+append. Unikalność logiczna to `(tenantId, organizationId, dedupeKey)`.

### Ordering, pagination and retention

- Sort: `occurredAt DESC, id DESC` dla API; timeline renderuje pobrane wpisy chronologicznie ASC.
- Cursor: opaque base64url encoding wersjonowanego `{ occurredAt, id }`; input walidowany i limitowany, bez OFFSET.
- Global default `limit=20`; case default `limit=50`; max `100`.
- MVP JSON nie wykonuje automatycznego purge. Produkcyjny adapter powinien zachować aktywność co najmniej przez lifecycle case i zgodnie z polityką retention po jego zamknięciu; nie wolno dodać purge bez osobnej decyzji i testów.
- Brak cache w MVP. Każdy request czyta scoped bounded page; JSON full scan jest akceptowany wyłącznie w deklarowanym local/demo single-process backendzie.
- Docelowy ORM adapter powinien mieć indeksy `(tenant_id, organization_id, occurred_at, id)`, `(tenant_id, organization_id, case_id, occurred_at, id)` i `(tenant_id, organization_id, evidence_type, evidence_id, occurred_at)` oraz unique `(tenant_id, organization_id, dedupe_key)`.
- Case timeline wykonuje bounded batch resolution: jedno pobranie scoped case, jedno pobranie jego inbound message IDs i jeden activity page scan/query. Nie wykonuje lookupu per entry.

## API, Command, and Error Contracts

### `GET /api/supply_cases/activity`

Custom read route, nie `makeCrudRoute`, ponieważ store jest file-backed i response jest permission-aware projection.

| Contract | Definition |
|---|---|
| Metadata | `GET: { requireAuth: true, requireFeatures: ['supply_cases.view'] }` |
| Query | `{ caseId?: non-empty string, cursor?: bounded opaque string, limit?: int 1..100 = 20 }` |
| Scope | tenant + selected organization z request context; brak selected org = 400 |
| Success | `{ items: ActivityItem[], nextCursor: string | null, asOf: ISO timestamp }` |
| Errors | 400 invalid query/scope, 401, 403, 500 safe localized client state |
| Case isolation | `caseId` jest najpierw scoped-resolved; entries są pobierane po caseId oraz batchowo po scoped inbound-message IDs tego case; foreign-org/nonexistent nie ujawnia rekordu |
| OpenAPI | route exportuje `openApi`; schemas w `src/modules/supply_cases/api/openapi.ts` |

`ActivityItem` zawiera: `id`, `caseId`, `caseCorrelationId`, `kind`, `status`, `actorType`, `titleKey`, `detailKey`, `params`, `occurredAt`, `recordedAt`, `groupKey`, `isStale`, `evidence` i `technicalDetail`.

- `evidence` jest `null`, jeśli brak ref albo użytkownik nie ma wymaganego feature. Dla inbound message zawiera tylko `{ type, id, href }`, nigdy body.
- `technicalDetail` jest `null`, jeśli brak authoritative ref albo `agent_orchestrator.trace.view`. Target route ponownie egzekwuje własny ACL i scope.
- Endpoint nie przyjmuje tenant/org, event IDs ani arbitrary kinds od klienta.
- Endpoint nie ma write command, mutation guard ani optimistic lock, ponieważ activity jest system-projected i read-only.

### Event contracts

Addytywne definicje w `src/modules/supply_cases/events.ts`:

| Event | Purpose | Broadcast / persistence |
|---|---|---|
| `supply_cases.analysis.started` | start triage/initial/final analysis | emitted persistent; not clientBroadcast |
| `supply_cases.analysis.completed` | validated terminal result summary | emitted persistent; not clientBroadcast |
| `supply_cases.analysis.failed` | typed reason and retryability | emitted persistent; not clientBroadcast |
| `supply_cases.case.stage_changed` | committed domain stage transition | emitted persistent; not clientBroadcast |
| `supply_cases.case.risk_detected` | deterministic shortage/risk fact | emitted persistent; not clientBroadcast |
| `supply_cases.activity.recorded` | opaque invalidation hint after first append | `clientBroadcast: true`, `excludeFromTriggers: true`; not consumed by projector |

`activity.recorded` payload is capped to `{ id, activityId, caseId, occurredAt, tenantId, organizationId }`. Emit options carry trusted `{ tenantId, organizationId }`. Existing event IDs and payloads remain unchanged.

## Events, Jobs, and Projection Semantics

### Idempotency and retries

- Persistent activity subscribers expose stable `metadata.id` and one side effect: call projector append.
- `appendIfAbsent` returns `{ status: 'recorded' | 'already_recorded', entry }`.
- `activity.recorded` emits only for `recorded`; retry after a post-write/pre-emit crash may omit a live hint, but data appears on focus/manual refresh. It must not emit duplicate feed rows.
- Agent retry uses a new `operationId` and the same `groupKey`. UI may summarize latest attempt but the expanded/full timeline retains every attempt.
- Source delivery out of order is allowed. Ordering uses source `occurredAt`; terminal without visible start remains truthful and renders independently.

### Failure and stale states

| Condition | Stored facts | User-visible result | Recovery |
|---|---|---|---|
| Agent throws | `analysis.started` + `analysis.failed` | „Analiza nie powiodła się” + localized reason category | command/workflow-defined retry only |
| Projector fails | no/partial new activity, domain state intact | feed may lag; never false success | persistent subscriber retry/dead-letter observability |
| SSE disconnect | records continue to persist | stale open view until recovery | initial load, browser focus/visibility/online refetch, manual refresh |
| Started without terminal | immutable start only | after threshold `isStale=true`, „Analiza trwa dłużej niż zwykle” | terminal/retry adds new entry; no synthetic failure |
| Duplicate source event | one entry | no duplicate | `dedupeKey` no-op |
| Unknown/new source enum | no misleading entry | feed omits unsupported fact | logged/reported with enumerated internal error; mapping test fails in development |
| Case linked after intake | intake remains global-only; later entries have case | no retroactive mutation | optional deterministic backfill is future work |
| Entry references deleted/missing case | global row omits navigation or marks unavailable | no raw id leak | bounded consistency test and cleanup policy |

Stale thresholds are constants in `lib/activity/stale.ts`: triage `2 min`, initial/final analysis `5 min`, external wait is never marked stale solely by elapsed UI time because workflow timeout owns that business decision. Thresholds affect display only.

## User Journeys

### Journey J-001 — Nowy e-mail i analiza

1. Supply intake accepts an inbound message and appends „Otrzymano nowy e-mail”.
2. Before calling the triage agent, the module emits `analysis.started`; global preview refreshes to „Agent analizuje wiadomość”.
3. Validated triage completion appends „Rozpoznano nadawcę jako dostawcę”.
4. Deterministic apply links/creates case and appends „Agent wykrył ofertę: 300 szt. w środę i 200 szt. w piątek” oraz „Utworzono sprawę SC-…”.
5. Clicking a case-correlated row opens its detail. Intake row without case remains non-clickable until later entries establish correlation.

### Journey J-002 — Wpływ i ryzyko

1. Detail shows „Agent analizuje wpływ oferty na zapotrzebowanie”.
2. After validated analysis, it shows „Porównano ofertę z zapotrzebowaniem: 300/500 na termin”.
3. Deterministic risk event shows „Wykryto ryzyko: brakuje 200 szt. na wymagany termin”.
4. If the run fails, no success/risk entry is invented; timeline shows failure and available recovery from the existing case contract.

### Journey J-003 — External waits, confirmations and resolution

1. Stage changes explain „Wysłano zapytanie do alternatywnego dostawcy” and „Czekamy na ofertę”.
2. Alternative offer, final analysis and decision append their own facts.
3. Confirmation events name supplier role, quantity/date and verdict without exposing raw email.
4. Resolution appends „Sprawa rozwiązana: potwierdzono 500/500, ryzyko PROTECTED”.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source | Closest reference | Canonical shell/components | Required states | REQ |
|---|---|---|---|---|---|---|
| `/backend/supply-cases` | Compact organization-wide „Co się dzieje”; open related case; manual refresh/load older | `GET /api/supply_cases/activity?limit=20` | existing `SupplyCasesTable.tsx`; `src/modules/example/backend/todos/page.tsx` (`ui.page-shell`) | existing page shell, `CollapsibleSection`/`SectionHeader`, `Button`, `LoadingMessage`, `ErrorMessage`, `EmptyState`, Lucide icons | loading, empty, error, live update, disconnected/stale, narrow/light/dark | 005–007 |
| `/backend/supply-cases/{id}` | Full case timeline; evidence and authorized technical deep-links; load older | same endpoint with `caseId`, default 50 | existing timeline in `SupplyCaseDetail.tsx` | `DetailSection` or `CollapsibleSection`, `StatusBadge`, `Button`, accessible ordered list | loading, empty, partial/degraded, running/stale/failed/retry/success, forbidden links, pagination | 001–004, 006–008 |

### Global preview layout

```text
Co się dzieje                                      [Odśwież]
10:44  Wykryto ryzyko: brakuje 200 szt.       [SC-1042 →]
10:43  Agent porównał ofertę z zapotrzebowaniem [SC-1042 →]
10:42  Agent analizuje wiadomość
10:42  Otrzymano nowy e-mail
                                               [Pokaż starsze]
```

- Preview jest sekcją nad tabelą albo pierwszą sekcją strony; nie zmniejsza DataTable poniżej użytecznej szerokości.
- Na narrow width timestamp, komunikat i case link układają się pionowo.
- Wpisy bez `caseId` nie są klikalne i nie pokazują raw message id.
- MVP nie ma filtrów ani unread state.

### Contextual timeline layout

```text
Aktywność sprawy
10:42  Otrzymano nowy e-mail                       [Dowód]
10:42  Agent analizuje wiadomość                  [w toku]
10:42  Rozpoznano nadawcę jako dostawcę
10:43  Wykryto ofertę: 300 śr. + 200 pt.
10:43  Porównano ofertę z potrzebą: 300/500
10:43  Wykryto ryzyko: brakuje 200 na termin
10:44  Utworzono sprawę dostawową SC-1042
                                      [Pokaż starsze]
```

- Kolejność wizualna w detailu jest najstarsze → najnowsze; „Pokaż starsze” prepends starszą stronę bez utraty focus/scroll anchor.
- Status ma tekst i ikonę; kolor jest pomocniczy i używa semantic status tokens.
- „Szczegóły techniczne” jest linkiem, nie automatycznie rozwijanym payloadem. Brak feature całkowicie usuwa link z response/DOM.
- Evidence link prowadzi do istniejącej sekcji wiadomości/case, nie zwraca body z activity API.
- Relative time jest dodatkiem do lokalizowanego absolute timestamp. SSR/client hydration nie zależy od `Date.now()`; komponent po fetch renderuje deterministyczny timestamp i aktualizuje relative label po mount.

### Accessibility and i18n

- Wszystkie copy używają `supply_cases.activity.*`; API zwraca keys/enums/typed params, nigdy przetłumaczony tekst.
- Parametry liczby, waluty i daty formatuje locale-aware UI; machine IDs/statusy nie są tłumaczone w storage.
- Feed jest `<ol>` z semantycznym czasem `<time dateTime>`. Nowy wpis jest ogłaszany przez dedykowany `aria-live="polite"` summary; cały timeline nie jest ponownie odczytywany.
- Loading ustawia `aria-busy`; manual refresh i load-more używają `Button`; icon-only controls mają `aria-label`.
- Focus po błędzie trafia do `ErrorMessage`; load-more zachowuje focus na pierwszym nowo dodanym starszym wpisie lub przycisku według wzorca testowego.
- `prefers-reduced-motion` wyłącza animację pojawienia; funkcja nie wymaga animacji do zrozumienia zmiany.
- Light/dark korzystają z semantic/status tokens, bez `dark:` overrides i hard-coded palette.

### Frontend Architecture Contract

| File / boundary | Server or client | Justification |
|---|---|---|
| existing backend page roots | server where currently server-rendered | metadata/auth/page shell pozostają poza client blob |
| `components/SupplyActivityFeed.tsx` | client leaf | API state, `useAppEvent`, cursor, focus/visibility recovery |
| `components/SupplyActivityTimeline.tsx` | client leaf | case-scoped pagination and live updates |
| `components/activityPresentation.ts` | client-safe pure module | kind → icon/status treatment; no data fetching |

- Nie dodajemy providerów ani bootstrapu do app shell; używamy już zamontowanego Event Bridge.
- Brak nowej production dependency. Ikony z `lucide-react`, requesty przez `apiCall`/`apiCallOrThrow`, nigdy raw `fetch`.
- Client bundle delta dla obu lazy/local leaves powinien pozostać ≤15 kB gzip bez framework chunks; brak chart/editor/date library.
- Pierwszy render nie wysyła wszystkich entries w server HTML; bounded client fetch zapobiega powiększaniu RSC payloadu.
- Browser test mierzy brak hydration warnings, działanie linków/refresh po JS hydration i coalesced live update.

## Security, Privacy, and Compliance

- Activity endpoint filtruje tenant + organization przed case/entry lookup i fail-closed przy braku scope.
- `params` są discriminated-union schemas. Nie ma generic `Record<string, unknown>` na granicy odpowiedzi.
- Nie renderujemy HTML z entry; wszystkie wartości są text nodes. Zakaz `dangerouslySetInnerHTML`.
- Standardowy entry nie zawiera body, subject, full email, customer name, agent prompt/output, tool arguments/results, credentials, provider payload, raw error message ani stack.
- Supplier jest reprezentowany rolą (`SUPPLIER_1`, `SUPPLIER_2`) i localized label; pełny adres pozostaje w existing message detail pod `view_messages`.
- `actorRef`, `evidenceId` i `technicalRefId` nie są zwracane, gdy użytkownik nie ma właściwego feature. Href buduje serwer z allowlisted route type; nie przyjmuje arbitrary URL.
- JSON store jest local/demo i nie jest szyfrowaniem. Projekt celowo zapisuje tylko business-safe values; przyszły adapter nie może rozszerzyć payloadu o PII bez encryption-map review.
- `activity.recorded` SSE zawiera tylko opaque ids i timestamp, mieści się znacznie poniżej 4096 B i używa trusted emit scope. Pełna treść jest zawsze ponownie autoryzowana przez GET.
- Brak client-side feature-only hiding jako bariery bezpieczeństwa; serwer redaguje response.
- Logi projektora używają `createLogger`; identyfikatory scope/entry mogą być structured fields, ale bez params z wiadomości. Catch rejestrujący error również używa `reportError` zgodnie z repo policy.

## File and Call-site Manifest

| File | Action | Purpose |
|---|---|---|
| `src/modules/supply_cases/data/activity.ts` | create | Zod schemas, kinds, stored/API types, cursor contract |
| `src/modules/supply_cases/data/repositories.ts` | modify | Add `activities.list`, `appendIfAbsent`, optional test purge under store interface |
| `src/modules/supply_cases/data/json/store.ts` | modify | Scoped atomic `activity-entries.json` collection |
| `src/modules/supply_cases/lib/activity/projectActivity.ts` | create | Allowlisted envelope → entry mapping and dedupe/group keys |
| `src/modules/supply_cases/lib/activity/readActivity.ts` | create | Scoped cursor pagination, ACL-aware evidence/technical projection, stale derivation |
| `src/modules/supply_cases/lib/activity/stale.ts` | create | Pure phase thresholds and grouping helpers |
| `src/modules/supply_cases/di.ts` | modify | Register scoped activity projector/read service if repo pattern requires service token |
| `src/modules/supply_cases/events.ts` | modify | Add additive facts and `activity.recorded`; preserve all existing IDs |
| `src/modules/supply_cases/subscribers/activity-inbound-message-accepted.ts` | create | Project intake |
| `src/modules/supply_cases/subscribers/activity-analysis.ts` | create | Persistent wildcard `supply_cases.analysis.*` projection |
| `src/modules/supply_cases/subscribers/activity-case.ts` | create | Persistent `supply_cases.case.*` projection excluding/ignoring `activity.*` by entity segment |
| `src/modules/supply_cases/subscribers/activity-alternative-offer.ts` | create | Project alternative offer |
| `src/modules/supply_cases/api/activity/route.ts` | create | Scoped GET with metadata, OpenAPI and safe errors |
| `src/modules/supply_cases/api/openapi.ts` | modify | Activity query/response docs |
| `src/modules/supply_cases/components/SupplyActivityFeed.tsx` | create | Global preview, cursor and live refetch |
| `src/modules/supply_cases/components/SupplyActivityTimeline.tsx` | create | Case timeline, pagination, links and live refetch |
| `src/modules/supply_cases/components/activityPresentation.ts` | create | Pure icon/status/presentation map |
| `src/modules/supply_cases/components/SupplyCaseDetail.tsx` | modify | Replace only rendered timeline section; retain existing detail behaviors |
| `src/modules/supply_cases/backend/supply-cases/page.tsx` | modify | Add global preview without new navigation route |
| `src/modules/supply_cases/lib/triage/agentRuntimeInvoker.ts` | modify | Emit started/completed/failed around triage; no fabricated run ID |
| `src/modules/supply_cases/lib/impact/runInitialImpactAdvisor.ts` | modify | Emit lifecycle with case/workflow operation identity |
| N/A — no final-resolution agent invocation exists in the current source tree | no file in this feature | Do not create a stub or broaden scope; the parent workflow Phase 3 owner must emit the same `analysis.*` contract when its real call site lands |
| `src/modules/supply_cases/commands/initial-impact.ts` and relevant phase commands/subscribers | modify | Emit post-commit stage/risk facts at real transition sites |
| `src/modules/supply_cases/i18n/{en,pl,de,es,ko}.json` | modify | Complete activity/status/error/accessibility keys |
| focused `__tests__` and `__integration__` files below | create/modify | Unit, security, event, API and browser evidence |

Implementation must inspect each dirty file before editing and preserve the user’s uncommitted work. It must not reset, delete or overwrite unrelated changes.

## Integration Coverage

Fixtures tworzą unikalny tenant/org/case/message/operation, używają publicznych event/route seams i sprzątają tylko własne dane w `finally`. Testy nie polegają na globalnym seedzie ani stałych `SC-001` IDs.

| Test ID | Level | Setup / action | Assertions | REQ |
|---|---|---|---|---|
| ACT-UNIT-001 | unit | Map every source fact | exact kind/key/safe params/dedupe/group; no raw prose | 001–003, 007 |
| ACT-UNIT-002 | unit | Replay same event and concurrent-like append | one entry, one recorded status | 002 |
| ACT-UNIT-003 | unit | start/success/failure/retry/out-of-order/stale clock | truthful grouping and stale derivation; no synthetic failure | 008 |
| ACT-UNIT-004 | unit | encode/decode cursor, equal timestamps, invalid cursor | stable no-gap/no-duplicate ordering; 400 invalid | 002 |
| ACT-UNIT-005 | unit/security | source payload includes email/body/prompt/error/tool args | stored/API entry omits all forbidden values | 007 |
| ACT-EVT-001 | integration | emit accepted message and analysis lifecycle; replay | persistent subscriber writes expected activities once; trusted scope wins over forged payload | 001–003, 007 |
| ACT-EVT-002 | integration | projector throws once then retries | domain record remains; eventual one entry; no duplicate broadcast | 002, 008 |
| ACT-API-001 | API integration | two tenants, two orgs, mixed case/global entries, intake created before case link | only selected org returned; case filter includes linked intake without mutation; bounded batch query; cursor correct | 002, 003, 004, 005, 007 |
| ACT-API-002 | API security | viewer/message viewer/trace viewer/wildcard/forbidden | correct evidence/technical redaction and 403; no existence leak | 007 |
| ACT-API-003 | API | limit 1/20/100/101, malformed cursor/case | bounded response and exact errors | 002, 005 |
| ACT-UI-001 | browser | open supply list with no activities, then records | loading/empty/feed/link/load older; narrow/light/dark | 005–007 |
| ACT-UI-002 | browser | open case detail through full email → analysis → risk fixture | exact human-readable chronology and numeric messages; no raw event ids | 001, 003, 004 |
| ACT-UI-003 | browser + event | keep list/detail open; emit burst of 3 entries | UI updates without reload, bounded/coalesced GET count, newest visible | 006 |
| ACT-UI-004 | browser | disconnect/miss event, restore online/focus | refetch catches persisted entry; manual refresh works | 002, 006 |
| ACT-UI-005 | accessibility | keyboard-only, screen reader semantics, reduced motion | focus order, one polite announcement, time labels, icon labels, no color-only meaning | 004–006 |
| ACT-UI-006 | browser/security | no message/trace ACL | links and sensitive refs absent from DOM; business message remains useful | 007 |
| ACT-E2E-001 | end-to-end | self-contained supplier email scenario | sequence: received → analyzing → classified → offer → comparison → risk → case, survives reload | 001–008 |

## Implementation Phases

### Phase 1 — Durable activity projection and read API

- **Depends on:** current `SupplyCasesStore`, existing event bus, current intake/analysis call sites.
- **Outcome:** source facts create a durable, scoped, deduplicated business activity page retrievable through API; no UI replacement yet.
- **Steps:**
  1. Add strict activity schemas, cursor and append-only repository contract.
  2. Add JSON collection and atomic `appendIfAbsent`; add unit tests for scope/dedupe/order.
  3. Add events and persistent projection subscribers, then instrument only real triage/impact/stage/risk call sites.
  4. Add permission-aware read service and `GET /api/supply_cases/activity` with metadata/OpenAPI.
  5. Run generation and focused unit/API/event tests.
- **Independent slices / estimated commits:** (1) model/store; (2) event projection; (3) API/security after model is merged.
- **Requirements closed:** REQ-001–003, read foundation for REQ-004/005, REQ-007/008.
- **Tests:** ACT-UNIT-001–005, ACT-EVT-001–002, ACT-API-001–003.
- **Validation:** `yarn generate`; focused `yarn test --runInBand src/modules/supply_cases`; `yarn typecheck`; `yarn lint`; `yarn i18n:check-hardcoded`.
- **Exit gate:** replay-safe event sequence returns exact safe entries in order, second org is invisible, no raw prose is persisted/returned, and activity failure does not fail the domain operation.

### Phase 2 — Contextual case timeline with live refresh

- **Depends on:** Phase 1 exit gate and current case detail route.
- **Outcome:** operator sees full human-readable case history that updates live and survives reload/reconnect.
- **Steps:**
  1. Build pure presentation map and client timeline leaf using `apiCall` and cursor pagination.
  2. Replace only the visual legacy timeline block in `SupplyCaseDetail`; keep existing `timeline` API field for compatibility.
  3. Add `useAppEvent('supply_cases.activity.recorded')` with case filtering and ≥500 ms coalescence; add focus/visibility/online/manual recovery.
  4. Add evidence and technical links with server-side redaction and existing target ACL.
  5. Complete five locales and browser/accessibility/security tests.
- **Requirements closed:** REQ-004, REQ-006–008.
- **Tests:** ACT-UI-002–006 and case-scoped ACT-E2E-001.
- **Validation:** Phase 1 commands + focused Playwright, `yarn ds:check`, `yarn i18n:check-values`, light/dark/narrow screenshots/evidence.
- **Exit gate:** a running case shows exact chronology, live updates without duplicate rows, missed SSE is recovered, unauthorized links are absent, and existing control-tower decisions/gates remain unchanged.

### Phase 3 — Global supply activity preview

- **Depends on:** Phase 2 exit gate.
- **Outcome:** `/backend/supply-cases` shows the latest organization-wide supply activity and links correlated rows to cases.
- **Steps:**
  1. Reuse the presentation/feed primitives with `caseId` omitted and `limit=20`.
  2. Integrate the section without changing DataTable semantics, URL filters or navigation metadata.
  3. Add empty/error/load-older/live/reconnect behavior and responsive/a11y evidence.
  4. Run full self-contained email → agent → risk browser flow and configured validation gate.
- **Requirements closed:** REQ-005–006 and final REQ-001–008 journey.
- **Tests:** ACT-UI-001, ACT-UI-003–006, ACT-E2E-001.
- **Validation:** `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test`, relevant `yarn test:integration`; `yarn build` if configured environment supports it.
- **Exit gate:** global preview and case timeline show the same underlying entries with different scope, activity arrives live, second organization never appears, and the end-to-end business narration matches acceptance criteria.

## Extension-surface Traceability

| Surface | Reference capability / exact file | Classification | Phase | Self-contained test |
|---|---|---|---|---|
| Additive `events.ts` + client broadcast | `events.typed-definitions` — `src/modules/example/events.ts` | emitted-example | 1 | ACT-EVT-001 |
| Persistent activity subscribers | event subscriber mechanism; closest readable examples in `src/modules/example/subscribers/example-event.ts` plus persistent rules in `packages/events/AGENTS.md` | catalog-only: example row is ephemeral, project requires documented persistent idempotency | 1 | ACT-EVT-001/002 |
| Custom scoped read API | `api.custom-route` — `src/modules/example/api/organizations/route.ts` | emitted-example | 1 | ACT-API-001–003 |
| OpenAPI factory/schema placement | `api.openapi` — `src/modules/example/api/openapi.ts` | emitted-example | 1 | route contract test in ACT-API-003 |
| Existing backend page extension | `ui.page-shell` — `src/modules/example/backend/todos/page.tsx`, `src/modules/example/backend/todos/page.meta.ts` | emitted-example | 2–3 | ACT-UI-001/002 |
| DOM Event Bridge consumer | framework `useAppEvent` documented in `packages/ui/src/backend/AGENTS.md`; no dedicated reference-module page row | framework-only | 2–3 | ACT-UI-003/004 |

## Requirement Traceability

| Requirement | Journey / surface | Contracts | Phase | Tests | Acceptance |
|---|---|---|---|---|---|
| REQ-001 | J-001/002/003, both feeds | mapping + i18n keys | 1–3 | UNIT-001, UI-002, E2E-001 | AC-001 |
| REQ-002 | reload/replay/pagination | entry/store/API | 1 | UNIT-002/004, EVT-002, API-001 | AC-002 |
| REQ-003 | email-agent-case | envelope/correlation rules | 1 | UNIT-001, EVT-001, E2E-001 | AC-003 |
| REQ-004 | case detail | case-scoped GET + timeline | 2 | UI-002/004/005 | AC-004 |
| REQ-005 | list preview | global GET + feed | 3 | UI-001/003 | AC-005 |
| REQ-006 | open list/detail | activity.recorded + useAppEvent | 2–3 | UI-003/004 | AC-006 |
| REQ-007 | all | scope/ACL/redaction | 1–3 | UNIT-005, API-001/002, UI-006 | AC-007 |
| REQ-008 | failures/retries | lifecycle facts + stale derivation | 1–2 | UNIT-003, EVT-002, UI-002 | AC-008 |

## Rollout, Migration, Backward Compatibility, and Rollback

- To zmiana addytywna. Żaden istniejący event ID, payload field, API route, ACL feature, command, widget spot ani import path nie jest usuwany lub zmieniany.
- Nowe event IDs stają się publicznym additive contract po publikacji; rename/removal wymaga standardowego deprecation protocol z `BACKWARD_COMPATIBILITY.md`.
- Obecne `SupplyCaseDetailResponse.timeline` pozostaje w schema i response. Phase 2 przestaje go renderować jako główny timeline, ale nie usuwa pola w tym wydaniu.
- Brak DB migration i brak `yarn db:migrate`. JSON collection jest tworzona przez istniejący store pattern. `yarn generate` jest wymagane po nowych events/subscribers/API discovery files.
- Rollout order: Phase 1 API/projection → Phase 2 case UI → Phase 3 global preview. Każda faza może zostać wyłączona przez usunięcie powierzchni UI z bieżącego wdrożenia bez cofania domenowych zmian.
- Nie backfillujemy niepewnych „case_updated” z jednego `updatedAt`. Opcjonalny seed może dodać wyłącznie jednoznaczne `case_created`, existing inbound message i resolved fact z ich własnymi stabilnymi IDs.
- Rollback UI usuwa preview/timeline consumers. Rollback projector zatrzymuje nowe wpisy; zapisane `activity-entries.json` pozostaje inert i recoverable. Nie usuwać pliku automatycznie.
- Jeśli activity mapping powoduje problem, domain flow nadal działa; feed może zostać ukryty bez zmiany command/workflow state.

## Risks and Impact Review

### Projection lags behind domain state

- **Scenario:** persistent subscriber jest opóźniony lub retryuje po tym, jak case już zmienił status.
- **Severity:** Medium
- **Affected area:** activity UI only
- **Mitigation:** domain read model pozostaje osobnym źródłem bieżącego statusu; feed pokazuje `recordedAt`, persistent retries i manual/focus refresh; activity nie steruje decyzjami.
- **Residual risk:** przez krótki czas timeline może nie zawierać ostatniego kroku.

### Duplicate/reordered event delivery

- **Scenario:** at-least-once delivery powtarza lub zmienia kolejność source events.
- **Severity:** Medium
- **Affected area:** timeline readability
- **Mitigation:** deterministic `dedupeKey`, append atomicity, source `occurredAt`, stable tie-break and explicit start/terminal entries.
- **Residual risk:** terminal może być chwilowo widoczny przed opóźnionym startem, ale komunikat pozostaje prawdziwy.

### Cross-tenant activity leak

- **Scenario:** query albo evidence resolution pomija scope.
- **Severity:** Critical
- **Affected area:** privacy and tenant isolation
- **Mitigation:** trusted scope at append/read, composite filtering, scoped case verification, adversarial two-tenant tests, no fallback to tenant-wide/global.
- **Residual risk:** none accepted; failure must be fail-closed.

### PII copied into durable feed or SSE

- **Scenario:** source message/model error is inserted into `params` or broadcast.
- **Severity:** High
- **Affected area:** privacy, logs, browser clients
- **Mitigation:** allowlisted discriminated schemas, no arbitrary text, role labels instead of email, opaque SSE hint, negative redaction tests.
- **Residual risk:** SKU/case reference remain business data available to authorized supply viewers.

### Activity appears authoritative when agent is still running

- **Scenario:** start exists, terminal event never arrives after crash.
- **Severity:** High
- **Affected area:** operator trust
- **Mitigation:** running status, derived stale state, no success synthesis, explicit retry attempt, domain status remains visible separately.
- **Residual risk:** operator may need existing recovery action after timeout.

### Event storm causes excessive refetch

- **Scenario:** several activity entries arrive in a short agent/workflow burst.
- **Severity:** Medium
- **Affected area:** browser/API load
- **Mitigation:** ≥500 ms coalescence, one bounded cursor fetch, no per-event body fetch, performance/browser assertion.
- **Residual risk:** many active tabs still generate one request per tab/burst.

### JSON store scale and multi-process limits

- **Scenario:** activity count grows or multiple app instances write the same file.
- **Severity:** High for production, Low for declared local/demo MVP
- **Affected area:** latency/data integrity
- **Mitigation:** bounded pages, explicit no-production contract, same repository seam for future ORM, no cache pretending to solve write contention.
- **Residual risk:** this MVP is not a production persistence implementation.

### Trace link is unavailable for some runs

- **Scenario:** current runtime result does not expose authoritative `runId`, especially pre-case triage.
- **Severity:** Low
- **Affected area:** diagnostic convenience
- **Mitigation:** nullable technical ref, workflow execution deep-link when authoritative, never infer by time.
- **Residual risk:** some entries have business detail only; acceptable because inline trace is a non-goal.

## Acceptance Criteria

- [ ] **AC-001** — Referencyjny flow renderuje po polsku co najmniej: otrzymano e-mail, agent analizuje, rozpoznano dostawcę, wykryto ofertę `300 śr. + 200 pt.`, porównano `300/500`, wykryto brak `200`, utworzono case; UI nie pokazuje raw event/command IDs.
- [ ] **AC-002** — Reload, SSE reconnect i replay source eventu zachowują dokładnie jeden wpis na `dedupeKey`; cursor nie tworzy luk ani duplikatów.
- [ ] **AC-003** — Correlation używa message/case/workflow/invocation IDs; pierwotny intake pojawia się po autorytatywnym linku również w timeline case bez mutacji entry; żaden test ani call site nie wyszukuje „najnowszego runu” według czasu.
- [ ] **AC-004** — Case detail pokazuje pełną chronologię, running/stale/failed/retry/success, load older i dozwolone links bez naruszenia istniejących decyzji/control-tower UI.
- [ ] **AC-005** — `/backend/supply-cases` pokazuje ostatnie 20 scoped aktywności, linkuje tylko entries z case i nigdy nie miesza organizacji.
- [ ] **AC-006** — `activity.recorded` odświeża otwartą listę/detail bez manual reloadu; burst jest koalescowany, a focus/online/manual refresh odzyskuje eventy pominięte podczas disconnect.
- [ ] **AC-007** — Bez `view_messages`/`trace.view` response i DOM nie zawierają evidence/technical refs; w storage/API/SSE brak body, subject, pełnych e-maili, prompts, outputs, tool payloads, raw errors i secrets.
- [ ] **AC-008** — Started bez terminala staje się tylko `stale`; failure/retry są jawne; żaden brak eventu nie jest interpretowany jako sukces.
- [ ] Wszystkie user-facing strings są w pięciu locale, status nie opiera się wyłącznie na kolorze, a light/dark/narrow/keyboard/reduced-motion evidence przechodzi.
- [ ] Wszystkie affected API i UI paths mają self-contained integration coverage, a configured validation gate przechodzi w wybranym runnerze.

## Implementation Status

**Status:** Implemented locally; review corrections are applied, browser QA is pending, and the full test suite was intentionally not run per operator instruction.

### Progress

- [x] Phase 1 — durable JSON activity projection, idempotent append, scoped cursor API, OpenAPI contract, ACL-aware redaction and replay-safe subscriber.
- [x] Phase 2 — case-scoped activity timeline, intake-to-case read projection, stale/running/failure states, pagination and coalesced live refresh.
- [x] Phase 3 — global “Co się dzieje” panel on the supply-cases list with scoped preview, case links and live refresh.
- [x] Additive event definitions and trusted tenant/organization propagation on the affected supply-case flows.
- [x] Focused activity, JSON-store, read-API and triage regression tests.
- [x] Review corrections: shared triage lifecycle groups, explicit non-supplier/quarantine terminals, validated confirmation commitments, durable emission error propagation, enum allowlists, authoritative links/timestamps, query bounds and honest online/live announcements.
- [x] `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn build` and focused activity/triage/resolution tests completed successfully after review corrections.
- [ ] Full `yarn test` suite and real-browser accessibility/live-refresh verification; `yarn test` was not run by explicit operator instruction.

### Implementation notes

- The projection uses the existing `supply_cases` JSON store seam and does not add or apply a database migration.
- Existing `SupplyCaseDetailResponse.timeline`, source events and API contracts remain available; the new activity API and event are additive.
- The activity stream persists only allowlisted business facts. Raw message content, prompts, model output, tool calls, raw errors and secrets are not copied to the projection or invalidation event.
- No final-resolution agent or timestamp-based correlation was introduced. Missing terminal events remain running/stale rather than being interpreted as success.
- Browser integration/QA remains an environment-dependent follow-up because the implementation runner has not yet been started against a live app.
- The production build emits the existing Turbopack warning that dynamic filesystem access in `src/modules/supply_cases/data/json/store.ts` traces the project; the build still completes successfully.
- The current standalone `yarn typecheck` is blocked by the unrelated user-owned assertion at `src/modules/supply_cases/__tests__/apply-triage-outcome.test.ts:400` (`caseCreated` is not part of the current `ApplyTriageOutcome` type); that test was not modified.

## Final Compliance Report

### AGENTS.md and guides reviewed

- root/project `AGENTS.md` supplied for `manufacturer-app`
- `../BACKWARD_COMPATIBILITY.md`
- `../packages/events/AGENTS.md`
- `../packages/ui/AGENTS.md`
- `../packages/ui/src/backend/AGENTS.md`
- `../packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `../.ai/specs/AGENTS.md`
- `.ai/guides/spec-delivery.md`
- `.ai/guides/backend-ui.md`
- `.ai/specs/SPEC-000-template.md`
- `om-spec-writing` and its review/compliance references

### Compliance Matrix

| Rule source | Rule | Status | Evidence / resolution |
|---|---|---|---|
| root AGENTS | Check specs and real call sites first | Compliant | supplier workflow, supply UI/control-tower specs, events/store/read-model/UI and orchestrator runtime inspected |
| root AGENTS | No direct ORM relationships between modules | Compliant | opaque IDs/events/deep-links only |
| root AGENTS | Tenant + organization scoping | Compliant | trusted composite scope on append/read/evidence |
| root AGENTS | Use declared events and run generate | Compliant | additive `createModuleEvents` definitions and Phase validations |
| events AGENTS | Persistent subscribers idempotent; one side effect | Compliant | stable metadata + `appendIfAbsent`; broadcast follows first append |
| events AGENTS | Browser audience and 4 KB | Compliant | trusted scope and ids-only echo |
| backend UI AGENTS | `apiCall`, shared states, i18n | Compliant | explicit UI contract and file manifest |
| design system | semantic tokens/shared primitives/a11y | Compliant | UI contract and ACT-UI-005 |
| agent orchestrator | append-only traces, trace ACL, no domain writes by agent | Compliant | no trace duplication; activity records facts outside agent |
| backward compatibility | existing events/APIs not removed | Compliant | additive events/route; legacy detail `timeline` retained |
| spec delivery | self-contained API/UI integration coverage | Compliant | ACT matrix and phase exit gates |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data model matches API | Pass | permission-aware projection is derived from strict stored entry |
| Events match projection | Pass | every MVP source has mapping/dedupe/correlation rules |
| API matches both UI surfaces | Pass | one cursor endpoint, optional scoped case filter |
| Failure modes match append-only lifecycle | Pass | start/terminal/retry separate; stale derived |
| Privacy matches persisted fields and SSE | Pass | allowlisted params and opaque invalidation hint |
| Phases are independently working | Pass | API → case timeline → global preview, each with exit gate |
| Scope cohesion | Pass | one capability: business narration of supply operations; two views share one read model and cannot deliver consistent behavior independently |

**Verdict: Ready for implementation.**

## Open Questions

N/A — wszystkie decyzje blokujące zostały rozstrzygnięte jako najmniejsze odwracalne autonomous defaults. W obecnym source tree nie istnieje final-resolution agent invocation; ta funkcja nie tworzy stubu ani fikcyjnego wpisu, a przyszły właściciel parent Phase 3 ma użyć tego samego kontraktu `analysis.*`.

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial implementation-ready specification; autonomous defaults, event envelope, append-only projection, global/detail UI, security, tests and phased delivery. |
| 2026-09-19 | Self-review: removed generic/platform scope, retained legacy detail timeline contract, made SSE ids-only, prohibited timestamp-based run correlation, added stale/retry semantics, frontend architecture contract and extension-surface traceability. |

### Review — 2026-09-19

- **Reviewer:** author self-review; fresh-context subagent was unavailable in this environment, so scope cohesion was checked adversarially against the one-capability test.
- **Security:** Passed — composite scope, server redaction and negative PII tests are explicit.
- **Performance:** Passed for declared local/demo backend — bounded cursor pages and coalesced refetch; production JSON limitation is a release constraint.
- **Cache:** Passed — explicit no-cache decision; no stale/cross-tenant cache surface.
- **Commands/events:** Passed — no activity write API, additive events, persistent idempotent projectors, domain operations remain owners.
- **Risks:** Passed — projection lag, replay/order, tenant leak, PII, stale runs, event storms, JSON scale and missing trace refs covered.
- **Verdict:** Approved / Ready for implementation.
