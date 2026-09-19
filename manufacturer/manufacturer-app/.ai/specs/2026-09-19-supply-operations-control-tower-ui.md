# Supply operations control tower UI — Sprawa dostawowa

**Date**: 2026-09-19  
**Status**: Ready for implementation  
**Owner role**: supply operations / operator

## TLDR

Jedna lista spraw dostawowych i jeden ekran szczegółu mają dać operatorowi kompletny obraz oraz bezpieczną ścieżkę decyzji dla niedoboru materiałowego. Scenariusz referencyjny pokazuje potrzebę `500 MAT-42 na środę`, realność Supplier 1 (`300 środa + 200 piątek`), ofertę Supplier 2, wpływ na zlecenia produkcyjne i terminy klientów, dokładnie trzy plany resolution, wybór operatora, checklistę potwierdzeń i finalną bramkę `500/500 → PROTECTED → RESOLVED`.

UI rozszerza istniejące list/detail i istniejące guarded command routes; nie tworzy pełnego MRP ani osobnych CRUD-ów zamówień zakupowych. Najważniejsza korekta semantyczna to jawne rozdzielenie planu bazowego od aktualnej rzeczywistości: baseline nie może nadawać zielonego statusu, gdy live proposal zapewnia tylko `300/500` na wymagany termin.

## Problem Statement

Obecny ekran jest dobrym read-only podglądem sprawy i obsługuje wyłącznie initial sourcing decision. Nie daje jednak operatorowi jednego miejsca, w którym można porównać faktyczne możliwości dwóch dostawców, wpływ niedoboru na produkcję i klienta, trzy końcowe plany rozwiązania, ich wybór oraz postęp wymaganych potwierdzeń.

Obecne luki muszą być traktowane jako jawny stan produktu, a nie ukrywane przez UI:

- brak pełnego supplier PO; istniejące commitments i wiadomości są dowodem operacyjnym, ale nie osobnym zamówieniem zakupowym;
- `confirmationChecklist` jest obecnie zawsze puste;
- UI obsługuje tylko initial sourcing decision;
- oferta Supplier 2, końcowe plany resolution i potwierdzenia nie są podłączone do UI;
- baseline może wyglądać na zielony mimo live proposal `300/500`, dlatego plan bazowy i aktualna rzeczywistość muszą mieć odrębne pola, etykiety i statusy.

## Overview and Success Measures

- **Primary outcome:** operator potrafi na jednym ekranie przeprowadzić sprawę od widocznego niedoboru do zweryfikowanego `500/500`, po czym system ustawia kolejno `PROTECTED` i `RESOLVED` dopiero po spełnieniu wszystkich bramek.
- **Leading indicators:** 100% aktywnych spraw pokazuje osobno baseline i live reality; każda sprawa wymagająca decyzji prezentuje dokładnie trzy porównywalne plany; każda wymagana konfirmacja ma jawny status i dowód.
- **Baseline:** lista i detail istnieją, ale detail pokazuje jedynie liczby zbiorcze oraz initial decision; końcowa ścieżka resolution nie jest operacyjna w UI.
- **Market / product reference:** przyjmujemy wzorzec control tower: wyjątek, wpływ, alternatywy, decyzja, potwierdzenia i gate w jednym kontekście. Odrzucamy budowę pełnego systemu MRP/ERP oraz równoległego modułu procurement.

## Goals

- **REQ-001 — Operacyjna kolejka:** lista pozwala rozpoznać priorytet, aktualne live coverage, brak, ryzyko, bieżące oczekiwanie i wymagane działanie bez otwierania każdej sprawy.
- **REQ-002 — Jednoznaczne fakty:** detail pokazuje potrzebę, baseline i live reality Supplier 1/Supplier 2 bez mieszania założeń planu z aktualnym dowodem dostawcy.
- **REQ-003 — Wpływ biznesowy:** detail łączy materiał z dotkniętymi zleceniami produkcyjnymi, terminami klienta i skutkiem opóźnienia.
- **REQ-004 — Decyzja operatora:** operator porównuje dokładnie trzy plany resolution, widzi rekomendację jako advisory i jawnie wybiera jeden plan bez preselection.
- **REQ-005 — Potwierdzenia:** wybrany plan tworzy czytelną checklistę wymaganych potwierdzeń z rolą, ilością, terminem, stanem i dowodem.
- **REQ-006 — Bezpieczne zamknięcie:** status zielony i `RESOLVED` są możliwe wyłącznie przy live coverage `500/500`, ryzyku `PROTECTED`, kompletnych i ważnych potwierdzeniach oraz atomowym zastosowaniu planu.
- **REQ-007 — Bezpieczeństwo operacji:** odczyty i mutacje są scoped, ACL-gated, lokalizowane i chronione optimistic lockingiem.

## Non-goals

- Pełny MRP, przebudowa planowania materiałowego, ATP/CTP lub optymalizacja całej sieci dostaw.
- Osobne CRUD-y supplier PO, linii PO, przyjęć magazynowych lub faktur zakupowych.
- Automatyczne składanie zamówienia u dostawcy bez zatwierdzonego planu i istniejących bramek domenowych.
- Nowy moduł dostawców albo duplikowanie danych CRM/directory.
- Edycja zleceń produkcyjnych, planów bazowych lub danych klienta z poziomu tego ekranu.
- Zamykanie sprawy na podstawie rekomendacji agenta, wysłania wiadomości, częściowej dostawy albo samego wyboru planu.
- Zastępowanie e-mailowego transportu i istniejącego workflow nowym mechanizmem.

