# UI spraw dostawowych dla manufacturer-app

**Data**: 2026-09-18  
**Status**: In progress — Phase 1 read-only slice and browser matrix implemented; formal exit gate remains open
**Parent spec**: `.ai/specs/2026-09-18-supplier-email-agent-workflow.md`  
**Data/store spec**: `.ai/specs/2026-09-18-supply-cases-local-json-store.md`

## TLDR

Powstają dwa backendowe widoki operacyjne modułu `supply_cases`: lista `/backend/supply-cases` oraz szczegóły `/backend/supply-cases/[id]`. Pokazują istniejące dane o sprawie dostawowej, zleceniu produkcyjnym, planie materiałowym, wiadomościach, analizach agenta i potwierdzeniach, a decyzje użytkownika przekazują do Caseload/workflow/commands będących właścicielem procesu. UI nie staje się systemem MRP i nie zapisuje statusów ani planów bezpośrednio.

## Problem Statement

Obecny moduł ma model i lokalny store dla `ProductionOrder`, `ProductionPlan`, `SupplyCase`, `InboundMessage` i `OutboundCorrelation`, obliczanie pokrycia oraz część inbound triage. Brakuje stron backendowych i API read modeli, więc operator nie może zobaczyć kolejki wyjątków dostawowych ani prześledzić, dlaczego produkcja jest zagrożona i czego workflow oczekuje.

Użytkownikiem jest planista materiałowy, buyer lub operator zaopatrzenia pracujący w obrębie jednej organizacji. Potrzebuje odpowiedzieć na trzy pytania: co jest zagrożone, jaka decyzja jest teraz wymagana oraz czy wybrany plan został potwierdzony i rzeczywiście zabezpiecza termin klienta.

## Overview and Success Measures

- **Cel demo:** pokazać scenariusz `SC-001` od propozycji Supplier 1 przez brak `200` jednostek, wybór dostawcy alternatywnego i dwa potwierdzenia do wyniku `500/500`, `PROTECTED`, `RESOLVED`.
- **Primary outcome:** operator w maksymalnie dwóch kliknięciach od wejścia do backendu rozpoznaje sprawę wymagającą działania i otwiera jej pełny kontekst.
- **Leading indicators:** lista pokazuje aktualny etap i brakującą ilość; szczegóły pokazują spójne pokrycie, oczekiwaną decyzję oraz checklistę potwierdzeń.
- **Baseline:** obecnie brak powierzchni UI i brak publicznych read routes dla tego modułu.
- **Market / product reference:** przyjmujemy wzorzec control tower / exception management: kolejka odchyleń i jeden ekran dochodzenia do decyzji. Odrzucamy rozbudowę typową dla MRP/APS, ponieważ źródłem wartości demo jest obsługa wyjątku, nie harmonogramowanie całej fabryki.

## Goals

- **REQ-001** — uprawniony operator widzi stronicowaną, filtrowalną i sortowalną listę spraw wyłącznie ze swojej organizacji.
- **REQ-002** — operator widzi szczegóły sprawy wraz z kontekstem `ProductionOrder`, `ProductionPlan`, wyliczonym pokryciem i wpływem na klienta.
- **REQ-003** — operator widzi chronologiczną historię wiadomości, analiz agenta, propozycji, decyzji i zmian etapu bez ujawniania surowych danych technicznych jako głównego interfejsu.
- **REQ-004** — decyzje są wykonywane wyłącznie przez istniejący model Caseload/workflow/command ownership; UI nie zapisuje domeny ani statusu bezpośrednio.
- **REQ-005** — szczegóły pokazują wymagane potwierdzenia i końcowy stan pokrycia, a stan zielony pojawia się dopiero po spełnieniu safety gate parent speca.
- **REQ-006** — oba widoki obsługują pełne stany jakościowe, ACL, i18n, dostępność, semantic status tokens i konflikty optimistic locking.

## Non-goals

- Pełny MRP lub APS.
- BOM-y, marszruty, operacje, stanowiska robocze i capacity planning.
- Kalendarz lub Gantt produkcyjny.
- Osobny CRUD zleceń produkcyjnych lub planów produkcyjnych.
- Edycja ilości, terminów, zobowiązań dostawców lub wiadomości bezpośrednio w UI.
- Nowe encje, migracje lub duplikowanie danych istniejących rekordów.
- Budowa brakujących agentów, workflow i komend z Phase 2–4 parent speca w ramach tej specyfikacji; UI jedynie definiuje kontrakt ich prezentacji i wywołania.
- Administracyjny seed/reset scenariusza w UI produkcyjnym.

## Proposed Solution

Lista jest lekką kolejką wyjątków opartą o `DataTable`. Szczegóły są read-only workspace’em z sekcjami domenowymi i kontekstowymi akcjami. API składa read modele z istniejących repozytoriów, a pokrycie liczy przez `calculatePlanCoverage`; nie utrwala pól pochodnych. Mutacje operatorskie wywołują komendy parent speca albo przekierowują do Caseload, zależnie od tego, gdzie znajduje się aktywna propozycja.

### Design Decisions and Alternatives

| Decyzja | Uzasadnienie | Alternatywa | Dlaczego odrzucona / odłożona |
|---|---|---|---|
| Jedna lista wyjątków i jeden ekran szczegółu | Najkrótsza droga od sygnału do decyzji | Osobne UI produkcji, planowania i dostaw | Duplikuje kontekst i rozszerza zakres do MRP |
| Read modele składane po stronie API | Jeden spójny, scoped snapshot dla UI | Wiele wywołań z przeglądarki do repozytoriów | Ryzyko niespójnych wersji i nadmiar coupling |
| `DataTable` dla listy | Canonical backend primitive z filtrowaniem, sortowaniem i paginacją | Własna tabela | Powiela standardy i stany jakościowe |
| Custom detail page zamiast `CrudForm` | Ekran służy do decyzji procesowej, nie edycji encji | Formularz edycji `SupplyCase` | Pozwalałby ominąć workflow i command ownership |
| Decyzje przez Caseload/commands | Zachowuje audyt, workflow, idempotency i safety gates | `PATCH SupplyCase` | Bezpośredni zapis łamie parent spec |
| Timeline projekcyjny | Łączy istniejące fakty bez nowej encji historii | Nowa tabela timeline | Duplikowałaby historię i wymagała synchronizacji |

