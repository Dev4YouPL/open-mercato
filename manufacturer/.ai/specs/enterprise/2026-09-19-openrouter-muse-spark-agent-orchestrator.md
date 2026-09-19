# OpenRouter Muse Spark 1.3 Contributor for Agent Orchestrator

## TLDR

Przypiąć wszystkich agentów należących do modułu `agent_orchestrator` do providera `openrouter` i modelu `meta/muse-spark-1.3-contributor`, wykorzystując istniejący model factory oraz preset OpenRouter. Zmiana obejmuje agentów native/in-process należących do modułu; nie obejmuje agentów innych modułów tylko dlatego, że wykonuje je orkiestrator.

Model Contributor może wykorzystywać prompty i odpowiedzi do ulepszania produktów Meta. Nie wolno kierować do niego sekretów, danych regulowanych ani poufnych danych klientów bez udokumentowanej zgody właściciela danych.

## Overview

Repozytorium ma już obsługę OpenRouter przez warstwę OpenAI-compatible, zmienne `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL`, wybór provider/model w `createModelFactory` oraz telemetryczne liczenie kosztu. Nie jest potrzebny nowy adapter ani zależność produkcyjna.

Aktualny zakres modułu obejmuje natywnego agenta `deals.health_check`. Wygenerowane agenty OpenCode należą obecnie do innych modułów, np. `agent_examples`, i pozostają poza zakresem.

## Problem Statement

- Agenci modułu dziedziczą provider/model z konfiguracji runtime, więc ich faktyczne zachowanie może zmieniać się między środowiskami.
- Native i OpenCode mają różne ścieżki konfiguracji.
- Model nie ma wpisu w lokalnej tabeli pricingu, więc koszt może pozostać `null`.
- Contributor dopuszcza wykorzystanie promptów i odpowiedzi przez Meta, co wymaga jawnej polityki danych.
- Globalna allowlista może zablokować wskazaną parę lub wymusić fallback.

## Proposed Solution

### Zakres agentów

Agent jest objęty zmianą wyłącznie, gdy jego wpis rejestru ma:

```text
moduleId === "agent_orchestrator"
```

Nie zmieniamy agentów należących do innych modułów, nawet jeśli są uruchamiani przez `agentRuntime` albo zapisani w generowanym manifeście orkiestratora.

### Native / in-process

Każda definicja `defineAgent` należąca do modułu otrzyma:

```ts
defaultProvider: 'openrouter'
defaultModel: 'meta/muse-spark-1.3-contributor'
allowRuntimeOverride: false
```

`defineAgent` powinien addytywnie udostępnić opcjonalne `allowRuntimeOverride` i przekazać je do `defineAiAgent`. Wyłącza to override użytkownika/tenanta, ale pozostawia modułowe env jako kontrolowaną przez operatora ścieżkę awaryjną.

### OpenCode

Obecnie brak agentów OpenCode należących do `agent_orchestrator`, więc implementacja nie zmienia wygenerowanych plików ani globalnej konfiguracji kontenera.

Przyszły agent plikowy tego modułu musi deklarować w źródłowym `AGENT.md`:

```yaml
provider: openrouter
model: meta/muse-spark-1.3-contributor
```

Po zmianie pliku źródłowego wymagane są `yarn generate` i restart OpenCode. Nie wolno ręcznie edytować `generated/file-agents.generated.ts` ani `docker/opencode/agents/**`.

## Configuration

Sekret dostarczany wyłącznie przez secret store:

```dotenv
OPENROUTER_API_KEY=<secret>
```

Rekomendowana deklaracja modułowa i awaryjny override operatora:

```dotenv
OM_AI_AGENT_ORCHESTRATOR_PROVIDER=openrouter
OM_AI_AGENT_ORCHESTRATOR_MODEL=meta/muse-spark-1.3-contributor
```

Opcjonalnie:

