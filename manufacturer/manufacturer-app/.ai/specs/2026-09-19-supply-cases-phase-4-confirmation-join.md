# Supply Cases Phase 4 — confirmation join i atomowe domknięcie

**Date:** 2026-09-19
**Status:** Ready for implementation (v2, po review); adapter execution currently blocked by the missing Phase 1/2 closure evidence

## Implementation gate — Phase 3/Phase 4 adapter (2026-09-19)

The adapter handoff is `BLOCKED` before implementation because the required
`./runs/2026-09-19-phase1-phase2-closure/STATE.md` and `HANDOFF.md` files are not present in the
repository. The Phase 1/2 exit gates therefore cannot be confirmed from the required source of
truth. No adapter, enum, consumer, or test changes are authorized in this blocked run.

The resolved contract decision is additive: introduce `COVERAGE_SHORTFALL` while retaining every
existing `needsAttentionReason` value. Use it only when every required confirmation is complete
and valid but calculated coverage is still below the required quantity; do not report that case as
`ANALYSIS_FAILED`. The adapter must keep returning `unreadable_plan` for unknown/damaged shapes
and `invalid_plan` for self-contradictory plans, remain pure and non-mutating, and preserve the
exact plan snapshot/hash relationship when this work resumes.
**Parent spec:** [`2026-09-18-supplier-email-agent-workflow.md`](./2026-09-18-supplier-email-agent-workflow.md) → Phase 4
**Sibling:** [`2026-09-19-supply-cases-phase-2-initial-impact.md`](./2026-09-19-supply-cases-phase-2-initial-impact.md)
**Backward compatibility:** [`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`](../guides/upstream/BACKWARD_COMPATIBILITY.md) — wymagane przed zmianą `needsAttentionReasonSchema`
**Scope:** Manufacturer A, moduł `supply_cases`, wyłącznie Phase 4

## 📌 TLDR

Phase 4 zamienia potwierdzenia dostawców w jedną, nieodwracalną zmianę stanu produkcji — albo w brak zmiany. Potwierdzenia mogą przyjść w dowolnej kolejności, wielokrotnie i po restarcie; zbiór wymaganych potwierdzeń wynika **z wybranego planu**, nigdy z tego, co przyszło. Dopóki zbiór nie jest kompletny i każde potwierdzenie nie zgadza się z planem, case nie jest zielony i żadna mutacja nie zachodzi. Pełne pokrycie jest **warunkiem** `RESOLVED`, nie jego skutkiem.

## 📌 Problem Statement

Po Phase 3 case ma wybrany, niezmienny `pendingResolutionPlan` i wysłane `SUPPLY_ACCEPTANCE`. Brakuje jedynej rzeczy, która czyni ten plan faktem: potwierdzeń od dostawców — i bezpiecznego momentu, w którym wolno na ich podstawie ruszyć zobowiązania, zapas i produkcję.

Ten moment jest niebezpieczny z czterech powodów naraz:

- potwierdzenia przychodzą **asynchronicznie i w dowolnej kolejności**, a każde to osobny e-mail podlegający at-least-once;
- dostawca może potwierdzić **coś innego** niż zaakceptowaliśmy;
- mutacja dotyka **wielu rekordów**, a backendem jest JSON store bez transakcji;
- „zielony" case jest widoczną obietnicą wobec klienta i nie wolno go pokazać przedwcześnie.

## 📌 Goals

- **REQ-P4-001:** `SUPPLY_COMMITMENT_CONFIRMED` jest atomowo zaklaimowane, zwalidowane wobec planu i zapisane idempotentnie.
- **REQ-P4-002:** zbiór wymaganych potwierdzeń jest **odczytany z wybranego planu**; potwierdzenie spoza zbioru nigdy nie domyka joinu.
- **REQ-P4-003:** kolejność potwierdzeń nie wpływa na wynik, **ani na stan końcowy planu**, ani przy współbieżnym nadejściu.
- **REQ-P4-004:** niekompletny zbiór trzyma case nie-zielony i nie wykonuje żadnej mutacji.
- **REQ-P4-005:** potwierdzenie rozbieżne z planem daje `NEEDS_ATTENTION: CONFIRMATION_MISMATCH`, zero mutacji.
- **REQ-P4-006:** `resolution.apply_confirmed` mutuje **dokładnie raz**, pod wersjonowanym zapisem i z preconditions po stronie komendy.
- **REQ-P4-007:** replay i restart na każdej granicy nie powtarzają mutacji ani nie emitują drugiego `resolved`.
- **REQ-P4-008:** `RESOLVED` wymaga przeliczonego `calculatePlanCoverage(plan).isFullyCovered === true`.