## Domain Vocabulary and Business Rules

| Termin / invariant | Znaczenie | Źródło prawdy | Zachowanie przy błędzie |
|---|---|---|---|
| Sprawa dostawowa | `SupplyCase`, pojedynczy wyjątek dostawy | `supplyCases` repository | Brak w scope daje 404 bez ujawniania istnienia |
| Pokrycie | `min(internalStock + COMMITTED/CONFIRMED do requiredDate, requiredQuantity)` | `calculatePlanCoverage` | Brak planu pokazuje „Brak planu”, nie wartość domyślną |
| Brakująca ilość | `max(requiredQuantity - coveredQuantity, 0)` | `calculatePlanCoverage` | Nigdy ujemna |
| Ryzyko | `PROTECTED`, `AT_RISK`, `BREACHED` | wynik pokrycia; persisted `riskStatus` jest prezentowany tylko po sprawdzeniu zgodności | Rozjazd jest błędem danych/telemetrii, UI ufa wynikowi pochodnemu |
| Bieżące oczekiwanie | Etykieta wyprowadzona z `SupplyCase.status` | zamknięta mapa statusów | Nieznany status renderuje bezpieczny fallback i raportuje błąd |
| Decyzja | Dyspozycja proposal w Caseload lub komenda parent speca | agent proposal + workflow + command bus | Brak aktywnej propozycji wyłącza akcję |
| Potwierdzenie | Dowód zgodny z wybranym immutable planem | `supplier1ConfirmedAt`, `supplier2ConfirmedAt` i pending plan | Mismatch/timeout pozostaje non-green i przechodzi do `NEEDS_ATTENTION` |
| Finalny sukces | `coverage=required`, risk `PROTECTED`, case `RESOLVED` po `apply_confirmed` | workflow/commands + read model | UI nie może wywnioskować `RESOLVED` wyłącznie z ilości |

Statusy grupujemy wyłącznie prezentacyjnie:

- **Do decyzji:** `AWAITING_SOURCING_DECISION`, `AWAITING_RESOLUTION_APPROVAL`, `NEEDS_ATTENTION`.
- **W toku / system pracuje:** `RECEIVED`, `ANALYZING_INITIAL_IMPACT`, `SENDING_ALTERNATIVE_REQUEST`, `ANALYZING_CONFIRMED_OFFER`, `SENDING_PLAN_ACCEPTANCE`, `APPLYING_RESOLUTION`.
- **Oczekiwanie zewnętrzne:** `WAITING_FOR_ALTERNATIVE_OFFER`, `WAITING_FOR_SUPPLIER_CONFIRMATIONS`.
- **Zamknięte:** `RESOLVED`, `REJECTED`, `CANCELLED`.

Grupa nie jest zapisywana w domenie i nie zastępuje pełnego statusu.

## Users, Permissions, and Scope

| Aktor | Dozwolone rezultaty | Scope | Feature IDs |
|---|---|---|---|
| Viewer / manager produkcji | lista i szczegóły bez treści wiadomości | trusted tenant + selected organization | `supply_cases.view` |
| Operator wiadomości | jak wyżej oraz sanitized message timeline | trusted tenant + selected organization | `supply_cases.view`, `supply_cases.messages.view` |
| Decision maker | dyspozycja aktywnych proposal i dozwolone retry/cancel | trusted tenant + selected organization | `supply_cases.view`, `supply_cases.decisions.apply`; akcje naprawcze dodatkowo `supply_cases.manage` |

Istniejący `acl.ts` definiuje te cztery features. List route, detail route i każda mutacja samodzielnie egzekwują metadata auth/features; ukrycie przycisku nie jest zabezpieczeniem. `tenantId` i `organizationId` pochodzą wyłącznie z kontekstu uwierzytelnionego. Brak któregokolwiek zakresu kończy żądanie fail-closed. Wildcard grants muszą działać zgodnie z frameworkiem.

## Reuse and Ownership Map

| Capability | Decyzja | Właściciel | Seam | Uzasadnienie |
|---|---|---|---|---|
| Case/order/plan/message data | reuse | `supply_cases` | istniejące repository interfaces | Brak nowych encji |
| Coverage | reuse | `supply_cases/data/coverage.ts` | funkcja pochodna | Jedna formuła domenowa |
| Lista | app-owned UI | `supply_cases` | `DataTable` | Moduł posiada dane i ACL |
| Szczegóły | app-owned UI | `supply_cases` | backend page + read model | Spójny widok agregatu |
| Proposals/analyses | reuse/read projection | agent/workflow/Caseload | proposal identifiers i statusy | UI nie przejmuje dyspozycji |
| Decisions | reuse | Caseload/workflow/commands | command bus / Caseload route | Audyt i safety gates pozostają u właściciela |
| Outbound delivery facts | reference only | `communication_channels` w docelowym przebiegu | korelacja/identyfikator | Moduł nie tworzy własnej historii transportu |

## Architecture and Data Flow

```text
operator -> /backend/supply-cases -> GET list read model
                                   -> scoped repositories + calculatePlanCoverage

operator -> /backend/supply-cases/[id] -> GET detail read model
                                        -> case + orders + plan + inbound messages
                                        -> projected timeline + decision/checklist state

operator decision -> Caseload disposition or guarded command route
                  -> workflow/command owner
                  -> repository changes/events
                  -> refetch detail read model
```

- **Module boundary:** wszystko pozostaje w `src/modules/supply_cases`; UI nie tworzy relacji ORM do innych modułów.
- **Navigation:** tylko lista jest pozycją menu. Detail ma `navHidden: true` i breadcrumb z `correlationId`.
- **Compatibility:** nowe strony i API są addytywne. Nazwy istniejących encji, statusów, ACL i komend nie są zmieniane.
- **Stan faktyczny na 2026-09-18:** istnieją repository contracts, JSON store, fixtures, coverage, ACL, tłumaczenia statusów i `supply_cases.inbound.apply_triage`. Nie istnieją jeszcze strony, list/detail API ani komendy decyzji Phase 2–4. Kontrakty niżej są wymaganiami do dodania, nie opisem gotowej funkcjonalności.

## User Journeys

### Journey J-001 — Znalezienie sprawy wymagającej działania

