# Supply Cases: Local JSON-backed Store for ProductionOrder, ProductionPlan, SupplyCase and SupplyMessage

**Date:** 2026-09-18
**Status:** Draft for implementation
**Scope:** Manufacturer A only — new app module `supply_cases`
**Implements:** `BACKLOG-001` of [`2026-09-18-supplier-email-agent-workflow.md`](./2026-09-18-supplier-email-agent-workflow.md)

## 📣 TLDR

Nowy moduł aplikacyjny `supply_cases` dostaje warstwę trwałości opartą na plikach JSON dla czterech rekordów: `ProductionOrder`, `ProductionPlan`, `SupplyCase` i `SupplyMessage`. Warstwa jest schowana za interfejsami repozytoriów rejestrowanymi w DI, więc późniejsza zamiana na MikroORM i PostgreSQL nie dotyka logiki agenta ani workflow. Store wymusza zakres `tenant_id` + `organization_id`, unikalność `business_message_id`, append-only dla `SupplyMessage` oraz atomowy zapis pliku, i dostarcza deterministyczny seed całego scenariusza demonstracyjnego.

## 📣 Problem Statement

Parent spec wymaga realnych encji MikroORM z migracjami i snapshotami (Phase 1). Zanim model danych się ustabilizuje, nie da się uruchomić ani zademonstrować przepływu: korelacji wiadomości, obliczenia wpływu na produkcję, zapisu oczekującego planu, wznowienia po restarcie procesu i deduplikacji. Pisanie migracji pod zmieniający się model kosztuje więcej niż daje, a bez jakiejkolwiek trwałości agent i workflow nie mają o co zaczepić kontraktów.

Potrzebna jest warstwa, która ma te same właściwości obserwowalne co docelowa baza — scoping, stabilne identyfikatory, unikalność klucza deduplikacji, append-only historii, trwałość między restartami — ale nie wymaga bazy danych ani migracji.

## 📣 Goals

- **REQ-101:** Cztery typy rekordów są trwale zapisywane i odczytywane z plików JSON w katalogu konfigurowalnym zmienną środowiskową i ignorowanym przez Git.
- **REQ-102:** Każda operacja odczytu i zapisu przyjmuje jawny `StoreScope` (`tenantId` + `organizationId`); rekord spoza zakresu jest niewidoczny.
- **REQ-103:** `business_message_id` jest unikalny w obrębie zakresu; ponowna próba zapisu nie tworzy drugiego `SupplyMessage`.
- **REQ-104:** `SupplyMessage` jest append-only — typ repozytorium nie udostępnia `update` ani `delete`.
- **REQ-105:** Zapis pliku jest atomowy: przerwanie zapisu zostawia poprzedni poprawny JSON.
- **REQ-106:** Równoległe zapisy do jednej kolekcji są serializowane i żaden rekord nie ginie.
- **REQ-107:** `seedScenario` / `resetScenario` tworzą deterministyczne rekordy całego scenariusza (Supplier 1 proposal, zapotrzebowanie produkcyjne, plan produkcji, opcjonalna oferta Supplier 2).
- **REQ-108:** Store jest zarejestrowany w DI za interfejsami, tak że implementacja ORM podmienia się bez zmiany kontraktów agenta i workflow.
- **REQ-109:** Błędy są jawne i typowane: not-found, duplicate, scope-mismatch, append-only violation.

## 📣 Non-goals

- Zastąpienie docelowych encji, migracji ani snapshotów z Phase 1 parent speca.
- Szyfrowanie pól (`encrypted JSONB` w parent specu) — pliki JSON są jawnym tekstem i nie przyjmują prawdziwych danych wrażliwych.
- Współbieżność wieloprocesowa, transakcje wielokolekcyjne, indeksy, skalowanie i wydajność.
- Izolacja tenantów jako mechanizm bezpieczeństwa — scoping jest tu odwzorowaniem kontraktu, a nie granicą bezpieczeństwa.
- API routes, UI, komendy, agenci i workflow modułu `supply_cases` — ten spec dostarcza wyłącznie warstwę danych.