## Proposed Solution

Rozszerzyć istniejącą listę `/backend/supply-cases` i detail `/backend/supply-cases/{id}` w module `supply_cases`. Detail pozostaje pojedynczym ekranem operacyjnym i składa dane z istniejącej sprawy, production plan/orders, wiadomości, proposal/resolution oraz confirmation join. Wszystkie mutacje idą przez guarded command routes i po sukcesie odświeżają jeden spójny read model.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Jeden detail jako control tower | Operator podejmuje jedną decyzję na podstawie wielu zależnych faktów | Osobne ekrany: dostawcy, plany, potwierdzenia | Rozrywa kontekst i zwiększa ryzyko decyzji na nieaktualnych danych |
| Dwa obrazy pokrycia: `baseline` i `live` | Eliminuje fałszywie zielony stan | Jeden wspólny wskaźnik coverage | Miesza plan z dowodem; może pokazać green przy `300/500` |
| Dokładnie trzy plany końcowe | Zgodność z domenowym kontraktem i czytelne porównanie | Dowolna liczba kart | Utrudnia testowalność i decyzję operatora |
| Mutacje command-based, bez CRUD PO | Reuse istniejących invariantów, workflow i audytu | Nowe CRUD-y procurement | Poza zakresem i tworzy równoległe źródło prawdy |
| Progresywne odsłanianie sekcji | Jeden ekran bez przeładowania poznawczego | Wszystkie dane stale rozwinięte | Słaba skanowalność na desktopie i narrow width |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Need | `requiredQuantity` danego SKU na `requiredDate`; demo: `500 MAT-42 na środę` | `SupplyCase` | Brak lub niepoprawna wartość blokuje decyzje i pokazuje degraded state |
| Baseline plan | Plan produkcyjny/commitments sprzed aktualnej wymiany z dostawcą | `ProductionPlan` | Wyświetlany jako kontekst, nigdy jako dowód live |
| Live reality | Najnowsze ważne propozycje/potwierdzenia dostawców dla ilości i terminu | messages/proposals/confirmations projection | Brak dowodu daje `unknown/pending`, nie green |
| On-time coverage | Suma ważnych ilości dostępnych nie później niż `requiredDate` | deterministyczna kalkulacja read modelu | Ilości po terminie są widoczne, ale nie zwiększają on-time coverage |
| Shortage | `max(requiredQuantity - liveOnTimeCoveredQuantity, 0)` | read model | Nie może być ujemny |
| Supplier 1 reality | Dla demo: `300 środa + 200 piątek`; on-time liczy tylko 300 | live supplier proposal/confirmation | UI pokazuje split dat, nie agreguje do pozornych `500/500` na środę |
| Supplier 2 offer | Zweryfikowana alternatywna oferta z ilością, datą, ceną/walutą i statusem dowodu | Phase 2/3 proposal data | Brak lub nieczytelna oferta oznacza unavailable/degraded |
| Resolution plan | Jeden z dokładnie trzech końcowych wariantów z allocation, coverage, customer impact i ryzykiem | Phase 3 `resolutionPlans` | Niepoprawny plan nie jest wybieralny |
| Confirmation checklist | Lista wymaganych potwierdzeń wynikająca z wybranego planu, nie lista ręcznych checkboxów | Phase 4 confirmation join | Brak adaptera/nieczytelny plan blokuje final gate |
| `PROTECTED` | Live on-time coverage równe required quantity i wszystkie wymagane potwierdzenia kompletne, ważne i zgodne z planem | coverage + confirmation join | Każda niespójność pozostawia stan niezielony |
| `RESOLVED` | Plan zastosowany atomowo, sprawa zapisana jako ostatnia i po zastosowaniu nadal spełnia `PROTECTED` | resolution apply command | Crash lub częściowy zapis pozostawia sprawę nierozwiązaną |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Supply viewer | Lista i detail bez treści wrażliwych wiadomości | trusted tenant + organization | `supply_cases.view` |
| Message viewer | Jak wyżej plus dozwolone treści/evidence wiadomości | trusted tenant + organization | `supply_cases.view_messages` |
| Supply operator | Initial decision, final plan choice i dozwolone retry/resume | trusted tenant + organization | `supply_cases.view`, `supply_cases.decisions.apply` |
| Resolution operator | Potwierdzenie finalnego wyboru i apply, jeśli kontrakt rozdziela uprawnienie | trusted tenant + organization | addytywne `supply_cases.resolution.apply` |

`tenantId` i `organizationId` pochodzą wyłącznie z zaufanego kontekstu sesji. Każdy read/write filtruje oba scope'y i fail-closed. Uprawnienia są feature-based, z wildcard-aware checks; nazwy ról nie są kontraktem.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Supply case lifecycle | extend | `supply_cases` | existing records/commands/workflow | Jedno źródło prawdy |
| Production orders/plans | reuse read-only | `supply_cases` demo store / przyszły owner | scalar IDs + snapshots | Bez cross-module ORM i bez edycji z control tower |
| Supplier communication | reuse | communication channels | outbound correlation + inbound messages | Dowód i redakcja już istnieją |
| Initial decision | reuse | `supply_cases` | existing decision route/command | Zachowanie obecnej ścieżki |
| Resolution plans | extend projection | Phase 3 contracts | read model + guarded command | UI nie interpretuje surowego JSON samodzielnie |
| Confirmations | extend projection | Phase 4 confirmation join | adapter + read model | Checklista wynika z kontraktu planu |