1. Operator otwiera „Sprawy dostaw”.
2. Domyślnie widzi sprawy aktywne, najpierw `NEEDS_ATTENTION` i decyzje oczekujące, potem najstarszy termin wymagany.
3. Filtruje po statusie, ryzyku, SKU, numerze sprawy lub zleceniu.
4. Otwiera `SC-001` przez link numeru albo akcję wiersza.

### Journey J-002 — Ocena wpływu i pierwsza decyzja

1. Szczegóły pokazują `PO-1001`, `PP-2001`, termin klienta, propozycję `300 Wed / 200 Fri` i wyliczony brak `200` na wymagany termin.
2. Operator czyta analizę i trzy opcje z aktywnego proposal.
3. Wybiera „Sprawdź alternatywnego dostawcę” w Caseload lub przez zatwierdzony command surface.
4. Widok przechodzi do `WAITING_FOR_ALTERNATIVE_OFFER`; Supplier 2 nie jest kontaktowany przed tą decyzją.

### Journey J-003 — Wybór planu i potwierdzenia

1. Po ofercie Supplier 2 operator widzi ponowną analizę i kompletne plany.
2. Wybiera plan pokrywający brakujące `200` na środę.
3. Widok pokazuje checklistę wymaganych potwierdzeń Supplier 1 i Supplier 2.
4. Po pierwszym potwierdzeniu stan pozostaje non-green; po drugim workflow wykonuje safety gate.
5. Dopiero finalny read model pokazuje `500/500`, `PROTECTED`, `RESOLVED` i termin klienta „niezagrożony”.

### Journey J-004 — Błąd, konflikt lub brak uprawnień

1. Użytkownik bez `view` dostaje 403/standard permission state i nie widzi pozycji menu.
2. Użytkownik bez `messages.view` widzi timeline bez treści wiadomości.
3. Stara dyspozycja z nieaktualnym `updatedAt` zwraca 409; UI pokazuje unified conflict bar i umożliwia odświeżenie.
4. Timeout, delivery failure lub confirmation mismatch pokazuje reason, zachowane dowody oraz tylko dozwolone akcje naprawcze.

## UI and Interaction Contracts

| Surface / route | Cel i akcje | Źródło danych / mutacje | Najbliższy wzorzec | Canonical components | Stany | REQ |
|---|---|---|---|---|---|---|
| `/backend/supply-cases` | kolejka, filtry, sort, przejście do szczegółu | nowy `GET /api/supply-cases`; bez mutacji | example backend todos list | `Page`, `PageHeader`, `PageBody`, `DataTable`, `RowActions`, `StatusBadge` | loading, empty, error, permission | 001, 006 |
| `/backend/supply-cases/[id]` | kontekst, decyzje, timeline, checklist, final status | nowy `GET /api/supply-cases/{id}`; Caseload/command mutations | shared detail/section/message families | `Page`, `PageHeader`, `PageBody`, detail sections, `Alert`, `StatusBadge`, guarded actions | loading, not found, error, conflict, permission, terminal | 002–006 |

### Lista `/backend/supply-cases`

```text
Sprawy dostaw                              [Odśwież]
[Szukaj: SC / PO / SKU / dostawca] [Status] [Ryzyko] [Termin] [Wymaga decyzji]
-------------------------------------------------------------------------
Sprawa | Status | SKU | Zlecenie | Termin | Pokrycie | Brak | Ryzyko | Oczekuje na
SC-001 | ...    | MAT-42 | PO-1001 | śr. | 300/500 | 200 | AT_RISK | Decyzję
```

#### Dokładne kolumny

1. `correlationId` — link do detail; stabilny identyfikator biznesowy.
2. `status` — pełny `SupplyCaseStatus` przez `StatusBadge`.
3. `sku` — `SupplyCase.sku`.
4. `productionOrders` — numery zamówień rozwiązane z `productionOrderIds`; przy wielu: pierwszy + licznik, bez raw ID.
5. `requiredDate` — data/godzina w locale użytkownika.
6. `coverage` — `coveredQuantity/requiredQuantity`; „Brak planu”, gdy `productionPlanId` jest null lub plan nie istnieje.
7. `missingQuantity` — liczba z `calculatePlanCoverage`; brak wartości przy braku planu.
8. `riskStatus` — `PROTECTED/AT_RISK/BREACHED` z pochodnego coverage.
9. `currentWait` — lokalizowana etykieta z mapy statusu, np. „Decyzja sourcingowa”, „Oferta Supplier 2”, „Potwierdzenia dostawców”, „Brak”.
10. `updatedAt` — względny czas z dostępną pełną datą; domyślny tie-break sortowania.
11. akcja wiersza `open` o stabilnym ID `supply_cases:cases:open`.

#### Filtry i wyszukiwanie

- tekst `q`: prefix/substring po `correlationId`, `sku`, numerze zlecenia oraz e-mailu dostawcy; server-side, scoped;
- `status`: multi-select dokładnych `SupplyCaseStatus`;
- `riskStatus`: `PROTECTED`, `AT_RISK`, `BREACHED`, `NO_PLAN`;
- `attention`: `decision_required`, `needs_attention`, `waiting_external`, `active`, `closed`;
- `requiredFrom`, `requiredTo`: zakres `requiredDate`;
- opcjonalny `supplierEmail`: normalizowany, bez ujawniania wyników spoza scope.

#### Sortowanie i paginacja

- domyślne: `attentionRank asc`, `requiredDate asc`, `updatedAt desc`;
- dozwolone sorty: `correlationId`, `status`, `sku`, `requiredDate`, `missingQuantity`, `riskStatus`, `updatedAt`;
- server-side pagination, domyślnie 25, opcje 25/50/100, nigdy powyżej 100;
- URL przechowuje filtry, sort i stronę, aby powrót ze szczegółu zachował kolejkę.

#### Stany listy

- **Loading:** shell i nagłówek pozostają widoczne, `DataTable.isLoading`; bez fałszywego „brak danych”.
- **Empty — brak spraw:** wyjaśnienie, że sprawy pojawią się po przyjęciu i sklasyfikowaniu wiadomości; bez przycisku tworzenia ręcznego.
- **Empty — brak wyników filtrów:** przycisk „Wyczyść filtry”.
- **Error:** `ErrorMessage`, bez danych z poprzedniego scope; bezpieczne „Spróbuj ponownie”.
- **Permission:** standardowe 403; menu nie jest widoczne bez feature, ale direct route nadal egzekwuje ACL.
- **Conflict:** nie dotyczy odczytu listy; po konflikcie decyzji i powrocie lista odświeża rekord.