## 📣 Proposed Solution

### Warstwy

```text
agent / workflow / commands        <- nie zmieniają się przy podmianie backendu
  |
  v
data/repositories.ts (interfejsy)  <- kontrakt
  |
  v
data/json/*.ts (implementacja)     <- wymienialne na MikroORM
  |
  v
JsonCollection (atomic file I/O)
```

### Decyzje projektowe

1. **`StoreScope` jako obowiązkowy pierwszy argument każdej metody.** Izolacja tenantów wychodzi z sygnatury typu, a nie z dyscypliny wywołującego. Zapomnienie scope'u to błąd kompilacji, nie wyciek danych.

2. **Append-only wyrażone typem, nie runtime checkiem.** `SupplyMessageRepository` po prostu nie deklaruje `update` ani `delete`. Runtime error `AppendOnlyViolationError` istnieje jako druga linia obrony dla wywołań z nietypowanego kontekstu, ale podstawową gwarancją jest typ.

3. **Read poza zakresem zwraca `null`, nie rzuca `ScopeMismatchError`.** Rzucenie błędu "ten rekord istnieje, ale nie w twoim zakresie" jest wyciekiem informacji o istnieniu rekordu. `ScopeMismatchError` jest zarezerwowany dla zapisu z jawnym `id`, które należy już do innego zakresu — to błąd programisty (import/fixture), nie próba odczytu cudzych danych. Payload zapisu nie może w ogóle podać `tenantId`/`organizationId`: te pola są usunięte ze schematów create/update i zawsze pochodzą ze `scope`.

4. **Serializacja zapisów per plik.** Kolekcja JSON to read-modify-write. Dwa równoległe `create` bez serializacji czytają ten sam stan i drugi nadpisuje pierwszy. Każda kolekcja trzyma łańcuch promise'ów; każda mutacja dokleja się do ogona. Deduplikacja `business_message_id` jest sprawdzana wewnątrz tej samej sekcji krytycznej co zapis — inaczej dwa równoległe appendy tego samego ID przechodzą oba.

5. **Wstrzykiwany zegar i generator ID.** `{ now, newId }` w opcjach store'a. Fixture'y używają deterministycznych ID; testy używają licznika zamiast `randomUUID`.

6. **Atomowy zapis:** `open(tmp)` → `write` → `fsync` → `close` → `rename(tmp, target)`. `rename` jest atomowy na jednym wolumenie (Node używa `MoveFileEx` z `MOVEFILE_REPLACE_EXISTING` na Windows). `fsync` przed `rename` gwarantuje, że po rename plik ma pełną treść, a nie pustą.

7. **Walidacja zod przy odczycie.** Niepoprawny plik rzuca wprost zamiast "naprawiać po cichu". Cicha naprawa zamieniłaby uszkodzenie danych w trudny do wyśledzenia błąd logiki.

8. **Soft delete zamiast hard delete** dla `ProductionOrder`, `ProductionPlan` i `SupplyCase` — spójne z kolumną `deleted_at` docelowego modelu. `list` domyślnie pomija skasowane.

### Alternatives considered

1. **SQLite zamiast JSON:** odrzucone — wymaga natywnej zależności (`better-sqlite3` jest tylko `optionalDependency`), a podmiana na Postgres i tak byłaby pełnym przepisaniem. JSON jest czytelny w diffach podczas debugowania demo.
2. **Trzymanie stanu w pamięci procesu:** odrzucone — parent spec wymaga wznowienia po restarcie procesu, czego pamięć nie daje.
3. **Jeden plik na wszystkie kolekcje:** odrzucone — każdy zapis przepisywałby całość i każda kolizja dotyczyłaby wszystkich typów.
4. **Bezpośrednie użycie `fs.writeFile` bez tmp+rename:** odrzucone — przerwany zapis zostawia obcięty JSON, co łamie explicit acceptance criterion parent speca.
5. **Rzucanie `ScopeMismatchError` przy odczycie poza zakresem:** odrzucone jako wyciek informacji (patrz decyzja 3).