## 📌 Non-goals

- Phase 2 i Phase 3: impact service, obaj advisorzy, obie decyzje, wysyłka RFQ i `SUPPLY_ACCEPTANCE`.
- Kompensacja biznesowa po `RESOLVED` — wymaga osobnego case'a kompensującego; tu tylko odnotowane.
- Migracja JSON store do ORM, `db:migrate`.
- UI: `data/read-model.ts`, `api/`, `backend/`, `components/` należą do innego agenta.
- Renegocjacja z dostawcą po mismatchu (człowiek robi to poza systemem).
- **Ocena wpływu na termin klienta.** Plan niesie skutek dla klienta jako część decyzji, którą człowiek już zatwierdził. Phase 4 nie przelicza jej ponownie i nie blokuje na niej — patrz „Bramka zieloności".

## 📌 Assumption Register

Phase 3 nie istnieje w kodzie. Phase 4 jest budowana **przeciwko istniejącemu schematowi case'a**:

- **A-1:** `selectedResolutionPlanId` i `pendingResolutionPlan` ustawia Phase 3 i od tego momentu są **niezmienne**.
- **A-2:** status wejściowy to `WAITING_FOR_SUPPLIER_CONFIRMATIONS`.
- **A-3:** `pendingResolutionPlan` (jsonb) niesie **cały** kontrakt niżej, łącznie z `planHash`. `SupplyCase` nie ma osobnej kolumny na hash i Phase 4 jej nie dodaje — hash jest częścią snapshotu planu, bo opisuje ten snapshot. Phase 3 może dodać pola; nie może usunąć tych.
- **A-4:** do czasu Phase 3 testy budują `pendingResolutionPlan` z fixture'ów. Join jest funkcją planu i potwierdzeń, więc nie osłabia to oracle'i.

## 📌 Kontrakt planu

Join czyta wyłącznie ten podzbiór, **parsowany Zodem na wejściu** (`pendingResolutionPlan` jest `jsonValueSchema`, więc kompilator niczego tu nie chroni):

```ts
type ConfirmationPlanContract = {
  planId: 'ACCEPT_DELAY' | 'USE_STOCK' | 'USE_ALTERNATIVE'
  planHash: string
  /** Rola ma LISTĘ zobowiązań: ACCEPT_DELAY to `300 Wed` + `200 Fri`, a USE_STOCK to COMMIT + CANCEL. */
  supplierCommitments: Array<{
    role: 'SUPPLIER_1' | 'SUPPLIER_2'
    supplierEmail: string
    quantity: number
    deliveryDate: string
    intent: 'COMMIT' | 'CANCEL'
  }>
  /** Docelowa alokacja zapasu dla tego planu — wartość ABSOLUTNA, nie delta. */
  internalStockAllocation: number
  requiredConfirmations: Array<'SUPPLIER_1' | 'SUPPLIER_2'>
  /** Koszt dodatkowy wg zatwierdzonego planu; `null` gdy nieznany. */
  additionalCost: number | null
}
```

`requiredConfirmations` jest **odczytywane z planu, a nie wyliczane z ról obecnych w `supplierCommitments`**. Plan jest snapshotem decyzji człowieka; wyliczanie zbioru na nowo przy każdym odczycie oznaczałoby, że zmiana kodu zmienia wstecznie, co uznajemy za komplet dla case'a już oczekującego.

Walidacja spójności planu (jednorazowo, przy pierwszym użyciu): **każda rola z `requiredConfirmations` ma co najmniej jedno zobowiązanie, i rola każdego zobowiązania należy do `requiredConfirmations`**. Niespójny plan to `NEEDS_ATTENTION: MISSING_DATA`, nie zgadywanie.