### Szczegóły `/backend/supply-cases/[id]`

```text
< Sprawy dostaw     SC-001    [Status: ...] [Ryzyko: ...]
MAT-42 · wymagane 500 na środę                  [Akcja kontekstowa]

[Pokrycie 300/500] [Brak 200] [Klient: zagrożony] [Etap: decyzja]

Zlecenie produkcyjne          Plan i pokrycie
PO-1001 / produkt / ilość      PP-2001 / stock / commitments

Wpływ na klienta               Zobowiązania dostawców
termin i wynik                  Supplier 1 / Supplier 2

Analiza i propozycje            Checklist potwierdzeń

Wiadomości i timeline
```

#### Sekcje i pola

1. **Header:** `correlationId`, status sprawy, risk, SKU, required quantity/date, reason dla `NEEDS_ATTENTION`, ostatnia aktualizacja.
2. **Summary KPIs:** `coveredQuantity/requiredQuantity`, `missingQuantity`, `riskStatus`, customer impact (`on_time`, `at_risk`, `breached`, `unknown`), bieżący etap.
3. **Production orders:** dla każdego istniejącego ID: `orderNumber`, `productSku`, `quantity`, `materialSku`, `materialQuantity`, `dueDate`, `customerName`, `customerCommitmentDate`, `status`. Brakujący powiązany rekord jest jawnym degraded state, nie znika po cichu.
4. **Production plan / coverage:** `planNumber`, `materialSku`, `requiredQuantity`, `requiredDate`, `internalStockQuantity`, lista supplier commitments, derived covered/missing/risk. Persisted i derived risk mismatch jest oznaczony jako błąd spójności dla operatora z `manage`, a dla viewerów jako ogólny błąd danych.
5. **Supplier commitments:** `supplierEmail`, quantity, delivery date, commitment status; propozycje po terminie nie liczą się do coverage.
6. **Customer impact:** wyświetlenie snapshotu tylko po walidacji read-model schema; minimalnie customer name/commitment date z orderów oraz opis wpływu z wybranego planu. Nie renderować arbitralnego JSON jako HTML.
7. **Analyses and proposals:** typed projection `initialAnalysis`, `initialOptions`, `finalAnalysis`, `resolutionPlans`, wybrane ID, pending plan, estimated/actual additional cost i currency. Gdy dane pozostają jeszcze nieustrukturyzowanym `JsonValue`, adapter API waliduje znane pola i zwraca bezpieczny `summaryUnavailable`, zamiast przekazywać raw JSON do komponentu.
8. **Decision panel:** aktywna proposal, opcje jako kompletne karty, wymagany jawny wybór; żadna opcja nie jest wstępnie wybrana. Reject/edit wymaga powodu zgodnie z Caseload. Po dyspozycji panel staje się read-only history.
9. **Confirmation checklist:** jedna pozycja na required confirmation z pending planu: dostawca, ilość, termin, status `pending/confirmed/mismatch/failed`, timestamp. Brak required set nie jest interpretowany jako sukces.
10. **Messages and timeline:** chronologiczna projekcja inbound messages, outbound correlations, workflow/case timestamps, analyses, dispositions i confirmations. Viewer bez `messages.view` widzi metadane etapu bez sender/recipient/body. Z `messages.view` widzi `sanitizedBody`, intent, confidence i disposition; `rawBody` nigdy nie jest domyślnie pokazywany.
11. **Final status:** sukces tylko gdy read model raportuje case `RESOLVED`, coverage pełne i risk `PROTECTED`; pokazuje `resolvedAt`, final commitments i koszt. Każda niespójność daje ostrzeżenie zamiast zielonego banneru.

#### Akcje kontekstowe

- `AWAITING_SOURCING_DECISION`: „Otwórz decyzję sourcingową” lub inline disposition, jeżeli platformowy Caseload udostępnia stabilny embedded surface.
- `AWAITING_RESOLUTION_APPROVAL`: „Otwórz decyzję planu”.
- `NEEDS_ATTENTION`: dozwolone przez parent workflow akcje `retry same idempotent step`, `request reanalysis` albo `cancel`; widoczne tylko jeśli dana komenda faktycznie istnieje i status/reason ją dopuszcza.
- inne statusy: brak mutacji; czytelny opis oczekiwania.

Domyślną implementacją jest deep-link do istniejącego Caseload proposal. Inline disposition jest dopuszczone wyłącznie po potwierdzeniu stabilnego publicznego kontraktu Caseload i musi wywoływać ten sam handler. Spec nie ustanawia nowego równoległego mechanizmu decyzji.

#### Stany szczegółu

- **Loading:** `LoadingMessage` w `PageBody` z zachowanym breadcrumb.
- **Not found:** scoped 404; bez wskazania, czy ID istnieje w innym tenant/org.
- **Partial/degraded:** brak planu, orderu lub proposal pokazuje osobny `Alert` w odpowiedniej sekcji; pozostałe sekcje działają.
- **Error:** `ErrorMessage` z retry; żadna mutacja nie jest dostępna, jeśli detail snapshot nie został wczytany.
- **Conflict 409:** `surfaceRecordConflict`; akcje blokowane do refetch, wybór użytkownika może zostać zachowany lokalnie, ale wysłanie wymaga nowego potwierdzenia na świeżej wersji.
- **Permission:** 403 dla detail; sekcja wiadomości redagowana osobno według `messages.view`; decyzje ukryte i serwerowo blokowane bez `decisions.apply`.
- **Terminal:** `RESOLVED`, `REJECTED`, `CANCELLED` są read-only; retry/cancel nie są pokazywane.

### Responsive, keyboard, accessibility and theming