## 📣 Data Model

Wszystkie rekordy dzielą bazę: `id`, `tenantId`, `organizationId`, `createdAt`, `updatedAt`. Rekordy podlegające soft delete dodają `deletedAt`. Daty są przechowywane jako stringi ISO 8601 (JSON nie ma typu daty; parsowanie do `Date` należy do warstwy wyżej).

### ProductionOrder

Zlecenie produkcyjne zużywające materiał, z terminem zobowiązania wobec klienta.

| Pole | Typ | Notatki |
|---|---|---|
| `id` | string | UUID lub deterministyczne ID fixture'u |
| `tenantId`, `organizationId` | string | zakres |
| `orderNumber` | string | unikalny w zakresie, np. `PO-1001` |
| `productSku` | string | wytwarzany wyrób |
| `quantity` | number | ilość wyrobu |
| `materialSku` | string | zużywany materiał, np. `MAT-42` |
| `materialQuantity` | number | zapotrzebowanie na materiał |
| `dueDate` | ISO string | termin zakończenia produkcji |
| `customerName` | string | snapshot, bez relacji ORM |
| `customerCommitmentDate` | ISO string | zobowiązanie wobec klienta |
| `status` | enum | `PLANNED` \| `RELEASED` \| `AT_RISK` \| `PROTECTED` \| `COMPLETED` \| `CANCELLED` |
| `createdAt`, `updatedAt`, `deletedAt` | ISO string / null | lifecycle |

### ProductionPlan

Pokrycie materiałowe dla zbioru zleceń — to na nim liczy się `500/500` i `PROTECTED`.

| Pole | Typ | Notatki |
|---|---|---|
| `id` | string | |
| `tenantId`, `organizationId` | string | zakres |
| `planNumber` | string | unikalny w zakresie, np. `PP-2001` |
| `materialSku` | string | `MAT-42` |
| `requiredQuantity` | number | `500` |
| `requiredDate` | ISO string | środa |
| `internalStockQuantity` | number | dostępny zapas |
| `supplierCommitments` | array | patrz niżej |
| `productionOrderIds` | string[] | snapshot ID, bez relacji ORM |
| `riskStatus` | enum | `PROTECTED` \| `AT_RISK` \| `BREACHED` |
| `createdAt`, `updatedAt`, `deletedAt` | ISO string / null | |

`SupplierCommitment`: `{ supplierEmail, quantity, deliveryDate, status: 'PROPOSED' | 'COMMITTED' | 'CONFIRMED' | 'CANCELLED' }`.

Pokrycie (`coveredQuantity`) jest liczone deterministycznie z `internalStockQuantity` plus zobowiązań o statusie `COMMITTED`/`CONFIRMED`, a nie przechowywane — pole przechowywane rozjechałoby się z zobowiązaniami przy każdej częściowej aktualizacji.

### SupplyCase

Wierne odwzorowanie tabeli z parent speca, z pominięciem szyfrowania (Non-goals).