Referencyjnie (parent spec): `ACCEPT_DELAY` → `[SUPPLIER_1]`, `USE_STOCK` → `[SUPPLIER_1]`, `USE_ALTERNATIVE` → `[SUPPLIER_1, SUPPLIER_2]`.

## 📌 Co naprawdę znaczy `internalStockQuantity`

**To jest alokacja już wliczona w pokrycie, a nie wolne saldo magazynu.** `calculatePlanCoverage` liczy `coveredQuantity = min(internalStockQuantity + committed, requiredQuantity)` (`data/coverage.ts`), więc pole jest składnikiem pokrycia. Odejmowanie od niego zużycia zmniejszałoby pokrycie dokładnie wtedy, gdy plan zakłada użycie zapasu — i bramka zieloności nigdy by nie przeszła dla `USE_STOCK`.

Dlatego apply **USTAWIA** `internalStockQuantity = plan.internalStockAllocation`. Zapis wartości absolutnej, nie delty, jest jedynym powodem, dla którego krok jest idempotentny: dwa wykonania dają ten sam stan, a nie podwójne odjęcie. Dla `ACCEPT_DELAY` alokacja wynosi `0`, więc plan bez zapasu zeruje alokację i case nie jest zielony — co jest poprawne, bo ta gałąź świadomie opóźnia klienta.

> Rezerwacja wolnego magazynu poza planem nie istnieje w tym module i Phase 4 jej nie wprowadza.

## 📌 Gdzie żyją potwierdzenia

**Nowa, append-only, scoped kolekcja `SupplyConfirmation`** (plik `supply-confirmations.json`; wpis w `STORE_FILE_NAMES`, w `purgeScope` i — jeśli scenariusz demo ma je nieść — w `seedScenario`/`SeededScenario`).

```ts
export const supplyConfirmationSchema = z.object({
  id: identifierSchema,
  ...scopeShape,
  caseId: identifierSchema,
  planId: z.string().min(1),
  planHash: z.string().min(1),
  role: z.enum(['SUPPLIER_1', 'SUPPLIER_2']),
  supplierEmail: z.string().min(1),
  inboundMessageId: identifierSchema,
  rfcMessageId: identifierSchema,
  /** Cała lista z ekstrakcji — dostawca potwierdza „300 Wed i 200 Fri" jednym mailem. */
  confirmedCommitments: z.array(extractedCommitmentSchema),
  verdict: z.enum(['MATCHES_PLAN', 'DIFFERS_FROM_PLAN']),
  mismatchReasons: z.array(z.string()),
  /** `{caseId}:{planHash}:{role}` — jedno potwierdzenie na rolę na plan. */
  idempotencyKey: identifierSchema,
  createdAt: isoDateTimeSchema,
})
```

Repozytorium wzorowane na `JsonOutboundCorrelationRepository` (ten sam runtime guard na `update`/`softDelete`), z **jedną dodatkową metodą**, opisaną niżej.