- Desktop: summary + dwie kolumny sekcji; wąski ekran: jedna kolumna, kolejność decyzja → wpływ → plan → historia.
- DataTable zachowuje canonical narrow behavior; kluczowe pola nie mogą wymagać hover.
- Wszystkie badges mają tekst, nie polegają wyłącznie na kolorze.
- Statusy używają `StatusBadge` i semantic status tokens; bez hardcoded Tailwind palette, hex, arbitrary values i ręcznych `dark:` override.
- Fokus po przejściu na detail trafia na nagłówek strony; po błędzie mutacji na conflict/error alert; live region ogłasza odświeżenie statusu.
- Icon-only controls mają `aria-label`; timeline ma semantyczną listę i czytelny porządek czasu.
- Dialogi, jeśli użyte przez akcje naprawcze, obsługują Cmd/Ctrl+Enter i Escape. Decyzje wieloopcyjne muszą wymagać jawnego wyboru.
- Light/dark, kontrast i reduced motion są częścią evidence dla obu tras.

### Localization

Istnieją klucze nazw statusów, ryzyka, commitmentów, message types, reasons i nawigacji w `pl/en/de/es/ko`. Implementacja dodaje brakujące, identyczne klucze dla tytułów sekcji, kolumn, filtrów, pustych stanów, akcji, konfliktów, błędów i customer impact. UI używa `useT()`; metadata/server labels używają `resolveTranslations()`. Enumy pozostają stabilne i nie są tłumaczone w API.

## Data Models

Nie powstają nowe encje ani kolumny. Read modele korzystają wyłącznie z obecnych typów:

- `SupplyCase` — główny rekord i optimistic-lock version `updatedAt`;
- `ProductionOrder[]` — odczytane po `productionOrderIds` w tym samym scope;
- `ProductionPlan | null` — odczytany po `productionPlanId` w tym samym scope;
- `PlanCoverage | null` — obliczony przez `calculatePlanCoverage`;
- `InboundMessage[]` — scoped i filtrowane po `caseId`;
- `OutboundCorrelation[]` — scoped i filtrowane po `caseId`.

Timeline, `currentWait`, attention rank i customer impact są polami projekcyjnymi. Nie są utrwalane.

## API, Command, and Error Contracts

W repo nie ma dziś poniższych routes. Implementacja ma je dodać jako minimalne, scoped read APIs z per-method `metadata` i `openApi`; nazwy są nową addytywną powierzchnią kontraktową. Generator Open Mercato montuje moduł `supply_cases` pod kanonicznym prefiksem `/api/supply_cases`; UI i testy używają tej ścieżki runtime.

### `GET /api/supply_cases` (semanticzny odpowiednik `/api/supply-cases`)

Auth: staff auth + `supply_cases.view`.

Query: `page`, `pageSize<=100`, `q`, `status[]`, `riskStatus[]`, `attention`, `requiredFrom`, `requiredTo`, `supplierEmail`, `sort`, `order`.

Response:

```ts
type SupplyCaseListResponse = {
  items: Array<{
    id: string
    correlationId: string
    status: SupplyCaseStatus
    needsAttentionReason: NeedsAttentionReason | null
    sku: string
    requiredQuantity: number
    requiredDate: string
    productionOrders: Array<{ id: string; orderNumber: string }>
    planNumber: string | null
    coverage: PlanCoverage | null
    currentWait: string
    attentionGroup: 'decision_required' | 'needs_attention' | 'waiting_external' | 'processing' | 'closed'
    updatedAt: string
  }>
  page: number
  pageSize: number
  total: number
  totalPages: number
}
```

### `GET /api/supply_cases/{id}` (semanticzny odpowiednik `/api/supply-cases/{id}`)

Auth: staff auth + `supply_cases.view`; message body fields są dołączane tylko z `supply_cases.messages.view`.

Response zawiera `case`, `productionOrders`, `productionPlan`, `coverage`, typed `customerImpact`, `analyses`, `proposals`, `confirmationChecklist`, `timeline`, `availableActions` i `updatedAt`. `availableActions` jest wyliczone po stronie serwera z ACL + statusu + realnie zarejestrowanych komend/proposal; UI nie zgaduje akcji.

### Mutacje

UI nie dostaje generycznego `PATCH /api/supply-cases/{id}`. Używa:

- istniejącego Caseload disposition surface dla agent proposals;
- planowanych w parent spec komend `supply_cases.sourcing.apply_decision`, `supply_cases.resolution.apply_decision` oraz właściwych command-owned retry/reanalysis/cancel actions;
- istniejącej `supply_cases.inbound.apply_triage` tylko tam, gdzie operator rozstrzyga sprawę inbound zgodnie z jej osobnym kontraktem; nie jest to decyzja sourcingowa.

Każda mutacja przesyła version z detail read modelu (`updatedAt`) przez standard optimistic-lock header lub równoważny command contract, działa przez `useGuardedMutation(...).runMutation(...)`, jest idempotentna według parent speca i zwraca 409 dla stale action. Brak jeszcze komendy oznacza brak akcji w UI, nie bezpośredni fallback do repository update.

### Błędy

| Kod | Znaczenie UI |
|---|---|
| 400 | niepoprawny filtr/input; localized error, zachowanie wyboru |
| 401 | standard auth flow |
| 403 | permission state, bez częściowych danych |
| 404 | rekord niewidoczny lub nieistniejący w scope |
| 409 | unified optimistic-lock conflict; refetch przed ponowieniem |
| 422 | domenowy precondition/safety gate; pokaż reason, bez retry automatycznego |
| 500 | bezpieczny błąd ogólny i retry tylko dla odczytu |

## Events, Jobs, Notifications, and Cross-Module Flows

UI nie dodaje nowych eventów. Po udanej dyspozycji lub komendzie odświeża detail; w przyszłości może reagować na istniejący DOM Event Bridge, jeśli parent workflow oznaczy eventy `clientBroadcast`. Polling/refresh jest dopuszczalnym MVP dla statusów oczekiwania. UI nie emituje domenowych eventów samodzielnie.

## Security, Privacy, and Compliance

- Każdy odczyt i zapis jest scoped tenant + organization i fail-closed.
- Search nie może ujawniać, że correlation ID, order number lub e-mail istnieje w innym scope.
- `rawBody`, provider payload i techniczne failure details nie trafiają do standardowego detail response.
- `sanitizedBody` wymaga `supply_cases.messages.view`; adresy i treści nie są logowane przez klienta.
- Pola `JsonValue` są walidowane do jawnych read-model schemas; nie używać `dangerouslySetInnerHTML`.
- Użytkownik bez `decisions.apply` nie może wykonać mutacji nawet przez bezpośrednie żądanie.
- Conflict, double-submit i retry nie mogą wykonać decyzji drugi raz; przyciski są disabled podczas mutacji, a backend zachowuje idempotency.