```dotenv
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Jeżeli globalne allowlisty są ustawione, muszą zawierać tę parę:

```dotenv
OM_AI_AVAILABLE_PROVIDERS=openrouter,<pozostali-providerzy>
OM_AI_AVAILABLE_MODELS_OPENROUTER=meta/muse-spark-1.3-contributor,<pozostale-modele>
```

Nie należy zawężać globalnej allowlisty wyłącznie do tego modelu bez osobnej decyzji, ponieważ wpłynęłoby to na wszystkie moduły AI.

## Contributor Data Policy

OpenRouter informuje, że prompty i odpowiedzi tego wariantu mogą być używane do ulepszania produktów Meta: [model page](https://openrouter.ai/meta/muse-spark-1.3-contributor).

Dozwolone:

- dane syntetyczne i demonstracyjne;
- informacje publiczne, które wolno przesłać;
- dane wewnętrzne jawnie zaakceptowane przez właściciela danych do użycia z modelem Contributor.

Zabronione bez osobnej, udokumentowanej akceptacji:

- klucze API, tokeny, hasła, sekrety i klucze prywatne;
- dane osobowe, szczególne kategorie danych i dane regulowane;
- prywatne notatki, komunikacja klientów, umowy, rabaty, ceny negocjowane i niepubliczne dane finansowe;
- surowe rekordy produkcyjne używane jako dane testowe.

ZDR lub `data_collection: deny` nie mogą być przedstawiane jako zniesienie warunków wariantu Contributor. Gdy organizacja wymaga braku wykorzystania danych do treningu/ulepszania, należy użyć modelu non-Contributor.

## Pricing Telemetry

Do `DEFAULT_PRICING` należy dodać:

```ts
'meta/muse-spark-1.3-contributor': {
  inputPer1M: 0.10,
  outputPer1M: 0.20,
}
```

Ceny są szacunkiem w USD za 1M tokenów i muszą zostać ponownie sprawdzone przed implementacją. Istniejący `OM_AGENT_MODEL_PRICING` pozostaje override'em wdrożeniowym. Cache read, web search i inne opłaty dodatkowe pozostają poza obecnym modelem kosztowym; UI nadal pokazuje „Cost (est.)”.

## Data Models and API Contracts

Brak migracji bazy danych, nowych encji, endpointów, komend, eventów, ACL, DI tokenów i zmian odpowiedzi API. Istniejący `AgentRun` nadal zapisuje model, tokeny i szacowany koszt.

## Implementation Plan

### Phase 1 — Agent policy

1. Dodać opcjonalne `allowRuntimeOverride` do wejścia `defineAgent` i przekazać je dalej.
2. Ustawić provider, model i `allowRuntimeOverride: false` we wszystkich agentach modułu.
3. Dodać test polityki, który sprawdza wszystkie wpisy z `moduleId === 'agent_orchestrator'`.

### Phase 2 — Pricing and env documentation

1. Dodać pricing dokładnego modelu i testy obliczeń/override'u env.
2. Jeśli potrzebne, uzupełnić komentarze w `apps/mercato/.env.example` i równolegle w `packages/create-app/template/.env.example`.
3. Udokumentować ostrzeżenie Contributor bez zapisywania sekretów.

### Phase 3 — Runtime verification

1. Sprawdzić, że model factory zachowuje pełny identyfikator `meta/muse-spark-1.3-contributor` dla OpenRouter.
2. Sprawdzić, że override tenant/request nie zmienia przypiętego agenta.
3. Sprawdzić zachowanie przy blokadzie przez allowlistę.
4. Uruchomić syntetyczny test integracyjny: poprawny typed proposal, trace, tokeny i niepusty koszt.
5. Live smoke test pozostawić jako opt-in, z zewnętrznym kluczem i wyłącznie danymi syntetycznymi.

## File Manifest

| File | Change |
|---|---|
| `packages/enterprise/src/modules/agent_orchestrator/ai-agents.ts` | Provider/model policy dla agentów modułu. |
| `packages/enterprise/src/modules/agent_orchestrator/lib/sdk/defineAgent.ts` | Addytywne `allowRuntimeOverride`. |
| `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/modelPricing.ts` | Pricing Muse Contributor. |
| `packages/enterprise/src/modules/agent_orchestrator/__tests__/model-pricing.test.ts` | Test pricingu i env override. |
| `packages/enterprise/src/modules/agent_orchestrator/__tests__/agent-provider-policy.test.ts` | Test kompletności polityki. |
| `packages/enterprise/src/modules/agent_orchestrator/__tests__/native-runner-wiring.test.ts` | Test efektywnego provider/model. |
| `apps/mercato/.env.example` | Opcjonalna dokumentacja env. |
| `packages/create-app/template/.env.example` | Obowiązkowe lustro zmian env template. |

## Testing Strategy

- Wszystkie modułowe registry entries mają właściwy provider/model.
- `allowRuntimeOverride: false` blokuje tenant/request override.
- OpenRouter zachowuje vendor-prefixed model id.
- Brak klucza i blokada allowlisty kończą się bezpiecznym błędem/fallbackiem widocznym w resolution metadata, a nie fałszywym raportem uruchomienia Muse.
- Pricing zwraca USD 0.10/M input i USD 0.20/M output; env override ma pierwszeństwo.
- Agent zwraca wynik zgodny z istniejącym schematem i nie omija proposal → disposition → effector.
- Testy i smoke używają wyłącznie danych syntetycznych.

## Validation Commands

```bash
yarn workspace @open-mercato/enterprise test src/modules/agent_orchestrator
yarn workspace @open-mercato/enterprise typecheck
yarn workspace @open-mercato/ai-assistant test
yarn workspace @open-mercato/ai-assistant build
yarn generate
yarn template:sync:fix   # jeżeli zmieniono apps/mercato/.env.example
yarn agents:check-budget # jeżeli zmieniono AGENTS.md
yarn typecheck
```

`yarn db:migrate` nie jest potrzebne.

## Risks & Impact Review

#### Poufne dane trafiają do modelu Contributor

- **Scenario:** agent wysyła produkcyjne dane klienta, notatki lub warunki handlowe do modelu dopuszczającego wykorzystanie promptów/odpowiedzi przez Meta.
- **Severity:** Critical
- **Affected area:** prywatność, poufność, GDPR i zobowiązania kontraktowe.
- **Mitigation:** domyślnie dane syntetyczne/publiczne; produkcja wymaga udokumentowanej akceptacji i przeglądu konkretnych payloadów.
- **Residual risk:** Medium; warunki zewnętrznego dostawcy mogą się zmienić.

#### Efektywny model różni się od deklarowanego

- **Scenario:** env lub allowlista powoduje fallback.
- **Severity:** High
- **Affected area:** poprawność, koszt i audyt.
- **Mitigation:** test efektywnej resolution, trace verification i smoke po wdrożeniu.
- **Residual risk:** Low.

#### Structured output lub tool calling nie działa stabilnie

- **Scenario:** model nie realizuje konkretnego schematu/tool loop mimo deklarowanej obsługi.
- **Severity:** High
- **Affected area:** tworzenie propozycji.
- **Mitigation:** walidacja Zod fail-closed, test integracyjny i opt-in live smoke.
- **Residual risk:** Medium z powodu zmian upstream.

#### Pricing staje się nieaktualny

- **Scenario:** OpenRouter zmienia cenę lub nalicza nieuwzględnione opłaty.
- **Severity:** Low
- **Affected area:** szacowany koszt w cockpit.
- **Mitigation:** oznaczenie „estimated”, ponowna weryfikacja ceny i `OM_AGENT_MODEL_PRICING`.
- **Residual risk:** Low.

#### Globalna konfiguracja zmienia inne agenty

- **Scenario:** operator zawęża globalną allowlistę lub globalne `OM_AI_*` tylko do Muse.
- **Severity:** High
- **Affected area:** wszystkie moduły AI i agenty OpenCode.
- **Mitigation:** użyć deklaracji agenta i modułowego env; globalne listy tylko rozszerzyć, chyba że osobno zatwierdzono ich zawężenie.
- **Residual risk:** Low.

## Final Compliance Report — 2026-09-19

### AGENTS.md Files Reviewed

- Root `AGENTS.md` przekazany w zadaniu.
- `.ai/specs/AGENTS.md`.
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`.
- `packages/ai-assistant/AGENTS.md`.
- `BACKWARD_COMPATIBILITY.md`.