| Pole | Typ | Notatki |
|---|---|---|
| `id` | string | |
| `tenantId`, `organizationId` | string | zakres |
| `correlationId` | string | **unikalny w zakresie**, np. `SC-001` |
| `status` | enum | wartość maszyny stanów parent speca |
| `needsAttentionReason` | enum \| null | `WAIT_TIMEOUT` \| `DELIVERY_FAILED` \| `CONFIRMATION_MISMATCH` |
| `sku`, `requiredQuantity`, `requiredDate` | string/number/ISO | snapshot zapotrzebowania |
| `supplier1Email`, `supplier2Email` | string \| null | znormalizowane snapshoty |
| `productionOrderIds` | string[] | snapshot, bez relacji ORM |
| `productionPlanId` | string \| null | snapshot |
| `customerCommitmentSnapshot` | json \| null | |
| `originalCommitment`, `supplier1Proposal` | json \| null | |
| `alternativeOffer` | json \| null | |
| `initialAnalysis`, `initialOptions` | json \| null | |
| `selectedInitialOptionId` | string \| null | |
| `finalAnalysis`, `resolutionPlans` | json \| null | |
| `selectedResolutionPlanId`, `pendingResolutionPlan` | string \| json \| null | |
| `estimatedAdditionalCost`, `actualAdditionalCost`, `currency` | number \| null / string | liczone kodem |
| `supplier1ConfirmedAt`, `supplier2ConfirmedAt` | ISO string \| null | dowód potwierdzenia |
| `workflowInstanceId` | string \| null | skalar, bez relacji ORM |
| `resolvedAt`, `createdAt`, `updatedAt`, `deletedAt` | ISO string \| null | |

Statusy: `RECEIVED`, `ANALYZING_INITIAL_IMPACT`, `AWAITING_SOURCING_DECISION`, `SENDING_ALTERNATIVE_REQUEST`, `WAITING_FOR_ALTERNATIVE_OFFER`, `ANALYZING_CONFIRMED_OFFER`, `AWAITING_RESOLUTION_APPROVAL`, `SENDING_PLAN_ACCEPTANCE`, `WAITING_FOR_SUPPLIER_CONFIRMATIONS`, `APPLYING_RESOLUTION`, `RESOLVED`, `REJECTED`, `CANCELLED`, `NEEDS_ATTENTION`.

### SupplyMessage

Append-only. Bez `updatedAt` i `deletedAt` — rekord nigdy się nie zmienia.

| Pole | Typ | Notatki |
|---|---|---|
| `id` | string | |
| `tenantId`, `organizationId`, `caseId` | string | `caseId` nullable dla kwarantanny |
| `businessMessageId` | string | **unikalny w zakresie** |
| `correlationId`, `causationId` | string \| null | graf wiadomości |
| `direction` | enum | `INBOUND` \| `OUTBOUND` |
| `messageType` | enum | pięć typów z parent speca plus `UNKNOWN` |
| `senderEmail`, `recipientEmail` | string | znormalizowane snapshoty |
| `payload` | json \| null | |
| `rawBody` | string \| null | |
| `deliveryStatus` | enum | `PENDING` \| `SENT` \| `DELIVERED` \| `FAILED` \| `QUARANTINED` |
| `providerMessageId`, `failureReason` | string \| null | dowód transportu |
| `receivedAt`, `sentAt`, `createdAt` | ISO string \| null | |

## 📣 Repository Contracts

```ts
type StoreScope = { tenantId: string; organizationId: string }

interface ProductionOrderRepository {
  create(scope, input): Promise<ProductionOrder>
  findById(scope, id): Promise<ProductionOrder | null>
  requireById(scope, id): Promise<ProductionOrder>
  findByOrderNumber(scope, orderNumber): Promise<ProductionOrder | null>
  list(scope, filter?): Promise<ProductionOrder[]>
  update(scope, id, patch): Promise<ProductionOrder>
  softDelete(scope, id): Promise<void>
}

interface ProductionPlanRepository { /* jw., plus findByPlanNumber */ }

interface SupplyCaseRepository { /* jw., plus findByCorrelationId */ }

interface SupplyMessageRepository {
  append(scope, input): Promise<SupplyMessage>
  appendIfAbsent(scope, input): Promise<{ message: SupplyMessage; created: boolean }>
  findById(scope, id): Promise<SupplyMessage | null>
  findByBusinessMessageId(scope, businessMessageId): Promise<SupplyMessage | null>
  list(scope, filter?): Promise<SupplyMessage[]>
}

interface SupplyCasesStore {
  productionOrders, productionPlans, supplyCases, supplyMessages
  seedScenario(scope, options?): Promise<SeededScenario>
  resetScenario(scope): Promise<SeededScenario>
}
```