## Integration Coverage

Testy tworzą własny scoped scenariusz przez API/test fixture i sprzątają go po wykonaniu; nie zależą od globalnego seedu demo ani stałych ID.

| Test ID | Poziom | Setup | Akcje | Asercje | REQ |
|---|---|---|---|---|---|
| TEST-UI-001 | API integration | dwie org, aktywne i zamknięte cases | list filters/sort/page/search | poprawne read modele, derived coverage, brak cross-scope | 001, 006 |
| TEST-UI-002 | browser | operator z `view`, kilka cases | otwarcie listy, filtry, sort, przejście do detail i back | URL state zachowany, poprawne kolumny i empty-filter state | 001, 006 |
| TEST-UI-003 | API integration | case z orderem, planem i commitmentami | GET detail | coverage zgodne z `calculatePlanCoverage`, brak raw IDs w display projection | 002 |
| TEST-UI-004 | browser | `SC-001`-equivalent bez stałych ID | detail | widoczne PO/PP, `300/500`, brak `200`, customer at risk | 002, 003 |
| TEST-UI-005 | browser + command | aktywna pierwsza proposal | explicit select alternative branch | brak preselection, jedna dyspozycja, status waiting for offer, stale submit blocked | 004 |
| TEST-UI-006 | browser + command | alternative offer i final proposal | wybór kompletnego planu | checklist powstaje z pending planu; brak direct PATCH | 003–005 |
| TEST-UI-007 | integration/browser | confirmation S1, potem S2 oraz odwrotna kolejność | dostarczenie signalów i refresh | po jednej non-green; po obu `500/500`, `PROTECTED`, `RESOLVED`; apply raz | 005 |
| TEST-UI-008 | integration/browser | missing/mismatched confirmation, timeout/failure | wejście w exception | `NEEDS_ATTENTION`, reason i zachowane dowody; brak green banner/final mutation | 005, 006 |
| TEST-UI-009 | security | viewer, message viewer, decision maker, wildcard, forbidden user | list/detail/message/action/direct API | redakcja treści, właściwe 403, wildcard działa, brak wycieku | 006 |
| TEST-UI-010 | browser | sztucznie opóźnione i błędne read APIs, empty org | list/detail | loading, empty, retryable error, 404 i degraded partial state | 006 |
| TEST-UI-011 | browser | dwa snapshoty tego samego case | dyspozycja z nieaktualnym version | 409 conflict bar, refetch, brak podwójnej decyzji | 004, 006 |
| TEST-UI-012 | accessibility/UI | permitted operator | keyboard-only list/detail/decision, narrow viewport, light/dark | fokus, labels, live region, text badges, dialog keys, brak overflow krytycznych danych | 006 |

API tests obejmują osobno oba nowe GET routes. Mutacyjne testy są aktywowane dopiero wraz z rzeczywistą komendą/proposal surface i muszą używać jej publicznego kontraktu, nie fixture update repository.

## Implementation Phases

### Phase 1 — Read-only operational queue

- **Depends on:** istniejące repositories, coverage, ACL i i18n.
- **Outcome:** operator widzi scoped listę i read-only detail dla danych, które już istnieją.
- **Deliverables:** list/detail read-model schemas i routes, menu metadata, list page, detail shell z order/plan/coverage/messages redaction, brak przycisków decyzji.
- **Independent slices / commits:** (1) read APIs + tests; (2) list; (3) detail.
- **Requirements:** REQ-001, REQ-002 i read-only część REQ-003/006.
- **Tests:** TEST-UI-001–004, 009–010, read-only część 012.
- **Validation:** `yarn generate`, focused unit/API/UI tests, `yarn typecheck`, `yarn lint`, `yarn ds:check`.
- **Exit gate:** uprawniony operator może znaleźć i otworzyć scoped case; `SC-001`-equivalent pokazuje wyliczony brak bez nowej domeny lub direct writes; widoki działają light/dark/narrow.

### Phase 2 — Decision projection and guarded actions

- **Depends on:** Phase 1 oraz rzeczywiste Caseload proposals i command contracts z parent Phase 2–3.
- **Outcome:** detail pokazuje analizy i kompletne opcje oraz pozwala przejść przez dwa jawne punkty decyzji.
- **Deliverables:** typed analysis/proposal adapters, available-actions projection, Caseload deep-links lub potwierdzony embedded surface, guarded mutations, conflict handling.
- **Independent slices / commits:** (1) proposal/history projection; (2) first decision; (3) final decision + conflicts.
- **Requirements:** REQ-003, REQ-004, REQ-006.
- **Tests:** TEST-UI-005, TEST-UI-006, TEST-UI-011 i action część 009/012.
- **Validation:** Phase 1 gate + focused command integration + browser flows.
- **Exit gate:** oba punkty decyzji wymagają jawnego wyboru, nie omijają Caseload/workflow, stale action daje 409 i żadna ścieżka UI nie wykonuje direct case update.

### Phase 3 — Confirmation and resolved-state demo

- **Depends on:** Phase 2 oraz confirmation join i `resolution.apply_confirmed` z parent Phase 4.
- **Outcome:** operator obserwuje potwierdzenia i finalny bezpieczny wynik.
- **Deliverables:** confirmation checklist, final state banner, mismatch/timeout/failure states, timeline completion, opcjonalne realtime refresh jeśli istnieje broadcast.
- **Requirements:** REQ-005 i końcowa część REQ-003/006.
- **Tests:** TEST-UI-007, TEST-UI-008, pełny TEST-UI-012.
- **Validation:** focused workflow/API/browser integration, `yarn generate`, pełny configured gate i `yarn test:integration:ephemeral`.
- **Exit gate:** scenariusz w obu kolejnościach potwierdzeń kończy się dokładnie jednym `500/500`, `PROTECTED`, `RESOLVED`; brak/mismatch nigdy nie pokazuje sukcesu.

## Implementation Status