## Architecture and Data Flow

```text
operator -> list/detail GET -> scoped control-tower read model
operator -> initial decision -> existing guarded command -> workflow/RFQ
Supplier 2 offer -> Phase 3 final analysis -> exactly 3 resolution plans
operator -> choose resolution plan -> guarded command + optimistic lock
supplier confirmations -> Phase 4 join -> confirmation checklist projection
operator/system -> apply confirmed plan -> atomic target-state write
                                      -> 500/500 -> PROTECTED -> RESOLVED
```

- **Module boundary:** cała funkcja należy do `supply_cases`; UI nie tworzy równoległej encji procurement.
- **Read model boundary:** API zwraca gotowe, walidowane projekcje baseline/live, planów i checklisty; komponent nie liczy domenowych statusów.
- **Compatibility:** istniejące pola list/detail pozostają addytywnie; obecne initial decision zachowuje route, ACL i semantics.
- **Dependency gate:** P0 może przygotować czytelny read-only control tower po zamknięciu Phase 2; P1 wymaga kontraktów Phase 3 i adaptera Phase 3→4. Brak adaptera nie może być obchodzony heurystyką w UI.

## User Journeys

### Journey J-001 — Rozpoznanie wyjątku

1. Operator otwiera listę i widzi `MAT-42`, `500`, środę, live `300/500`, shortage `200`, customer breach/at risk i oczekiwanie na decyzję lub dostawcę.
2. Otwiera detail i widzi osobno baseline oraz live split Supplier 1: `300 środa`, `200 piątek`.
3. Jeśli Supplier 2 nie odpowiedział, ekran pokazuje stan waiting i dowód wysłanego RFQ, bez udawania oferty.

### Journey J-002 — Porównanie i wybór planu

1. Po ważnej ofercie Supplier 2 operator widzi ofertę oraz dokładnie trzy plany resolution.
2. Każda karta pokazuje allocation per supplier/date, on-time coverage, shortage, customer impact, koszt/walutę jeśli dostępne, ryzyka i confidence/recommendation.
3. Żaden plan nie jest wstępnie wybrany. Operator wybiera jeden i zatwierdza guarded mutation.
4. Stale version daje conflict bar, refetch i zachowuje świadomą konieczność ponownego wyboru.

### Journey J-003 — Potwierdzenia i final gate

1. Po wyborze planu operator widzi checklistę wymagań, np. Supplier 1 `300 na środę` i Supplier 2 `200 na środę`.
2. Każdy wiersz ma status `pending/confirmed/expired/rejected/mismatch`, czas oraz odnośnik do zredagowanego dowodu.
3. Dopóki dowody nie dają `500/500`, ekran pokazuje blokadę oraz konkretny brak.
4. Po komplecie system pokazuje `500/500`, następnie `PROTECTED`; apply kończy sprawę jako `RESOLVED`.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/supply-cases` | Priorytetyzowana kolejka i wejście do sprawy | existing list GET | istniejąca supply-cases list/DataTable | `PageHeader`, `DataTable`, `StatusBadge`, shared loading/error/empty | loading, empty, error, degraded row, forbidden, responsive | REQ-001, REQ-007 |
| `/backend/supply-cases/{id}` | Jeden ekran control tower; wybór planu; monitoring gate | extended detail GET; existing initial decision; Phase 3/4 guarded commands | istniejący `SupplyCaseDetail.tsx` | `PageHeader`, KPI cards, `Alert`, `StatusBadge`, `RadioGroup`, `Button`, `SectionHeader`, conflict surfacing | loading, not found, forbidden, degraded, no offer, no plans, conflict, saving, success, resolved | REQ-002–REQ-007 |

### Layout listy

```text
Sprawy dostawowe                         [filtry] [kolumny]
KPI: Wymaga decyzji | Czeka zewnętrznie | Zagrożone | Chronione
----------------------------------------------------------------
Priorytet | Materiał/potrzeba | Termin | Live coverage | Brak
Ryzyko    | Klient/zlecenia  | Teraz czekamy na     | Status
----------------------------------------------------------------
```

- `DataTable` zachowuje server pagination, URL state, sort i filtry.
- Domyślny priorytet: needs attention → decision required → waiting external → processing → closed; w grupie najpierw najbliższy required date.
- Kolumna coverage pokazuje **live**, np. `300/500`; baseline może być dostępny jako secondary text/tooltip, ale nie steruje kolorem wiersza.
- W narrow width najważniejsze pola tworzą stacked row: materiał/potrzeba, termin, live gap, status/next action.

### Layout detailu

```text
< Powrót   Sprawa SC-... / MAT-42 / 500 na środę       [STATUS]
[LIVE 300/500] [BRAK 200] [RYZYKO AT_RISK] [KLIENT: BREACH]

Potrzeba i wpływ                 Baseline vs aktualna rzeczywistość
- zlecenia produkcyjne           - baseline plan (kontekst)
- terminy klienta                - Supplier 1: 300 śr + 200 pt
- najwcześniejszy breach         - Supplier 2: oferta / waiting