**Odrzucone alternatywy:** pole jsonb na case'ie (read-modify-write gubi równoległe potwierdzenie — ta sama klasa błędu, przed którą broni `appendIfAbsent` w intake'u) oraz wyprowadzanie joinu z `InboundMessage` (werdykt walidacji nie ma gdzie zamieszkać, a `recordTriage` jest jednorazowy i należy do triage'u). `supplier1ConfirmedAt` / `supplier2ConfirmedAt` zostają jako **projekcja do odczytu**.

## 📌 Wyścig przy domknięciu i jak jest wygrany

Naiwne „zapisz potwierdzenie, potem sprawdź komplet" **nie jest** wolne od wyścigu. `JsonCollection.mutate` serializuje tylko wewnątrz jednej kolekcji i tylko na czas mutatora; ocena kompletu po jego powrocie daje dwa złe przeploty: obaj wywołujący widzą komplet i obaj dispatchują apply, albo żaden nie widzi kompletu i case **utyka na zawsze** — z kłamliwym powodem `WAIT_TIMEOUT`.

**Ocena joinu dzieje się wewnątrz mutatora.** `JsonCollection.mutate` zwraca `{ records, result }`, więc decyzja jest podejmowana w sekcji krytycznej, na pełnej tablicy rekordów, i wraca jako wynik:

```ts
recordAndEvaluate(
  scope: StoreScope,
  input: SupplyConfirmationRecordInput,
  requiredRoles: readonly ConfirmationRole[],
): Promise<{
  confirmation: SupplyConfirmation
  created: boolean
  /** Policzone po zastosowaniu tego zapisu, atomowo względem innych zapisów. */
  join: 'PENDING' | 'COMPLETE' | 'BLOCKED'
  /** True dokładnie dla jednego wywołania w całym życiu planu. */
  closedTheSet: boolean
}>
```

`closedTheSet` jest jedynym wyzwalaczem apply. Jako obrona w głąb `apply_confirmed` i tak przelicza join od zera (to jego własny precondition), a `already_applied` jest łagodnym no-opem — więc nadmiarowy dispatch jest nieszkodliwy, a brakujący niemożliwy.

## 📌 Walidacja jednego potwierdzenia

`lib/resolution/validateConfirmation.ts` — czysta funkcja `(planContract, role, extraction) → ConfirmationVerdict`.

Porównanie jest **zbiorowe**: oczekiwany zbiór to `{quantity, dzień}` dla wszystkich zobowiązań tej roli o `intent: 'COMMIT'`; otrzymany to `{quantity, dzień}` z `confirmedCommitments`. Równość zbiorów = `MATCHES_PLAN`. Zobowiązania `CANCEL` nie muszą być wyliczone przez dostawcę — potwierdza on to, co dostarczy, nie to, czego nie dostarczy.

| Reason | Warunek |
|---|---|
| `UNKNOWN_ROLE` | nadawca nie odpowiada żadnej roli w `requiredConfirmations` |
| `QUANTITY_OR_DATE_DIFFERS` | zbiory nie są równe |
| `UNRESOLVED_FACTS` | `unresolved.length > 0` **lub** `commitments.length === 0` |
| `PLAN_SUPERSEDED` | `planHash` z potwierdzenia ≠ `planHash` z bieżącego `pendingResolutionPlan` |

Data porównywana **dziennie**, nie co do sekundy: dostawca pisze „środa", więc porównanie do sekundy dawałoby mismatch na każdej poprawnej odpowiedzi. Ilość porównywana dokładnie — „199 zamiast 200" to brak sztuki w produkcji, nie drobiazg.

Rozbieżność **nie jest błędem technicznym**: zapisuje się z werdyktem `DIFFERS_FROM_PLAN`, case idzie w `NEEDS_ATTENTION: CONFIRMATION_MISMATCH`, mutacji nie ma, dowód zostaje.

`UNKNOWN_ROLE` jest w praktyce nieosiągalne po triage'u (lista kandydatów dopuszcza tylko uczestników case'a), ale jest sprawdzane, bo komenda jest wywoływalna również przez człowieka.

## 📌 Komenda `supply_cases.resolution.record_confirmation`

- Wejście `{ inboundMessageId, scope? }`; `scope` honorowane wyłącznie pod `ctx.systemActor` — dokładnie jak `apply_triage` (T-09b).
- ACL dla wywołania przez człowieka: `supply_cases.manage` (istnieje, `acl.ts:14`).
- Idempotencja: klucz `{caseId}:{planHash}:{role}`. Powtórka zwraca `already_recorded`, `closedTheSet: false`.
- Preconditions: case w scope; status `WAITING_FOR_SUPPLIER_CONFIRMATIONS` **lub** `NEEDS_ATTENTION` z powodem `CONFIRMATION_MISMATCH` albo `WAIT_TIMEOUT` (spóźnione lub drugie potwierdzenie wolno zarejestrować — inaczej mail przychodzący sekundę po timeoucie znikałby bez śladu); `pendingResolutionPlan` obecny i spójny.
- Po rejestracji z `closedTheSet === true` i joinem `COMPLETE` → dispatch `apply_confirmed`.
- Post-commit: `supply_cases.case.confirmation_recorded`.

## 📌 Komenda `supply_cases.resolution.apply_confirmed`

Jedyne miejsce, które zmienia stan produkcji. ACL dla człowieka: `supply_cases.decisions.apply`.

**Preconditions sprawdzane po stronie komendy** (wywołujący mógł zdecydować na nieświeżym odczycie):