Source doc: .ai/specs/2026-09-18-supply-cases-ui.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — Read-only operational queue | in_progress | existing repositories, coverage, ACL, i18n | AC-001, AC-002, read-only AC-003/AC-006 | Closure run 2026-09-19: Playwright read-only 3/3, TEST-UI-009 1/1, TEST-UI-010 2/2 and TEST-UI-012 1/1 passed against the local QA runtime; fixtures are scoped and purged. | **NOT met.** The requested browser matrix is now evidenced, but the formal gate still requires live provider and real inbound-mail evidence; neither was run without explicit credentials and approval. |
| Phase 2 — Decision projection and guarded actions | in_progress | Phase 1; parent Caseload proposals and command contracts | AC-003, AC-004, AC-006 | Closure run 2026-09-19: Playwright `supply-cases-phase2-decision.spec.ts` 1/1 passed; three options are unselected initially, Supplier 2 is selected, stale submit returns `409`, the detail refetches, only the decision POST mutates and no false success is shown. | **Partially met.** The first guarded decision point is browser-evidenced. The final decision point (TEST-UI-006) and the remaining parent Phase 2 exit-gate evidence (live provider/RFQ plus other documented contract gaps) remain open. |
| Phase 3 — Confirmation and resolved-state demo | pending | Phase 2; parent confirmation join and resolution command | AC-003, AC-005, AC-006 | blocked by declared dependencies | both confirmation orders produce one safe resolved result |

### Phase 1 progress

- [x] read API slice: `src/modules/supply_cases/data/read-model.ts`, `src/modules/supply_cases/api/route.ts`, `src/modules/supply_cases/api/[id]/route.ts`, `src/modules/supply_cases/api/openapi.ts`; scoped filters, derived coverage, 404 isolation and message redaction covered — `yarn test src/modules/supply_cases/__tests__/read-model.test.ts src/modules/supply_cases/__tests__/read-api.test.ts --runInBand` passed
- [x] list surface: `src/modules/supply_cases/components/SupplyCasesTable.tsx`, `src/modules/supply_cases/backend/supply-cases/page.tsx`, `src/modules/supply_cases/backend/supply-cases/page.meta.ts`; DataTable filters, server pagination/sort, URL state, localized loading/empty/error states and navigation metadata are wired — `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check` passed
- [x] detail surface: `src/modules/supply_cases/components/SupplyCaseDetail.tsx`, `src/modules/supply_cases/backend/supply-cases/[id]/page.tsx`, `src/modules/supply_cases/backend/supply-cases/[id]/page.meta.ts`; derived coverage, degraded states, redacted timeline, customer impact, analysis/proposal summaries and responsive sections are rendered read-only — `yarn test`, `yarn build` passed
- [x] browser integration evidence for TEST-UI-002/004: `src/modules/supply_cases/__integration__/supply-cases-read-only.spec.ts` passed 3/3 against the local runtime; the scenario creates and purges its scoped JSON fixture, covers search, risk filter, URL state, detail coverage, customer risk, timeline translation and read-only actions; Chrome computer-use walkthrough verified the same `SC-001`-equivalent at `300/500` with missing `200`
- [x] browser closure evidence for TEST-UI-009/010/012: `supply-cases-permission.spec.ts` 1/1 covers forbidden list/detail without leakage; `supply-cases-failure-states.spec.ts` 2/2 covers retry recovery, degraded related-data state and 404; `supply-cases-accessibility.spec.ts` 1/1 covers 390px viewport, keyboard radio navigation, labels/focus and overflow. Each spec creates and purges its own scoped fixture.
- [ ] **FORMAL PHASE 1 EXIT GATE remains blocked:** no live provider run and no real inbound-mail round trip were executed; the browser evidence above is local-runtime evidence only.

### Phase 2 progress

- [x] first decision point: `src/modules/supply_cases/api/[id]/decision/route.ts` behind `supply_cases.decisions.apply`, requiring the optimistic-lock header (`428` without it) and returning a typed `409` with `currentUpdatedAt`; the detail surface renders exactly three options with none preselected
- [x] browser evidence for the first decision point: `src/modules/supply_cases/__integration__/supply-cases-phase2-decision.spec.ts` passed 1/1 in the 2026-09-19 closure audit — three unselected radios, explicit select of the alternative branch, guarded stale-version submit observed as `409`, conflict message visible, list refetched back to three radios (TEST-UI-005 and TEST-UI-011 in substance)
- [ ] TEST-UI-006 final plan selection and checklist — depends on parent Phase 3, not started
- [x] browser action safety evidence: the Phase 2 decision spec records the guarded POST as the only mutation, verifies stale `409` plus refetch and asserts no false `Resolved`/waiting success
- [ ] **Ownership deviation to resolve with the parent spec:** this surface routes the disposition through the module's own guarded command route rather than a Caseload deep-link or embedded surface. The parent Phase 2 spec's step 4 / P2-07 asked for an `INVOKE_AGENT` step plus a Caseload disposition bridge. Human authority and propose-only are preserved, but the "nie omijają Caseload/workflow" clause in this phase's exit gate needs to be either amended or satisfied.