`append` rzuca `DuplicateBusinessMessageIdError`; `appendIfAbsent` zwraca istniejący rekord z `created: false`. Dwie metody, bo consumer wiadomości przychodzących chce cichej deduplikacji, a wysyłka wychodząca chce twardego błędu przy podwójnym wysłaniu.

## 📣 Errors

| Klasa | `code` | Kiedy |
|---|---|---|
| `RecordNotFoundError` | `not_found` | `requireById`/`update`/`softDelete` na nieistniejącym lub pozazakresowym rekordzie |
| `DuplicateBusinessMessageIdError` | `duplicate_business_message_id` | `append` z istniejącym `businessMessageId` w zakresie |
| `DuplicateRecordKeyError` | `duplicate_record_key` | duplikat `correlationId`, `orderNumber` lub `planNumber` w zakresie |
| `ScopeMismatchError` | `scope_mismatch` | create z jawnym `id`, które istnieje już w innym zakresie |
| `AppendOnlyViolationError` | `append_only_violation` | próba mutacji `SupplyMessage` |
| `StoreFileCorruptedError` | `store_file_corrupted` | plik nie przechodzi walidacji zod |

Wszystkie dziedziczą po `SupplyStoreError` z dyskryminatorem `code`, żeby workflow mógł rozróżnić "duplikat, zignoruj cicho" od "scope mismatch, to błąd".

## 📣 Configuration

| Zmienna | Domyślnie | Znaczenie |
|---|---|---|
| `OM_SUPPLY_CASES_DATA_DIR` | `.mercato/supply-cases` | katalog plików JSON, ignorowany przez Git |

Pliki: `production-orders.json`, `production-plans.json`, `supply-cases.json`, `supply-messages.json`.
Format pliku: `{ "version": 1, "records": [...] }` — koperta z wersją, żeby dało się wykryć niekompatybilny stan zamiast go źle sparsować.

## 📣 Fixtures

