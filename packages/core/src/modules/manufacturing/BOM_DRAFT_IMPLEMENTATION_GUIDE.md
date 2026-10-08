# BOM — tworzenie i edycja roboczej rewizji

Przewodnik implementacji ticketu w Open Mercato: drzewko plików, kolejność prac, elementy reużywalne i przykłady istniejącego kodu.

**Stan odniesienia:** branch `feat/omdm-8-bom-draft-crud`, commit `58682af4e` dodający szkielet manufacturing. Nowe pliki i API opisane poniżej są propozycją implementacji.

## Spis treści

1. [Zakres i model](#1-zakres-i-model)
2. [Frontend](#2-frontend)
3. [Drzewko plików](#3-drzewko-plików)
4. [Elementy reużywalne](#4-elementy-reużywalne)
5. [Implementacja krok po kroku](#5-implementacja-krok-po-kroku)
6. [API i uprawnienia](#6-api-i-uprawnienia)
7. [Testy i zakończenie](#7-testy-i-zakończenie)

## 1. Zakres i model

**User Story:** Jako użytkownik chcę tworzyć i edytować roboczy BOM wariantu produktu, aby przygotować strukturę materiałową przed jej wydaniem.

Kryteria akceptacji:

- Można utworzyć BOM dla istniejącego wariantu wynikowego z dodatnią ilością bazową.
- Można dodawać, edytować i usuwać pozycje rewizji roboczej.
- Ten sam komponent może wystąpić wielokrotnie jako osobne pozycje.
- Serwer odrzuca ilość niedodatnią i nieistniejący wariant komponentu.
- Roboczy BOM nie może zostać użyty w zleceniu.

### Stan obecny

Manufacturing ma menu, ACL, setup, tłumaczenia i puste strony BOM, zleceń oraz realizacji. Nie ma jeszcze encji, migracji, API ani komend BOM. Zapis zleceń również nie istnieje.

Moduł jest już aktywowany w [modules.ts](C:/Dev/open_mercato_fork/open-mercato/apps/mercato/src/modules.ts). Nie trzeba aktywować go ponownie. W przeglądzie specs OSS i enterprise nie znaleziono dedykowanej specyfikacji manufacturing/BOM.

Plik `w2_bom_struktury.md` jest kontekstem danych IFS: pokazuje m.in. rewizje, alternatywy, wielopoziomowość oraz ujemne ilości. **W tym tickecie ilości muszą być dodatnie.** Import IFS, wydawanie, alternatywy, scrap i rozwijanie wielopoziomowe wymagają odrębnego zakresu.

### Proponowane encje

Na ten ticket wystarczą dwie encje. BOM reprezentuje jedną konkretną rewizję.

| Encja | Najważniejsze pola | Znaczenie |
|---|---|---|
| `ManufacturingBom` | `id`, `outputVariantId`, `baseQuantity`, `revision`, `status` | Nagłówek konkretnej rewizji |
| `ManufacturingBomItem` | `id`, `bomId`, `componentVariantId`, `quantity`, `position` | Osobna pozycja materiałowa |

Obie encje mają `tenantId`, `organizationId`, `createdAt`, `updatedAt`, `deletedAt`.

Ważne zasady:

- Nowy BOM powstaje jako `draft`; zwykły CRUD nie może zmienić go na wydany.
- Baza 10 sztuk i pozycja 3 kg oznaczają 3 kg dla dziesięciu sztuk wyrobu.
- Ilości zapisuj jako `numeric` z ustaloną precyzją i skalą.
- Warianty katalogowe wskazuj przez UUID, bez relacji ORM między modułami.
- Każda pozycja ma własne UUID. Nie dodawaj unikalności komponentu w BOM ani automatycznego scalania.
- Nie narzucaj jednego BOM na wariant — przyszłe rewizje mogą wymagać wielu rekordów.
- Pusty roboczy BOM jest dozwolony; ticket nie wymaga pozycji przy utworzeniu.
- `revision` jest wersją biznesową, a `updatedAt` wersją techniczną do konfliktów edycji.

Jeżeli potrzebujesz wspólnej tożsamości grupującej wiele rewizji, ustal wcześniej model trzech encji: BOM → rewizja → pozycje. Sam ticket nie przesądza, że jest już konieczny.

## 2. Frontend

Folder `backend/` zawiera także strony React panelu backoffice. Serwerowe zapisy są w `api/` i `commands/`. Folder `frontend/` służy stronom publicznym/portalowym i nie jest tu potrzebny.

| Ekran | Adres |
|---|---|
| Lista | `/backend/manufacturing/boms` |
| Tworzenie | `/backend/manufacturing/boms/create` |
| Szczegóły i edycja | `/backend/manufacturing/boms/<id>` |

```text
Lista BOM → Utwórz nagłówek → Szczegóły BOM
                                  ├── Edycja nagłówka
                                  ├── Dodawanie pozycji
                                  ├── Edycja pozycji
                                  └── Usuwanie pozycji
```

Najpierw zapisuj nagłówek, potem pozycje. Pozwala to uniknąć mechanizmu niezapisanych linii i jednoczesnego tworzenia całego dokumentu.

## 3. Drzewko plików

Katalog modułu: `C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/manufacturing/`.

Legenda: **NOWY** — proponowany plik; **ZMIANA** — istniejący do uzupełnienia.

```text
manufacturing/
├── index.ts                                      BEZ ZMIAN
├── acl.ts                                        BEZ ZMIAN: view/manage
├── setup.ts                                      BEZ ZMIAN: istniejące granty
├── data/
│   ├── entities.ts                               NOWY
│   ├── validators.ts                             NOWY
│   └── __tests__/validators.test.ts              NOWY
├── migrations/
│   ├── Migration<timestamp>_manufacturing.ts      NOWY: nazwa z generatora
│   └── .snapshot-open-mercato.json                NOWY
├── lib/
│   ├── catalogVariants.ts                        NOWY
│   └── bomValidation.ts                          NOWY
├── commands/
│   ├── index.ts                                  NOWY
│   ├── boms.ts                                   NOWY
│   ├── bomItems.ts                               NOWY
│   └── __tests__/
│       ├── boms.test.ts                          NOWY
│       └── bomItems.test.ts                      NOWY
├── api/
│   ├── openapi.ts                                NOWY
│   ├── utils.ts                                  NOWY: mapowanie zakresu
│   ├── boms/route.ts                             NOWY
│   └── bom-items/route.ts                        NOWY
├── events.ts                                     NOWY
├── components/boms/
│   ├── CatalogVariantSelect.tsx                  NOWY
│   ├── formConfig.tsx                            NOWY
│   ├── BomForm.tsx                               NOWY
│   ├── BomItemsSection.tsx                       NOWY
│   └── BomItemDialog.tsx                         NOWY
├── backend/manufacturing/boms/
│   ├── page.tsx                                  ZMIANA
│   ├── page.meta.ts                              SPRAWDZIĆ metadane
│   ├── create/
│   │   ├── page.tsx                              NOWY
│   │   └── page.meta.ts                          NOWY
│   └── [id]/
│       ├── page.tsx                              NOWY
│       └── page.meta.ts                          NOWY
├── i18n/
│   ├── en.json                                   ZMIANA
│   ├── pl.json                                   ZMIANA
│   ├── de.json                                   ZMIANA
│   ├── es.json                                   ZMIANA
│   └── ko.json                                   ZMIANA
└── __integration__/
    ├── TC-MFG-BOM-DRAFT-API.spec.ts               NOWY
    └── TC-MFG-BOM-DRAFT-UI.spec.ts                NOWY
```

Przed kodowaniem przygotuj spec, np. `C:/Dev/open_mercato_fork/open-mercato/.ai/specs/2026-10-01-manufacturing-bom-draft-crud.md`. Ten przewodnik nie zastępuje formalnej specyfikacji.

## 4. Elementy reużywalne

| Potrzeba | Gotowy mechanizm | Twój element |
|---|---|---|
| Formularze | `CrudForm` | `BomForm`, konfiguracja pól |
| Tabele | `DataTable`, `RowActions` | Kolumny i akcje BOM |
| Wariant | `LookupSelect` + API katalogu | `CatalogVariantSelect` |
| Dialog pozycji | `Dialog` + `CrudForm embedded` | `BomItemDialog` create/edit |
| Potwierdzenie | `useConfirmDialog` | Tekst i usunięcie |
| API UI | `apiCall`, `createCrud/updateCrud/deleteCrud` | Payloady i ścieżki |
| Błędy i loading | `createCrudFormError`, `LoadingMessage/ErrorMessage`, `flash` | Tłumaczenia |
| API CRUD | `makeCrudRoute` | Konfiguracja dwóch zasobów |
| Zapisy | Command bus, helpery CRUD | Komendy i reguły BOM |
| Wersjonowanie | Optimistic locking | `updatedAt` w rekordach i formularzach |

Lokalne helpery walidacji wariantu wykorzystują komendy nagłówka i pozycji. Walidację statusu współdzielą także przyszłe zlecenia.

Nie twórz teraz ogólnej fabryki dokumentów ani nowych komponentów platformowych w packages/ui. Osobny hook `useBomItems` wydziel dopiero, gdy drugi ekran potrzebuje tej samej logiki.

## 5. Implementacja krok po kroku

Nazwy nowych plików odnoszą się do katalogu manufacturing z drzewka. Linki wskazują istniejące przykłady w bieżącym checkoutcie.

### Krok 1 — spec i decyzje

Ustal model rewizji, format ilości, numerowanie, API, blokady i testy. Zapisz zależność od implementacji zapisu zleceń.

**Źródła:** [specs/AGENTS.md](C:/Dev/open_mercato_fork/open-mercato/.ai/specs/AGENTS.md), [BACKWARD_COMPATIBILITY.md](C:/Dev/open_mercato_fork/open-mercato/BACKWARD_COMPATIBILITY.md).

### Krok 2 — data/entities.ts

Dodaj dwie encje, tabele `manufacturing_boms` i `manufacturing_bom_items`, scoping, timestamps, numeric i indeks pozycji po bomId. Dekoratory MikroORM v7 importuj z `@mikro-orm/decorators/legacy`.

**Przykład:** [sales/data/entities.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/data/entities.ts), klasy `SalesOrder` i `SalesOrderLine`.

**Co zaczerpnąć:** podział nagłówek/pozycje, UUID, zakres, daty i numeric. Pomiń ceny, podatki, waluty i realizację.

**Wariant docelowy:** [CatalogProductVariant](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/catalog/data/entities.ts:562).

### Krok 3 — data/validators.ts

Dodaj schematy create/update/delete/list obu zasobów. Typy wyprowadź przez z.infer. Waliduj UUID, dodatnie ilości, zakres numeric i pageSize do 100. Schematy używane w UI nie importują ORM.

**Przykład:** [sales/data/validators.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/data/validators.ts).

**Testy:** [validators.quantity.test.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/data/__tests__/validators.quantity.test.ts).

**Różnica:** część schematów sales dopuszcza zero. BOM musi je odrzucać.

### Krok 4 — lib/catalogVariants.ts

Dodaj wspólną funkcję sprawdzającą dostępność wariantu wynikowego i komponentu. Uwzględnij tenant, organizację i soft-delete; używaj helperów odczytu z deszyfracją.

**Przykłady:** [catalog/api/variants/route.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/catalog/api/variants/route.ts), [customers/commands/people.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/commands/people.ts).

Zod sprawdza format UUID — nie istnienie rekordu.

### Krok 5 — lib/bomValidation.ts

Dodaj `requireScopedBom`, `assertBomIsDraft` i regułę dopuszczenia BOM do zlecenia. Helpery wykorzystują zweryfikowany zakres.

**Przykład:** [sales/commands/shared.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/commands/shared.ts), szczególnie requireScopedEntity i helpery zakresu.

### Krok 6 — events.ts

Zadeklaruj przez createModuleEvents zdarzenia created/updated/deleted dla manufacturing.bom i manufacturing.bom_item.

**Przykład:** [sales/events.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/events.ts).

Przenieś strukturę deklaracji i as const. Nie dodawaj jeszcze wydania ani podwójnej emisji zdarzeń obsługiwanych przez side effects CRUD.

### Krok 7 — commands/boms.ts

Komendy: `manufacturing.boms.create/update/delete`.

Create: walidacja → zakres → wariant → draft → zapis → side effects. Update/delete sprawdzają rodzica i draft. Usuwanie obejmuje pozycje transakcyjnie, wraz z odpowiednimi snapshotami undo.

**Przykład zapisu:** [customers/commands/deals.ts — runCrudCommandWrite](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/commands/deals.ts:777).

**Zakres:** [customers/commands/people.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/commands/people.ts:936).

Szukaj prepare, execute, captureAfter, undo, registerCommand. Skutki uboczne uruchamiaj po skutecznym zapisie zgodnie z helperami frameworka.

### Krok 8 — commands/bomItems.ts

Komendy: `manufacturing.bom_items.create/update/delete`.

Każda sprawdza rodzica i draft. Update/delete wyszukują pozycję po id, bomId i zakresie. Update nie przenosi pozycji do innego BOM. Przy zapisie waliduj końcowy stan ilości i komponentu.

**Przykład:** [sales/commands/documents.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/commands/documents.ts), szukaj sales.orders.lines.upsert/delete.

Przenieś kontrolę rodzica i pozycji, pomiń pricing i wysyłki. Sprawdzenie statusu i zapis muszą być spójne transakcyjnie; przyszłe wydawanie powinno używać zgodnego mechanizmu synchronizacji.

### Krok 9 — commands/index.ts

Importuj pliki rejestrujące komendy: `import './boms'` i `import './bomItems'`.

**Przykład:** [sales/commands/index.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/commands/index.ts).

### Krok 10 — migracja i snapshot

Uruchom generate i db:generate. Przejrzyj migrację oraz snapshot. Zachowaj tylko zmianę manufacturing. Dodaj ograniczenia dodatnich ilości, bez unikalności komponentu w BOM.

**Zasady:** [core/AGENTS.md](C:/Dev/open_mercato_fork/open-mercato/packages/core/AGENTS.md), [cli/AGENTS.md](C:/Dev/open_mercato_fork/open-mercato/packages/cli/AGENTS.md).

Nie edytuj rejestrów generated ręcznie. Nie stosuj migracji lokalnie bez zgody.

### Krok 11 — api/openapi.ts i api/utils.ts

Użyj createCrudOpenApiFactory dla dokumentacji obu zasobów. W utils współdziel potrzebne mapowanie inputu i zweryfikowanego zakresu.

**Przykłady:** [sales/api/openapi.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/api/openapi.ts), [customers/api/utils.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/api/utils.ts).

Nie ufaj tenantId/organizationId przesłanym przez klienta bez weryfikacji kontekstu.

### Krok 12 — api/boms/route.ts

Skonfiguruj makeCrudRoute: encja, scoping, soft-delete, indexer, lista, filtry, komendy, metadata i openApi. Zwracaj updatedAt.

**Wzorzec:** [customers/api/people/route.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/api/people/route.ts:80), szczególnie [actions](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/api/people/route.ts:377).

**Dokument:** [sales/api/orders/route.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/api/orders/route.ts).

Route obsługuje kontrakt i transport. Reguły domenowe pozostają w komendach.

### Krok 13 — api/bom-items/route.ts

Dodaj CRUD pozycji, filtrowanie po bomId, kontrolę rodzica i mapowanie komend.

**Przykłady:** [sales/api/order-lines/route.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/api/order-lines/route.ts), [makeSalesLineRoute.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/lib/makeSalesLineRoute.ts).

Odpowiedniki order_id/orderId to bom_id/bomId. Nie importuj fabryki sales do manufacturing — wykorzystaj wzorzec na ogólnym makeCrudRoute.

### Krok 14 — components/boms/CatalogVariantSelect.tsx

Jeden LookupSelect dla wyrobu i komponentu: value/onChange, wyszukiwanie, etykieta obecnego wyboru, disabled. Korzysta z apiCall, nie zapisuje BOM.

**Produkt:** [LineItemDialog — loadProductOptions](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/components/documents/LineItemDialog.tsx:749).

**Wariant:** [LineItemDialog — loadVariantOptions](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/components/documents/LineItemDialog.tsx:797).

**API:** [catalog/api/variants/route.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/catalog/api/variants/route.ts). Odczyt wymaga catalog.products.view.

### Krok 15 — components/boms/formConfig.tsx i BomForm.tsx

Konfiguracja pól/grup/payloadów plus jeden CrudForm create/edit. W edit initialValues zawiera id i updatedAt.

**Konfiguracja:** [customers/components/formConfig.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/components/formConfig.tsx).

**Wspólny formularz:** [TaskForm.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/components/detail/TaskForm.tsx). Zobacz mode, initialValues, onSubmit, onCancel i memoizację fields/groups.

**Podłączenie zapisu:** [customers/people/create/page.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/create/page.tsx).

Wykorzystaj obsługę pól liczbowych i lokalizacji; nie twórz własnego parsera przecinka.

### Krok 16 — components/boms/BomItemDialog.tsx

Jeden dialog create/edit: bomId, opcjonalny item, open, onClose, onSaved. Dialog + CrudForm embedded, pola komponent i ilość.

**Przykład:** [LineItemDialog — CrudForm](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/components/documents/LineItemDialog.tsx:3078).

**Błędy pól:** [createCrudFormError](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/components/documents/LineItemDialog.tsx:1377).

Edit używa updatedAt pozycji. Zapewnij Ctrl/Cmd+Enter i Escape. Po zapisie odśwież tabelę.

### Krok 17 — components/boms/BomItemsSection.tsx

apiCall pobiera pozycje, DataTable je pokazuje, RowActions otwiera dialog lub usuwa. Kluczem jest UUID pozycji, nie komponentu.

**Tabela:** [customers/people/page.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/page.tsx:899).

**Akcje:** [RowActions](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/page.tsx:938).

**Zapisy poza formularzem:** [guarded mutation](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/page.tsx:468).

Usuwanie wymaga potwierdzenia, useGuardedMutation, wersji pozycji i obsługi konfliktu. Zachowaj stabilne ID akcji edit/delete.

### Krok 18 — strony i page.meta.ts

Zmień listę; dodaj create i [id] z metadata auth/features.

- Lista: wariant, rewizja, status, baza i akcje.
- Create: BomForm, po zapisie przejście do szczegółów.
- Detail: odczyt, BomForm i BomItemsSection jako oddzielne elementy.

**Lista:** [customers/people/page.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/page.tsx).

**Create:** [customers/people/create/page.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/customers/backend/customers/people/create/page.tsx).

**Host szczegółów:** [sales/orders/[id]/page.tsx](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/backend/sales/orders/[id]/page.tsx).

Użyj Page/PageBody, LoadingMessage/ErrorMessage. Przy braku rekordu nie pokazuj formularza i akcji. Nie zagnieżdżaj formularzy.

### Krok 19 — tłumaczenia i granty

Uzupełnij pięć istniejących locale: pola, przyciski, błędy, status, sukces i potwierdzenia.

**Przykłady:** [manufacturing/acl.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/manufacturing/acl.ts), [setup.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/manufacturing/setup.ts), [pl.json](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/manufacturing/i18n/pl.json).

Istniejące view/manage wystarczą. Nowe features oznaczają zmianę acl, setup i uwzględnienie grantów istniejących tenantów.

### Krok 20 — testy i integracja ze zleceniami

Dodaj testy walidatorów, komend i integracyjne. Fixtures tworzą własne produkty i warianty oraz sprzątają dane.

**Przykład reguły przez API:** [TC-SALES-4021-order-requires-line.spec.ts](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/__integration__/TC-SALES-4021-order-requires-line.spec.ts): apiRequest, auth, asercje i cleanup w finally.

**Nie przenoś reguły sales wymagającej co najmniej jednej pozycji do roboczego BOM.**

Blokadę draft podłącz do rzeczywistej komendy tworzenia/zmiany przypisania BOM w zleceniu. Obecnie taka komenda nie istnieje. Sam helper i filtr dropdownu nie zamykają kryterium; potrzebny będzie test integracyjny zapisu zlecenia.

## 6. API i uprawnienia

| Operacja | Proponowany endpoint |
|---|---|
| Lista / odczyt BOM | GET /api/manufacturing/boms oraz ?id=<uuid> |
| Tworzenie / aktualizacja | POST / PUT /api/manufacturing/boms |
| Usunięcie BOM | DELETE /api/manufacturing/boms?id=<uuid> |
| Lista pozycji | GET /api/manufacturing/bom-items?bomId=<uuid> |
| Tworzenie / aktualizacja pozycji | POST / PUT /api/manufacturing/bom-items |
| Usunięcie pozycji | DELETE /api/manufacturing/bom-items?id=<uuid>&bomId=<uuid> |

GET wymaga manufacturing.view; zapisy manufacturing.manage. W obecnym setup admin i superadmin mają wildcard, employee tylko odczyt. Wybór katalogowy wymaga także catalog.products.view.

### Optimistic locking

Prosty model: nagłówek używa updatedAt BOM, pozycja używa updatedAt pozycji. CrudForm automatycznie wyprowadza nagłówek z initialValues.updatedAt. Nie dokładaj drugiego identycznego wrappera w onSubmit.

Dla operacji poza CrudForm użyj guarded mutation, scoped headers z buildOptimisticLockHeader i surfaceRecordConflict.

**Źródło:** [concurrency-locking.mdx](C:/Dev/open_mercato_fork/open-mercato/apps/docs/docs/framework/data-integrity/concurrency-locking.mdx).

**Alternatywa:** [enforceSalesDocumentOptimisticLock](C:/Dev/open_mercato_fork/open-mercato/packages/core/src/modules/sales/commands/shared.ts:38) blokuje cały dokument przy edycji linii. Wymaga podbijania wersji rodzica i odświeżania jej po zmianie. Nie łącz dwóch kontroli porównujących ten sam nagłówek z różnymi rekordami.

## 7. Testy i zakończenie

| Plik w manufacturing | Zakres |
|---|---|
| data/__tests__/validators.test.ts | Ilości, UUID, numeric, update, paginacja |
| commands/__tests__/boms.test.ts | Draft, wariant wynikowy, zakres, usuwanie i undo |
| commands/__tests__/bomItems.test.ts | Duplikaty, przynależność pozycji, wariant, status |
| __integration__/TC-MFG-BOM-DRAFT-API.spec.ts | CRUD, odrzucenia, uprawnienia, konflikty |
| __integration__/TC-MFG-BOM-DRAFT-UI.spec.ts | Utworzenie, operacje pozycji, zapis i reload |

### Lista kontrolna

- [ ] Istniejący wariant i dodatnia baza pozwalają utworzyć BOM.
- [ ] Zero, ilości ujemne i nieistniejące warianty są odrzucane.
- [ ] Ten sam komponent występuje w dwóch niezależnych pozycjach.
- [ ] Nie można modyfikować pozycji innego BOM ani danych obcego zakresu.
- [ ] Status jest egzekwowany na serwerze przy wszystkich mutacjach.
- [ ] Wszystkie zapisy przechodzą przez komendy i mechanizmy mutation guards.
- [ ] API zwraca updatedAt; UI używa wersji właściwej encji.
- [ ] Konflikty równoczesnego update/delete są obsługiwane.
- [ ] Trasy eksportują metadata i openApi oraz mają indexer.
- [ ] UI używa gotowych komponentów, apiCall, tłumaczeń i tokenów DS.
- [ ] Dialogi mają skróty klawiaturowe i nie ma zagnieżdżonych formularzy.
- [ ] Migracja i snapshot obejmują wyłącznie zamierzoną zmianę.
- [ ] Testy mają własne fixtures i cleanup.
- [ ] Zależność od zapisu zleceń jest jawnie rozliczona.

### Walidacja podczas implementacji

Wybierz runner według [agent-instructions.md](C:/Dev/open_mercato_fork/open-mercato/.ai/docs/agent-instructions.md): działający compose app → Docker; w przeciwnym razie local. W Docker zastąp yarn X przez node scripts/docker-exec.mjs X.

```bash
yarn generate
yarn db:generate
yarn build:packages
yarn typecheck
```

Uruchom także właściwe testy jednostkowe oraz integracyjne manufacturing. Kontrole tłumaczeń: yarn i18n:check-hardcoded i yarn i18n:check-values. Przejrzyj wyniki generowania. Nie uruchamiaj db:migrate bez zgody.

### Polecana kolejność czytania kodu

1. TaskForm — wspólny formularz create/edit.
2. customers/api/people — API i mapowanie komend.
3. customers/commands/deals — zapis domenowy i side effects.
4. sales/api/order-lines + makeSalesLineRoute — pozycje dokumentu.
5. Wybrane fragmenty LineItemDialog — wariant i dialog.
6. customers/people/page — tabela i akcje.
7. catalog/api/variants — kontrakt wariantów.

Przenoś strukturę rozwiązania i integrację z frameworkiem. Pricing, podatki, płatności i workflow sprzedaży nie są częścią tego ticketu.