Trzy plany resolution
( ) Plan A   ( ) Plan B   ( ) Plan C     [Wybierz plan]

Checklista potwierdzeń           Final gate
[✓/…] dostawca / ilość / data    coverage 500/500
[✓/…] dowód / ważność            PROTECTED -> [Apply] -> RESOLVED

Timeline / evidence
```

- Na desktopie sekcje są w dwóch kolumnach, ale plany i final gate zajmują pełną szerokość. Na narrow width kolejność jest liniowa: need → live reality → impact → plans → confirmations → gate → timeline.
- Recommendation agenta jest opisem pomocniczym, nigdy preselection.
- `Cmd/Ctrl+Enter` zatwierdza aktywną decyzję, jeśli jest kompletna; focus po reloadzie trafia do nagłówka, po błędzie do alertu/conflict bar.
- Wszystkie dynamiczne statusy mają tekst, nie opierają się wyłącznie na kolorze. Light/dark używają semantic/status tokens.

## Read Model and API Fields

### Lista — pola addytywne

| Field | Type | Semantics |
|---|---|---|
| `baselineCoverage` | coverage object or null | Kalkulacja z planu bazowego, tylko kontekst |
| `liveCoverage` | coverage object or null | Aktualny on-time truth; steruje gap/risk UI |
| `nextAction` | enum | `operator_decision`, `waiting_supplier`, `review_confirmations`, `apply_resolution`, `none` |
| `affectedOrderCount` | integer | Liczba podłączonych production orders |
| `earliestCustomerCommitmentDate` | timestamp/null | Najbliższy termin klienta |
| `dataQuality` | enum + reasons | `complete`, `partial`, `degraded` |

Dotychczasowe `coverage` pozostaje kompatybilne w P0, ale zostaje oznaczone jako legacy alias baseline albo live zgodnie z aktualnym zachowaniem. UI nie może używać aliasu do green state; docelowe pola są jednoznaczne.

### Detail — potrzeba, dostawcy i wpływ

| Field | Type | Semantics |
|---|---|---|
| `need` | object | `sku`, `requiredQuantity`, `requiredDate` |
| `baseline` | object/null | plan number, stock, commitments, coverage, persisted risk |
| `liveReality` | object | required/on-time/late/missing quantities, risk, `asOf`, evidence completeness |
| `suppliers[]` | array | supplier role/display/email-redacted, offer lines, evidence status, last update |
| `suppliers[].offerLines[]` | array | quantity, deliveryDate, onTime boolean, price/currency nullable, status, evidenceRef |
| `productionOrders[]` | array | existing order fields plus derived impact status |
| `customerImpact` | object | existing status/name/date plus earliest breach and affected order IDs/snapshots |

### Detail — plany, wybór, checklista i gate

| Field | Type | Semantics |
|---|---|---|
| `resolutionProposalId` | string/null | Identyfikator finalnej propozycji |
| `resolutionFactsHash` | string/null | Guard przeciw decyzji na nieaktualnych faktach |
| `resolutionPlans[]` | exactly 0 or 3 valid plans | id, label key, allocations, on-time coverage, shortage, customer impact, cost nullable, feasibility, risks |
| `selectedResolutionPlanId` | string/null | Zapisany wybór, nie domyślna selekcja UI |
| `confirmationChecklist[]` | array | requirementId, role, supplier display, quantity, deliveryDate, status, evidenceRef, confirmedAt, expiresAt, mismatchReason |
| `finalGate` | object | required, coveredOnTime, missing, confirmationsComplete, planApplicable, riskStatus, caseStatus, blockers[] |
| `availableActions[]` | enum array | addytywnie: `apply_initial_sourcing_decision`, `apply_resolution_decision`, `retry_resolution_analysis`, `apply_confirmed_resolution` |
| `updatedAt` | timestamp | Wersja optimistic locking dla każdej mutacji |

### Mutacje

| Method / command | Path / ID | Auth and feature gate | Input | Success | Errors and concurrency |
|---|---|---|---|---|---|
| existing POST | `/api/supply_cases/{id}/decision` | `supply_cases.decisions.apply` | existing initial decision payload | refetched detail | 400/403/404/409/428 |
| POST | `/api/supply_cases/{id}/resolution-decision` | `supply_cases.decisions.apply` | proposalId, factsHash, selectedPlanId, idempotencyKey | accepted/applied decision + updatedAt | 400/403/404/409/422/428 |
| POST | `/api/supply_cases/{id}/apply-resolution` | `supply_cases.resolution.apply` | selectedPlanId, idempotencyKey | gate/result + updatedAt | 403/409/422/428; fail closed on incomplete gate |

Routes są custom guarded command routes, nie `makeCrudRoute`. Każda ma Zod input/output, per-method metadata/OpenAPI, trusted scope, idempotency oraz wymagany optimistic-lock header. Jeśli istniejące Phase 3/4 command IDs lub routes różnią się nazwą, implementacja UI adaptuje się do nich zamiast tworzyć duplikaty.

## States and Actions

| State | UI emphasis | Allowed primary action |
|---|---|---|
| `AWAITING_SOURCING_DECISION` | trzy initial options | apply initial sourcing decision |
| `SENDING_ALTERNATIVE_REQUEST` | wysyłka w toku | none; safe retry tylko gdy command na to pozwala |
| `WAITING_FOR_ALTERNATIVE_OFFER` | Supplier 2 waiting + delivery evidence | none |
| `ANALYZING_CONFIRMED_OFFER` | analiza końcowa | none/retry po jawnym failure |
| `AWAITING_RESOLUTION_APPROVAL` | trzy resolution plans | apply resolution decision |
| `SENDING_PLAN_ACCEPTANCE` | wybrany plan i komunikacja | none |
| `WAITING_FOR_SUPPLIER_CONFIRMATIONS` | checklist + braki | none; retry/resend tylko jako jawna domenowa akcja |
| `APPLYING_RESOLUTION` | final gate/apply progress | none |
| `PROTECTED` gate met | zielony gate, jeszcze audyt apply jeśli potrzebny | apply confirmed resolution |
| `RESOLVED` | immutable success summary | none |
| `NEEDS_ATTENTION` | konkretna przyczyna i recovery | dozwolona akcja zależna od reason |

## ACL, i18n, Optimistic Locking and Audit

- Odczyt wymaga `supply_cases.view`; treść wiadomości/evidence respektuje `supply_cases.view_messages` i pozostaje zredagowana bez feature.
- Initial/final decisions wymagają `supply_cases.decisions.apply`; apply może użyć addytywnego `supply_cases.resolution.apply` zgodnie z finalnym kontraktem Phase 4.
- Wszystkie teksty, enumy, błędy, etykiety planów, statusy checklisty i blockery final gate używają `supply_cases.*` w pięciu istniejących locale; API zwraca machine enums, nie przetłumaczone teksty.
- Każda mutacja wysyła wersję z detail `updatedAt`; brak nagłówka daje `428`, stale write daje typed `409`, conflict bar oraz refetch. Po refetch wybór nie jest automatycznie ponawiany.
- Guarded mutations blokują duplicate submit i zachowują idempotency key. Wybór operatora, proposal/facts hash, actor, timestamp i wynik gate są audytowalne.

## Edge Cases, Errors and Degraded States

| Condition | User-visible behavior | Safety rule |
|---|---|---|
| Brak production plan | warning + baseline unavailable | live state nie dziedziczy green |
| Brak części production orders | warning z liczbą brakujących referencji | decyzja może być zablokowana, jeśli wpływ jest niepełny |
| Supplier 2 bez oferty | waiting state i dowód RFQ | brak pustej karty udającej ofertę |
| Nieczytelna oferta/proposal | degraded alert, evidence ref, retry jeśli bezpieczny | planów nie można wybrać |
| `resolutionPlans.length !== 3` | błąd kontraktu, żadnej mutacji | fail closed |
| `confirmationChecklist` pusta przed wyborem | neutral not-applicable | nie sugeruje ukończenia |
| `confirmationChecklist` pusta po wyborze | degraded/blocker | final gate false |
| Phase 3 plan nie pasuje do Phase 4 contract | `unreadable_plan` blocker | żadnego apply i żadnego green |
| Wygasłe/odrzucone/mismatched confirmation | jawny status i brakująca ilość | nie wlicza do live confirmed coverage |
| Baseline 500/500, live 300/500 | baseline neutral; live warning/error `300/500` | final status nie może być `PROTECTED` |
| Duplicate click/replay | loading/disabled, potem ten sam rezultat | jeden logiczny efekt |
| 409 conflict | shared conflict bar + refetch | operator ponownie ocenia aktualne trzy plany |
| 403/404 | standard AccessDenied/NotFound | brak wycieku istnienia cross-tenant |
| API/network error | ErrorMessage/Alert + safe retry | nie zmienia lokalnie statusu na sukces |
| Live provider/mail unavailable | banner degraded z ostatnim wiarygodnym `asOf` | brak symulowanego dowodu w production UI |

## Security, Privacy, and Compliance

- Supplier/customer PII i treści wiadomości są zwracane minimalnie i zgodnie z osobnym feature; lista preferuje display snapshots i redacted addresses.
- Evidence references nie mogą ujawniać raw RFC content ani cross-tenant IDs.
- `factsHash`, proposal/plan ID oraz `updatedAt` zapobiegają zastosowaniu decyzji do zmienionego stanu.
- Final apply jest re-entrant, zapisuje target state zamiast delt i ustawia sprawę jako ostatni zapis; każda przerwa pozostawia stan non-green.

## Test Matrix

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirements |
|---|---|---|---|---|---|
| CT-001 | API/read model | demo `MAT-42`, need 500 Wednesday; S1 300 Wed + 200 Fri | GET list/detail | live `300/500`, shortage 200; baseline osobno; Friday line nie liczy się on-time | REQ-001, REQ-002 |
| CT-002 | UI | fixture CT-001 | open list and detail | list/detail pokazują live gap, ryzyko i rozdzielony baseline | REQ-001, REQ-002 |
| CT-003 | API/read model | two production orders and customer dates | GET detail | pełna lista orders, earliest commitment/breach, missing refs degraded | REQ-003 |
| CT-004 | API | valid Supplier 2 offer + Phase 3 output | GET detail | dokładnie 3 valid resolution plans, allocations i impacts | REQ-004 |
| CT-005 | UI | three plans, no prior choice | keyboard select + submit | no preselection; Cmd/Ctrl+Enter; one guarded mutation | REQ-004, REQ-007 |
| CT-006 | concurrency | two operators, same updatedAt | submit different final choices | exactly one succeeds; second gets typed 409 and refetch | REQ-004, REQ-007 |
| CT-007 | API/read model | selected plan + partial confirmations | GET detail | checklist statuses and blockers; gate not protected | REQ-005, REQ-006 |
| CT-008 | E2E | S1 300 Wed confirmed + S2 200 Wed confirmed | choose/apply plan | `500/500 → PROTECTED → RESOLVED`, one logical apply | REQ-005, REQ-006 |
| CT-009 | negative gate | baseline 500/500, live 300/500 | GET/apply | UI non-green; apply returns 422; case not resolved | REQ-002, REQ-006 |
| CT-010 | adapter failure | Phase 3 plan incompatible with Phase 4 contract | GET/apply | `unreadable_plan`, empty/degraded checklist, no green/apply | REQ-005, REQ-006 |
| CT-011 | ACL/security | viewer, operator, second tenant | read/mutate | viewer cannot mutate; operator scoped; second tenant 404/403 without leak | REQ-007 |
| CT-012 | UI states | loading/empty/403/404/500/409/degraded | exercise routes | canonical states, safe retry, focus announcement | REQ-007 |
| CT-013 | accessibility/theme | desktop+narrow, light+dark | keyboard/screen reader flow | logical order, labeled controls, status not color-only, no overflow | REQ-001–REQ-007 |
| CT-014 | idempotency/restart | accepted final decision and interrupted apply | replay/restart | no duplicate outbound/effects; non-green until successful final commit | REQ-006, REQ-007 |

All fixtures are self-contained, scoped and cleaned up. Browser tests use real API paths, not component mocks.

## Implementation Status

Source doc: `.ai/specs/2026-09-19-supply-operations-control-tower-ui.md`

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| P0 — Truthful read model and control-tower comprehension | verified | Existing scoped repositories and Phase 2 read contracts | REQ-001, REQ-002, REQ-003, read-only REQ-007 | `yarn test --runInBand src/modules/supply_cases`; focused Playwright read-only, accessibility and failure-state specs | Local fixture gate passes; live provider/RFQ evidence remains an external rollout prerequisite |
| P1 — Final decision, confirmations and protected resolution | in_progress | Phase 3 final command and Phase 4 plan adapter/apply | REQ-004–REQ-007 | `read-model.test.ts` covers three plans, no preselection, partial/full confirmation gate | Blocked from completion: no registered guarded `resolution.apply_decision` route and Phase 3→4 adapter is not available |

### P0 progress

- [x] Additive operational read model and scoped projection: `data/read-model.ts`, including baseline/live coverage, shortage, supplier evidence, customer/production impact and degraded reasons — `yarn test --runInBand src/modules/supply_cases/__tests__/read-model.test.ts` passed
- [x] Control-tower list/detail surfaces: `SupplyCasesTable.tsx`, `SupplyCaseDetail.tsx`, semantic tokens, translated states and authoritative server gate — focused Playwright read-only, accessibility and failure-state specs passed
- [x] Regression coverage for baseline `500/500` vs live Supplier 1 `300/500`, shortage `200`, PO-1001 and customer deadline — `yarn test --runInBand src/modules/supply_cases` passed

### P1 progress

- [x] Read-only projection of a valid Supplier 2 offer, exactly three typed plans, no initial selection, and confirmation checklist/gate when durable confirmation records exist — `yarn test --runInBand src/modules/supply_cases/__tests__/read-model.test.ts` passed
- [ ] IN FLIGHT: final plan selection/apply and full browser decision flow — files: `src/modules/supply_cases/data/read-model.ts`, `src/modules/supply_cases/components/SupplyCaseDetail.tsx`; last command: `yarn test --runInBand src/modules/supply_cases` passed; remaining: backend `supply_cases.resolution.apply_decision` route, Phase 3→4 adapter and final apply contract

## Priorities and Implementation Phases

### P0 — Truthful read model and control-tower comprehension

- **Depends on:** Phase 2 contract stable and its accepted decision route preserved; formal rollout waits for Phase 2 exit gate.
- **Outcome:** lista/detail zawsze rozdzielają baseline od live reality i pokazują need, suppliers, production/customer impact oraz degraded states.
- **Deliverables:** addytywne read-model/API fields, list columns/filters, reorganized detail layout, Supplier 2 offer projection when available, translations and read-only UI tests.
- **Requirements closed:** REQ-001, REQ-002, REQ-003 oraz read-only część REQ-007.
- **Tests:** CT-001–CT-003, CT-011–CT-013.
- **Exit gate:** demo pokazuje `500 MAT-42 Wednesday`, S1 `300 Wednesday + 200 Friday`, live `300/500` i shortage `200`; baseline nigdy nie zmienia tego w green.

### P1 — Final decision, confirmations and protected resolution

- **Depends on:** P0; Phase 3 final offer analysis + exactly-three `resolutionPlans`; Phase 4 adapter from `resolutionPlanSchema` to `ConfirmationPlanContract`; Phase 4 confirmation join/apply; addytywne `COVERAGE_SHORTFALL` semantics.
- **Outcome:** operator wybiera jeden z trzech planów, śledzi potwierdzenia i kończy sprawę tylko przez final gate.
- **Deliverables:** final plan cards, guarded final-decision/apply actions, checklist projection, final gate, conflict/retry UX, audit and E2E coverage.
- **Requirements closed:** REQ-004–REQ-007.
- **Tests:** CT-004–CT-014.
- **Exit gate:** pełny scenariusz realnie przechodzi `500/500 → PROTECTED → RESOLVED`; wszystkie negatywne gate tests pozostawiają sprawę non-green.

### Zależności od istniejących faz domenowych

| Dependency | Required contract | UI behavior before dependency is ready |
|---|---|---|
| Phase 2 — initial impact / sourcing decision | real Supplier 2 RFQ flow, stable initial decision and delivery evidence | obecny initial panel działa; offer pokazuje waiting/degraded |
| Phase 3 — confirmed offer / final resolution proposal | validated Supplier 2 offer, final analysis, exactly 3 `resolutionPlans`, proposal/facts hash | sekcja planów unavailable; brak fake cards |
| Phase 4 — confirmation join | adapter plan contract, populated checklist, confirmation statuses, safe apply and coverage-shortfall reason | checklist degraded/unreadable; final gate zablokowany |

Phase 3 nie może być omijana tylko dlatego, że część Phase 4 została zbudowana wcześniej. P1 rozpoczyna się dopiero po domknięciu wymienionych kontraktów i exit gates.

## Requirement Traceability

| Requirement | Journey / surface | Data/API contract | Priority | Tests | Acceptance |
|---|---|---|---|---|---|
| REQ-001 | J-001 / list | list control-tower fields | P0 | CT-001, CT-002, CT-013 | AC-001 |
| REQ-002 | J-001 / detail | baseline + liveReality + suppliers | P0 | CT-001, CT-002, CT-009 | AC-002 |
| REQ-003 | J-001 / detail | productionOrders + customerImpact | P0 | CT-003 | AC-003 |
| REQ-004 | J-002 / detail | resolution plans + decision command | P1 | CT-004–CT-006 | AC-004 |
| REQ-005 | J-003 / detail | confirmationChecklist | P1 | CT-007, CT-010 | AC-005 |
| REQ-006 | J-003 / gate | finalGate + apply command | P1 | CT-008–CT-010, CT-014 | AC-006 |
| REQ-007 | all | ACL/i18n/updatedAt/idempotency | P0/P1 | CT-005, CT-006, CT-011–CT-014 | AC-007 |

## Rollout, Migration, and Rollback

- API additions są addytywne; nie usuwać istniejącego `coverage` ani current detail fields w tym samym wydaniu.
- P0 można wdrożyć z sekcjami P1 ukrytymi przez capability/availableActions, nie przez ręczny feature guess.
- P1 aktywuje się dopiero, gdy read model potwierdza dostępność Phase 3/4 contracts.
- Rollback UI usuwa ekspozycję nowych akcji, ale nie cofa decyzji domenowych ani potwierdzeń; istniejąca read-only strona pozostaje dostępna.
- Nie uruchamiać migracji lokalnie bez osobnej zgody. Ta specyfikacja nie wymaga nowej encji supplier PO.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Baseline/live semantic drift | Fałszywie zielona sprawa | osobne typy/pola + CT-001/009 | legacy `coverage` wymaga okresu kompatybilności |
| Phase 3/4 shape mismatch | Nieczytelna checklista | jawny adapter i CT-010 | P1 zablokowane do gotowości adaptera |
| Jeden ekran ma dużo danych | Przeciążenie operatora | hierarchia KPI, dwie kolumny, progressive sections | długi timeline wymaga zwijania/paginacji później |
| Supplier PO poza zakresem | Brak pełnego procurement ledger | jawne etykiety commitments/evidence | ręczne działania poza systemem pozostają możliwe |
| Concurrent operators | Sprzeczny wybór | optimistic lock + factsHash + 409 UX | konieczna ponowna ocena po refetch |
| Live transport unavailable | Nieaktualne fakty | `asOf`, degraded banner, fail closed | operator może potrzebować eskalacji poza systemem |

## Acceptance Criteria

- [ ] **AC-001** — lista pokazuje dla scenariusza referencyjnego `MAT-42`, potrzebę 500 na środę, live `300/500`, brak 200, ryzyko i bieżące oczekiwanie.
- [ ] **AC-002** — detail pokazuje baseline i live reality jako dwa różne bloki; Supplier 1 `300 środa + 200 piątek` nie daje zielonego `500/500` na środę.
- [ ] **AC-003** — operator widzi wszystkie powiązane zlecenia produkcyjne, ich terminy oraz najbliższy termin/ryzyko klienta; brakujące referencje są jawne.
- [ ] **AC-004** — po ważnej ofercie Supplier 2 widoczne są dokładnie trzy plany resolution, bez preselection; tylko uprawniony operator może wybrać jeden plan.
- [ ] **AC-005** — po wyborze planu checklista zawiera wszystkie wymagane potwierdzenia wraz ze statusem, ilością, datą i dozwolonym dowodem; nie jest pusta bez wyjaśnienia.
- [ ] **AC-006** — jedyną zieloną ścieżką końcową jest `live 500/500`, komplet ważnych potwierdzeń, `PROTECTED`, atomowy apply i `RESOLVED`; partial, expired, mismatch i unreadable plan pozostają non-green.
- [ ] **AC-007** — wszystkie nowe odczyty/mutacje są tenant/org scoped, feature-gated, zlokalizowane, idempotentne i chronione optimistic lockingiem z obsługą `428/409`.
- [ ] Obie strony używają kanonicznych komponentów, shared API helpers, semantic tokens i mają loading, empty/not-applicable, error, conflict, forbidden, degraded, responsive, keyboard, light i dark states.
- [ ] Wszystkie API/UI paths mają self-contained coverage z macierzy CT-001–CT-014.

## Source of Truth / Evidence

- Cel biznesowy mówi wprost, że green success jest dopiero po wymaganych potwierdzeniach i pełnym pokryciu, a scenariusz docelowy to `500/500 → PROTECTED → RESOLVED`: `manufacturer-app/.ai/IMPLEMENTATION_STATUS.md:7-11`.
- Obecna Phase 2 definiuje referencyjne `300/500`, shortage `200`, breach w piątek, dokładnie trzy initial options oraz guarded decision z `428/409`: `manufacturer-app/.ai/IMPLEMENTATION_STATUS.md:59-73`.
- Pełny supplier PO nie istnieje w tym slice; aktualna implementacja operuje production planem i supplier commitments: `manufacturer-app/src/modules/supply_cases/data/read-model.ts:85-95`, `408-418`.
- Detail schema zna jedynie liczbę resolution plans, nie zwraca samych planów; `confirmationChecklist` ma typ pusty (`z.never()`), a jedyną akcją jest initial sourcing decision: `manufacturer-app/src/modules/supply_cases/data/read-model.ts:145-179`.
- Projekcja odczytu liczy resolution plans wyłącznie do `resolutionPlanCount`, ustawia `confirmationChecklist: []` i udostępnia tylko `apply_initial_sourcing_decision`: `manufacturer-app/src/modules/supply_cases/data/read-model.ts:373-443`.
- Obecne coverage pochodzi bezpośrednio z production planu, więc nie reprezentuje automatycznie najnowszej live proposal: `manufacturer-app/src/modules/supply_cases/data/read-model.ts:258-278`.
- Obecny UI pokazuje jeden wspólny coverage/missing/risk oraz production orders, plan i commitments: `manufacturer-app/src/modules/supply_cases/components/SupplyCaseDetail.tsx:47-124`.
- Obecny UI pokazuje tylko counts dla proposals i renderuje wyłącznie `InitialDecisionPanel`: `manufacturer-app/src/modules/supply_cases/components/SupplyCaseDetail.tsx:127-135`, `160-240`.
- Obecna initial mutation już używa guarded mutation i optimistic-lock header, co jest wzorcem dla final decision: `manufacturer-app/src/modules/supply_cases/components/SupplyCaseDetail.tsx:165-200`.
- Phase 4 confirmation join istnieje, ale brakuje adaptera z Phase 3 plan shape, `COVERAGE_SHORTFALL` i workflow wait step; realny plan jest dziś `unreadable_plan` i inert: `manufacturer-app/.ai/IMPLEMENTATION_STATUS.md:135-156`.
- Status wdrożenia nakazuje nie kontynuować Phase 3–5 przed zamknięciem live provider/RFQ evidence: `manufacturer-app/.ai/IMPLEMENTATION_STATUS.md:87-94`, `106-112`.
- Poprzednia specyfikacja UI pozostaje źródłem istniejącej list/detail i jej bazowych standardów; niniejszy dokument jest addytywną specyfikacją control-tower, nie zastępuje historii Phase 1: `manufacturer-app/.ai/specs/2026-09-18-supply-cases-ui.md:1-522`.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable instructions and routed spec/UI guides reviewed | pass | `manufacturer-app/AGENTS.md`, `.agents/skills/om-spec-writing/SKILL.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/backend-ui.md` |
| Data, API, states, UI and tests internally consistent | pass | REQ-001–007 and traceability table |
| Workflow completes without catch-all integration phase | pass | P0 and P1 have explicit domain dependencies and exit gates |
| Platform-native reuse chosen before custom code | pass | existing list/detail, guarded commands, workflow, read model and confirmation join reused |
| UI contracts identify components and full state coverage | pass | UI and Interaction Contracts + CT-012/013 |
| Every phase has dependencies, tests, value and observable exit gate | pass | P0/P1 sections |

**Verdict: Ready for implementation.** Readiness oznacza kompletność kontraktu. Faktyczne rozpoczęcie P0/P1 pozostaje podporządkowane wskazanym exit gates Phase 2/3/4.

## Open Questions

N/A — brief rozstrzyga scope, jeden ekran, trzy plany, final gate, non-goals i wymagane zależności. Nazwy finalnych Phase 3/4 route/command IDs należy zaadaptować z implementowanych kontraktów, bez tworzenia duplikatów.

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial specification for the supply operations control tower UI |
| 2026-09-19 | Implemented P0 control-tower projection and UI; added typed Supplier 2/plan/confirmation projections with fail-closed P1 dependency state and regression coverage |
| 2026-09-19 | Corrected live coverage to count only current supplier evidence and matching confirmations; resolution plans remain read-only while the Phase 3/4 command adapter is blocked; green messaging now renders server-provided quantities |