`seedScenario` tworzy stan wyjściowy demo. ID fixture'ów są deterministyczne **w obrębie zakresu**: `sc-fixture-<odcisk scope'u>-<nazwa>`, gdzie odcisk to skrócony SHA-1 z `tenantId:organizationId`. Globalnie stałe ID kolidowałyby na kluczu głównym przy zasiewaniu tego samego scenariusza w dwóch zakresach; odcisk zachowuje powtarzalność i nie łamie izolacji. Zawartość:

- `ProductionOrder` `PO-1001`: 500 `MAT-42`, klient `Acme Industries`, środa;
- `ProductionPlan` `PP-2001`: `requiredQuantity` 500, `internalStockQuantity` 200, jedno zobowiązanie Supplier 1 `500 @ Wed` w statusie `COMMITTED`, `riskStatus: PROTECTED`, wskazuje `PO-1001`;
- `SupplyCase` `SC-001`: status `RECEIVED`, `originalCommitment` `500 Wed`, `supplier1Proposal` `300 Wed / 200 Fri`;
- `SupplyMessage`: inbound `SUPPLY_PROPOSAL` od `supplier@hackon-om-wro.cloud`, `deliveryStatus: DELIVERED`;
- opcjonalnie (`includeAlternativeOffer: true`): inbound `ALTERNATIVE_SUPPLY_OFFER` od `supplier2@hackon-om-wro.cloud`, `200 @ Wed`, `1400 PLN`.

`resetScenario` usuwa wszystkie rekordy w zakresie (łącznie z `SupplyMessage` — reset to operacja administracyjna store'a, nie mutacja domenowa) i wywołuje `seedScenario`. Rekordy innych zakresów pozostają nietknięte.

## 📣 DI Registration

`src/modules/supply_cases/di.ts` rejestruje `supplyCasesStore` oraz cztery repozytoria jako aliasy rozwiązywane ze store'a. Podmiana na ORM to zmiana fabryki w tym pliku.

## 📣 Implementation Plan

1. `data/types.ts` — schematy zod i typy `z.infer` dla czterech rekordów, enumów i koperty pliku.
2. `data/errors.ts` — hierarchia `SupplyStoreError`.
3. `data/repositories.ts` — interfejsy i `StoreScope`.
4. `data/json/collection.ts` — `JsonCollection`: load z walidacją, atomowy zapis, kolejka mutacji.
5. `data/json/store.ts` — cztery repozytoria plus `createJsonSupplyCasesStore`.
6. `data/fixtures.ts` — `seedScenario` / `resetScenario`.
7. `index.ts`, `di.ts` — `ModuleInfo` i rejestracja; `supply_cases` dodany do `src/modules.ts`.
8. `__tests__/json-store.test.ts` — testy acceptance criteria.
9. Katalog danych — domyślny `.mercato/supply-cases` jest już objęty istniejącą regułą `.mercato/*` w `.gitignore`; osobny wpis nie jest potrzebny.

## 📣 Acceptance Criteria

- [x] Czysty `resetScenario` tworzy deterministyczne rekordy wszystkich czterech typów.
- [x] `create` → nowa instancja store'a → `findById` zwraca ten sam rekord z dysku (trwałość po restarcie).
- [x] Duplikat `businessMessageId` nie tworzy drugiego `SupplyMessage`: `append` rzuca, `appendIfAbsent` zwraca `created: false`.
- [x] Replay wiadomości daje jedną wiadomość i jeden efekt.
- [x] Rekordy innego `tenantId` lub `organizationId` nie są widoczne w `list`, `findById`, `findByCorrelationId` ani `findByBusinessMessageId`.
- [x] `SupplyMessageRepository` nie ma `update` ani `delete` (poziom typu); generyczna próba mutacji rzuca `AppendOnlyViolationError`.
- [x] Przerwany zapis (symulowany błędem po utworzeniu pliku tymczasowego) zostawia poprzedni poprawny JSON.
- [x] Równoległe `create`/`append` nie gubią rekordów.
- [x] Duplikat `correlationId` / `orderNumber` / `planNumber` rzuca `DuplicateRecordKeyError`.
- [x] `update` na nieistniejącym lub pozazakresowym rekordzie rzuca `RecordNotFoundError`.
- [x] Uszkodzony plik rzuca `StoreFileCorruptedError`, nie jest cicho naprawiany.
- [x] `softDelete` usuwa rekord z domyślnego `list`, ale pozostawia go w `list` z `includeDeleted`.
- [x] Obliczenie pokrycia (`500/500`, `PROTECTED`) przechodzi na store JSON bez połączenia z bazą.
- [x] `yarn typecheck`, `yarn lint` i `yarn test` przechodzą.

## 📣 Risks & Impact Review

| Ryzyko | Mitygacja |
|---|---|
| Store zostaje w kodzie po wdrożeniu ORM | `ModuleInfo.description` i nagłówki plików nazywają go warstwą lokalną; parent spec Phase 1 pozostaje wymagany |
| Ktoś wrzuci prawdziwe dane wrażliwe do plików JSON | Non-goals mówią to wprost; katalog jest w `.gitignore`; brak szyfrowania jest udokumentowany |
| Scoping myli się z granicą bezpieczeństwa | Udokumentowane w Non-goals; prawdziwa izolacja pozostaje po stronie bazy |
| Rozjazd kontraktu z docelowym modelem ORM | Nazwy pól 1:1 z tabelami parent speca |

## 📣 Changelog

| Data | Zmiana |
|---|---|
| 2026-09-18 | Implementacja: doprecyzowano semantykę `ScopeMismatchError` (jawne `id` z innego zakresu) i zakresowo-deterministyczne ID fixture'ów; usunięto zbędny krok `.gitignore`. |
| 2026-09-18 | Pierwsza wersja: wydzielenie `BACKLOG-001` z parent speca do osobnej specyfikacji modułu `supply_cases` z pełnym modelem czterech encji, kontraktami repozytoriów i kryteriami akceptacji. |