### Compliance Matrix

| Rule | Status | Notes |
|---|---|---|
| Użyć istniejącego model factory | Compliant | Brak nowego adaptera. |
| Zachować propose-only i command effector | Compliant | Brak zmian narzędzi, disposition i efektora. |
| Nie edytować generated files | Compliant | OpenCode source-first + `yarn generate`. |
| Nie logować sekretów i raw tenant data | Compliant | Secret store i syntetyczne testy. |
| Zmiany kontraktów addytywne | Compliant | Tylko opcjonalne `allowRuntimeOverride`. |
| Mirror zmian `.env.example` | Compliant | Oba pliki ujęte w manifeście i walidacji. |
| Testy native/OpenCode scope | Compliant | Native wdrażany; OpenCode jawnie ograniczony do przyszłych agentów należących do modułu. |

### Internal Consistency Check

| Check | Status |
|---|---|
| Zakres ownership vs runtime | Pass |
| Provider/model vs precedence | Pass |
| Pricing vs telemetry | Pass |
| Data policy vs Contributor terms | Pass |
| API/data/UI consistency | Pass — brak zmian |

### Verdict

Approved for implementation, z twardą bramką produkcyjną: bez udokumentowanej akceptacji polityki Contributor wolno używać wyłącznie danych syntetycznych/publicznych albo wybrać model non-Contributor.

## Changelog

### 2026-09-19

- Initial implementation specification.
- Potwierdzono zakres: jeden obecny agent native należący do modułu; brak obecnych agentów OpenCode należących do modułu.
- Zapisano provider/model, pricing telemetry, allowlist/env, politykę danych Contributor oraz testy i walidację.
- Implemented: native agent policy, runtime-override lock, Muse Contributor pricing, and regression coverage.

## Implementation Result

Implemented on 2026-09-19:

- `deals.health_check` is pinned to `openrouter` + `meta/muse-spark-1.3-contributor`.
- `defineAgent` now forwards the additive `allowRuntimeOverride` option to the shared AI definition; the orchestrator agent sets it to `false` so request and tenant model overrides cannot change the pinned model.
- Default pricing includes USD 0.10/M input and USD 0.20/M output for the model.
- Added regression coverage for the complete orchestrator agent policy and pricing lookup.
- No database migrations, generated-file edits, new dependencies, or global provider changes were required.

Validation:

- `yarn generate` — passed; the existing OpenAPI bundler emitted an import-attribute warning and used its static fallback, with generated outputs unchanged.
- `yarn workspace @open-mercato/enterprise test --runInBand src/modules/agent_orchestrator/__tests__/agent-provider-policy.test.ts src/modules/agent_orchestrator/__tests__/model-pricing.test.ts` — passed, 2 suites / 10 tests.
- `yarn workspace @open-mercato/enterprise typecheck` — passed.
- `yarn workspace @open-mercato/enterprise build` — passed.
- `yarn workspace @open-mercato/ai-assistant build` — passed.
- The targeted `@open-mercato/ai-assistant` Jest command could not start because the workspace does not expose a `jest` binary for that package; no test assertion ran.