1. status `WAITING_FOR_SUPPLIER_CONFIRMATIONS` lub `APPLYING_RESOLUTION` (wznowienie po crashu). Status `RESOLVED` → `already_applied`, **bez mutacji, bez eventu, bez błędu**;
2. `selectedResolutionPlanId` i `planHash` niezmienione od rejestracji potwierdzeń;
3. zbiór `requiredConfirmations` kompletny — przeliczony od zera;
4. **każde** potwierdzenie ma werdykt `MATCHES_PLAN`;
5. zapis case'a przez `updateIfUnchanged(scope, id, expectedUpdatedAt, patch)` — nowa metoda `SupplyCaseRepository`, w której porównanie wersji dzieje się **wewnątrz** `JsonCollection.mutate`. Istniejący `update` nie przyjmuje wersji, więc dzisiejszy wzorzec check-then-act jest doradczy i nie serializuje dwóch równoległych apply. `expectedUpdatedAt` pochodzi z odczytu case'a wykonanego przez samą komendę, nie od wywołującego.

**Kolejność zapisu i punkt commitu.** JSON store nie ma transakcji między kolekcjami. Zamiast udawać atomowość, kolejność jest tak dobrana, by każdy moment przerwania był bezpieczny, a komenda w pełni wznawialna:

1. `case.status = APPLYING_RESOLUTION` (marker wznowienia, przez `updateIfUnchanged`);
2. `ProductionPlan.supplierCommitments` — **pełny REPLACE zobowiązań ról wymienionych w planie**, wyliczony ze snapshotu: `COMMIT` → `{status: 'CONFIRMED'}`, `CANCEL` → `{status: 'CANCELLED'}`. Wiersze dostawców **nieobecnych w planie zostają nietknięte** (plan innego case'a może współdzielić ten sam `ProductionPlan`). Replace, a nie merge, bo nie istnieje klucz dopasowania: `supplierCommitmentSchema` nie ma id ani roli, a doklejenie wiersza do istniejącego `500 Wed COMMITTED` dałoby pokrycie z powietrza;
3. `internalStockQuantity = plan.internalStockAllocation`;
4. przeliczenie `calculatePlanCoverage` i zapis `riskStatus`;
5. **dopiero teraz** `case.status = RESOLVED`, `resolvedAt`, `actualAdditionalCost = plan.additionalCost` — punkt commitu.

Crash po kroku 1 zostawia case w `APPLYING_RESOLUTION` — nie-zielony, a więc bezpieczny — i wznowienie przechodzi tę samą ścieżkę. Kroki 2–4 zapisują **stan docelowy wyliczony z planu, nigdy deltę**, więc powtórzenie daje ten sam wynik.

**Bramka zieloności.** Po kroku 4: `calculatePlanCoverage(plan).isFullyCovered === true`. To jest **jeden** warunek, nie dwa: `deriveRiskStatus` zwraca `PROTECTED` dokładnie wtedy, gdy `coveredQuantity >= requiredQuantity`, czyli gdy `isFullyCovered`. Parent spec mówi „500/500 i PROTECTED" jako jedno zdanie biznesowe i tak jest tu realizowane; powielanie go jako dwóch niezależnych asercji sugerowałoby zabezpieczenie, którego nie ma. Jeśli warunek nie zachodzi — case idzie w `NEEDS_ATTENTION` i **nie** dostaje `RESOLVED`. To nie jest nadmiar: plan mógł powstać na nieaktualnym stanie, a to jedyny moment, w którym da się to wykryć na prawdziwych danych.

> **Wymaga decyzji właściciela projektu przed implementacją:** `needsAttentionReasonSchema` (`data/types.ts:132`) nie ma wartości na „potwierdzenia zgodne, pokrycie i tak niepełne". `ANALYSIS_FAILED` w tej sytuacji kłamie. Rekomendacja: dodać `COVERAGE_SHORTFALL`. To **contract surface** — wymaga przeczytania `BACKWARD_COMPATIBILITY.md`, wpisu w 5 locale i sprawdzenia konsumentów `needsAttentionReason` (read-model i UI należą do innego agenta). **Do czasu zgody implementacja używa `ANALYSIS_FAILED` i zostawia `TODO` z odnośnikiem do tej sekcji.**

## 📌 Timeout — właściciel jest po naszej stronie

**Silnik workflow nie implementuje timeoutu sygnału.** `step-handler` parsuje `signalConfig.timeout`, zapisuje go do zdarzenia `SIGNAL_AWAITING` i `outputData`, po czym ustawia instancję na `PAUSED`; nic tej wartości nie odczytuje i nie istnieje żaden sweeper. Oparcie TEST-012 na `signalConfig.timeout` byłoby oparciem go na funkcji, której nie ma.

Dlatego timeout jest **app-owned**:

- czysta funkcja `lib/resolution/confirmationDeadline.ts`: `(case, now, windowMs) → 'WITHIN' | 'EXPIRED'`, licząc od `case.updatedAt` w momencie wejścia w `WAITING_FOR_SUPPLIER_CONFIRMATIONS`;
- komenda `supply_cases.resolution.expire_confirmations` ustawia `NEEDS_ATTENTION: WAIT_TIMEOUT` **wyłącznie** gdy join jest `PENDING` (nigdy gdy `COMPLETE` — to zamieniłoby wyścig w kłamstwo);
- wyzwalaczem jest zamiatanie po case'ach w `WAITING_FOR_SUPPLIER_CONFIRMATIONS`. **Plumbing schedulera jest poza zakresem Phase 4**; komenda jest wywoływalna z CLI i to wystarcza do demo i do testów.

Oracle testuje czystą funkcję i komendę, nie harmonogram.

## 📌 Workflow

**Jeden dispatcher.** Apply wywołuje komenda `record_confirmation`, nie krok workflow. Krok AUTOMATED robiący to samo byłby drugim miejscem decydującym o mutacji produkcji.

| Step ID | Type | Odpowiedzialność |
|---|---|---|
| `await-confirmations` | `WAIT_FOR_SIGNAL` | czeka, aż rezolucja zostanie zastosowana |

Sygnał `supply_cases.resolution.confirmations_complete` emituje `apply_confirmed` **po** punkcie commitu. Workflow jest tu obserwatorem trwałego faktu, a nie jego przyczyną.

> **Kolizja, którą trzeba uzgodnić przed scaleniem:** dziś `workflows.ts` ma jedyne przejście z `await-reply` → `end` (`reply-to-end`), a `__tests__/inbound-workflow-engine.db.test.ts` asertuje `currentStepId === 'end'` i `COMPLETED` po pierwszej odpowiedzi. Wstawienie `await-confirmations` **przepisuje `reply-to-end`** — to nie jest zmiana czysto addytywna, wbrew temu, co twierdziła wersja 1 tej specki. Równocześnie Phase 2 przepina `await-reply` na oczekiwanie oferty Supplier 2 i dodaje własne kroki. **Żadna z dwóch specek nie jest właścicielem finalnej kolejności kroków — trzeba ją ustalić jawnie przed scaleniem którejkolwiek.** `TEST-002A` musi zostać **zaktualizowany razem ze zmianą definicji, nie skasowany**; jego wartość to restart, brak duplikatu i scope, a nie konkretne ID kroku.

## 📌 Events

Dokładane do `events.ts` (`as const`, payload tylko identyfikatory i scope — nigdy proza dostawcy), oba emitowane post-commit, każdy z jednego miejsca:

- `supply_cases.case.confirmation_recorded` — `{ caseId, correlationId, role, verdict, planId, inboundMessageId, tenantId, organizationId }`
- `supply_cases.case.resolved` — `{ caseId, correlationId, planId, coveredQuantity, requiredQuantity, riskStatus, tenantId, organizationId }`

## 📌 Testy

Numeracja mieści się w przydziale Phase 4 z parent speca (TEST-010–014); `TEST-015`–`TEST-018` są tam **już zajęte** i nie wolno ich przedefiniować. Wszystkie poniższe są testami JSON-store i czystych funkcji — **żaden nie wymaga Postgresa**; workflow nie jest ich przedmiotem.

| ID | Scenariusz | Oracle |
|---|---|---|
| TEST-010 | S1 potem S2 | jedna mutacja planu, `RESOLVED`, jeden `resolved` event |
| TEST-011 | S2 potem S1 | **identyczny stan planu** jak TEST-010, nie tylko ten sam status |
| TEST-012 | jedno potwierdzenie + `expire_confirmations` | `WAIT_TIMEOUT`, zero mutacji, nie-zielony |
| TEST-012A | komplet potwierdzeń, potem `expire_confirmations` | brak `WAIT_TIMEOUT`; timeout nie nadpisuje domknięcia |
| TEST-013A | ilość/data rozbieżna | `QUANTITY_OR_DATE_DIFFERS`, `CONFIRMATION_MISMATCH`, zero mutacji |
| TEST-013B | nadawca spoza `requiredConfirmations` | `UNKNOWN_ROLE`, join nie domknięty |
| TEST-013C | ekstrakcja z `unresolved` lub bez commitments | `UNRESOLVED_FACTS` |
| TEST-013D | potwierdzenie pod starym `planHash` | `PLAN_SUPERSEDED`, join nie domknięty |
| TEST-014A | replay każdego potwierdzenia | jeden rekord na rolę, `closedTheSet` dokładnie raz |
| TEST-014B | powtórny `apply_confirmed` | `already_applied`, brak drugiej mutacji, **brak drugiego eventu**, zapas nie odjęty dwa razy |
| TEST-014C | dwa potwierdzenia domykające współbieżnie | dokładnie jedno `closedTheSet`, jedna mutacja |
| TEST-014D | nieaktualne `expectedUpdatedAt` | zero mutacji |
| TEST-014E | komplet zgodny, ale pokrycie < 100% | brak `RESOLVED`, `NEEDS_ATTENTION` |
| TEST-014F | potwierdzenie z innego tenanta | niewidoczne, join nie domknięty |
| TEST-014G | plan niespójny (rola bez zobowiązania i odwrotnie) | `MISSING_DATA`, zero mutacji |

## 📌 Pliki

| Plik | Zmiana |
|---|---|
| `data/types.ts` | `supplyConfirmationSchema`, `confirmationPlanContractSchema`; `COVERAGE_SHORTFALL` **dopiero po zgodzie** |
| `data/repositories.ts` | `SupplyConfirmationRepository` (z `recordAndEvaluate`), `updateIfUnchanged` na `SupplyCaseRepository`, wpięcie w `SupplyCasesStore`, ew. `SeededScenario` |
| `data/json/store.ts` | kolekcja append-only wzorowana na `OutboundCorrelation`; `STORE_FILE_NAMES`, `purgeScope`, `updateIfUnchanged` |
| `lib/resolution/planContract.ts` | parsowanie Zodem + walidacja spójności |
| `lib/resolution/validateConfirmation.ts` | czysta walidacja jednego potwierdzenia |
| `lib/resolution/confirmationJoin.ts` | czysty join: plan + potwierdzenia → `PENDING \| COMPLETE \| BLOCKED` |
| `lib/resolution/confirmationDeadline.ts` | czysta funkcja terminu |
| `lib/resolution/applyResolution.ts` | wznawialna sekwencja mutacji + bramka zieloności |
| `commands/resolution.ts` | `record_confirmation`, `apply_confirmed`, `expire_confirmations` |
| `subscribers/inbound-message-accepted.ts` | **jedno** rozgałęzienie po intencie |
| `cli.ts` | podpięcie `expire_confirmations` |
| `events.ts`, `workflows.ts`, `i18n/*.json` (5) | zdarzenia, krok, stringi |
| `__tests__/` | TEST-010–014G |

## 📌 Ryzyka

- **Największe:** wspólna własność `workflows.ts` i subscribera z Phase 2. Mitygacja: jedno rozgałęzienie po intencie, zero zmian w istniejących krokach — ale przejście `reply-to-end` **musi** zostać przepisane i wymaga uzgodnienia kolejności z Phase 2.
- **Drugie:** brak transakcji w JSON store. Mitygacja: punkt commitu na końcu + zapis stanu docelowego zamiast delty. Świadomie akceptowane do czasu T-03.
- **Trzecie:** `pendingResolutionPlan` jest `jsonValueSchema`. Mitygacja: parsowanie Zodem na wejściu, nigdy rzutowanie.
- **Czwarte:** `updateIfUnchanged` to nowa metoda kontraktu repozytorium. Addytywna, nie zmienia `update`, ale wymaga tej samej dyscypliny w przyszłych implementacjach (ORM).