Audit record: [`../runs/2026-09-19-phase1-phase2-browser-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-browser-closure/STATE.md).

## Requirement Traceability

| Requirement | Journey / surface | Contracts | Phase | Tests | AC |
|---|---|---|---|---|---|
| REQ-001 | J-001, lista | list GET | 1 | 001, 002, 009 | AC-001 |
| REQ-002 | J-002, detail | detail GET + coverage | 1 | 003, 004 | AC-002 |
| REQ-003 | J-002/003, detail timeline | detail projection | 1–3 | 004–008 | AC-003 |
| REQ-004 | J-002/003, decision panel | Caseload/commands | 2 | 005, 006, 011 | AC-004 |
| REQ-005 | J-003, checklist/final | detail projection + parent safety gate | 3 | 007, 008 | AC-005 |
| REQ-006 | wszystkie | ACL/i18n/UI states/version | 1–3 | 009–012 | AC-006 |

## Rollout, Migration, and Rollback

- Brak migracji danych i nowych encji.
- Phase 1 może wejść jako read-only nawet przed pełnym workflow, o ile moduł pozostaje zgodny z activation gate parent speca i nie sugeruje aktywności brakujących decyzji.
- Phase 2/3 są ukryte przez brak `availableActions` do czasu zarejestrowania realnych kontraktów; nie tworzymy atrap produkcyjnych.
- Rollback UI polega na usunięciu/wyłączeniu nowych pages/routes i nav entry; dane domenowe pozostają nietknięte.
- Nowe routes są addytywnym kontraktem. Po publikacji ich rename/removal wymaga standardowej polityki kompatybilności.

## Risks and Tradeoffs

| Ryzyko | Wpływ | Mitygacja / wykrycie | Residual risk |
|---|---|---|---|
| Parent workflow Phase 2–4 nie istnieje | decyzje nie mogą działać end-to-end | Phase 1 read-only; akcje tylko z realnego `availableActions` | demo interaktywne zależne od parent phases |
| `JsonValue` analyses nie mają stabilnego shape | kruchy rendering | typed adapters, bezpieczny unavailable state, nigdy raw HTML | część szczegółów może być niewidoczna do ustalenia schema |
| List aggregation jest kosztowna dla JSON store | wolne sort/filter przy większej liczbie spraw | MVP pagination i limit 100; ORM/query projection później | JSON backend nie jest produkcyjnie skalowalny |
| Rozjazd persisted `riskStatus` i derived coverage | mylący green state | derived coverage jest podstawą UI; mismatch alert/test | wymaga naprawy workflow/data |
| Timeline z wielu źródeł ma zdarzenia o tym samym czasie | niejednoznaczna kolejność | deterministyczny tie-break type + id | nie zastępuje pełnego audit logu |
| Wrażliwe dane wiadomości | nadmierna ekspozycja | osobny feature, sanitized body, redaction, scoped API | uprawniony viewer nadal widzi dane biznesowe |
| Polling opóźnia zmianę statusu | chwilowo nieaktualny ekran | widoczny timestamp i ręczny refresh; DOM bridge dopiero po realnym evencie | krótkie opóźnienie akceptowalne w MVP |

## Acceptance Criteria

- [ ] **AC-001** — operator z `supply_cases.view` widzi scoped, paginowaną listę z dokładnie określonymi kolumnami, filtrami i sortowaniem; druga organizacja jest niewidoczna.
- [ ] **AC-002** — detail dla scenariusza `PO-1001` / `PP-2001` / `SC-001` pokazuje zlecenie, plan, commitments oraz po zmianie Supplier 1 wynik `300/500`, brak `200`, `AT_RISK`.
- [ ] **AC-003** — timeline i sekcje analyses/proposals pokazują istniejące fakty chronologicznie, z redakcją treści bez `messages.view` i bez renderowania raw JSON/HTML.
- [ ] **AC-004** — żadna decyzja nie używa generycznego update; każda przechodzi przez Caseload/workflow/command owner, wymaga explicit option i obsługuje stale 409.
- [ ] **AC-005** — po planie `300 Supplier 1 + 200 Supplier 2` i obu zgodnych potwierdzeniach detail pokazuje `500/500`, `PROTECTED`, `RESOLVED`; po jednym lub mismatch pozostaje non-green.
- [ ] **AC-006** — lista i detail mają kompletne loading/empty/error/not-found/degraded/conflict/permission/terminal states, i18n, semantic tokens, keyboard/a11y oraz light/dark/narrow evidence.
- [ ] Wszystkie kluczowe API i UI paths mają samowystarczalne integration tests, a skonfigurowany validation gate przechodzi.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| AGENTS, parent/data specs i routed guides/skills przeczytane | pass | `AGENTS.md`, spec-delivery, backend-ui, quality/crud references, oba parent specs |
| Data/API/UI/test contracts są spójne | pass | reuse map, API contracts, traceability |
| Workflow kończy się bez catch-all phase | pass | trzy dependency-ordered vertical phases |
| Reuse przed custom code | pass | DataTable, detail families, shared API helpers, Caseload/commands |
| UI ma canonical components i komplet stanów | pass | UI contracts i TEST-UI-009–012 |
| Każda faza ma zależności, testy i exit gate | pass | Implementation Phases |
| Brak fikcyjnych encji i udawanych gotowych endpoints | pass | Data Models oraz jawny „stan faktyczny”; routes oznaczone jako do dodania |
| Brak rozszerzenia do MRP/APS | pass | Non-goals |

**Verdict: Phase 1 read-only slice implemented and verified; Phase 2–3 remain dependency-gated**

## Open Questions

Brak pytań blokujących. Wybór deep-link vs embedded Caseload jest rozstrzygany przez dostępność stabilnego publicznego surface podczas Phase 2; bez niego obowiązuje deep-link i nie zmienia to architektury ani zakresu.

## Changelog

| Data | Zmiana |
|---|---|
| 2026-09-19 | Audyt domknięcia Phase 1/Phase 2. Ponownie uruchomiono `supply-cases-read-only.spec.ts` (3/3) i `supply-cases-phase2-decision.spec.ts` (1/1) przeciwko lokalnemu runtime; `yarn typecheck`, 26 suites / 332 testy, eslint i `ds:check` (301 plików) przeszły. Phase 1 pozostaje `in_progress` — exit gate nie jest spełniony, bo **TEST-UI-009/010/012 nie mają żadnych plików spec ani dowodów browser**. Phase 2 UI podniesiono z `pending` na `in_progress`: pierwszy punkt decyzji jest realny i pokryty w przeglądarce (TEST-UI-005/011 co do treści), ale TEST-UI-006 nie istnieje, a dyspozycja idzie przez własny guarded route zamiast Caseload — odchyłka do rozstrzygnięcia w parent spec. Zapis: [`../runs/2026-09-19-phase1-phase2-closure/STATE.md`](../runs/2026-09-19-phase1-phase2-closure/STATE.md). |
| 2026-09-19 | Dodano powtarzalny Playwright QA runtime (`.ai/scripts/test-env-up.ps1` / `test-env-down.ps1`), browser descriptor oraz 3/3 testy listy, filtrowania i read-only detail; fikcyjny `SC-001` został odtworzony w lokalnym store i pozostawiony otwarty w Chrome. |
| 2026-09-18 | Pierwsza wersja specyfikacji UI: lista, szczegóły, read modele, Caseload/command ownership, integration coverage i scenariusz `500/500` bez rozszerzania zakresu do MRP. |
| 2026-09-19 | Faza 1: dodano scoped read API i backendowy read-only queue/detail z derived coverage, redakcją wiadomości, ACL states, i18n oraz statusem implementacji; browser exit gate pozostaje otwarty do czasu przygotowania wspólnego QA environment. |
