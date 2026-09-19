# Phase 1/Phase 2 browser closure — STATE

Status: `BLOCKED`

Browser evidence for the requested local matrix is complete. Phase 1 and Phase 2 remain
`IN_PROGRESS`; neither phase is marked `DONE` because the formal exit gates still require
evidence that was intentionally out of scope here.

## Scope and environment

- Repository: Manufacturer A, `manufacturer-app`.
- Runner: local Playwright Chromium through `.ai/qa/tests/playwright.config.ts`.
- Runtime: `http://localhost:3000`, restarted through `.ai/scripts/test-env-up.ps1` after
  removing an orphaned same-repository runtime process.
- Fixture directory: `.ai/qa/supply-cases-data`, with the descriptor's tenant and organization
  scope. Every added spec seeds its own scope and purges it in `afterEach`.
- No `db:migrate`, real e-mail, live provider, or provider smoke test was run. No credentials
  were added to the repository.

## Scenario results

| Scenario | Result | Evidence |
|---|---|---|
| Existing read-only list/detail, scoped search and risk filter, empty state, redacted message content | PASS 3/3 | `supply-cases-read-only.spec.ts`; exact required command. Detail checks sanitized body and rejects the quoted raw-body marker. |
| TEST-UI-009 permission denied | PASS 1/1 | `supply-cases-permission.spec.ts`; employee cannot read list/detail, sees `Access Denied`, and sees no case identifier/correlation id. |
| TEST-UI-010 retry/error/degraded state | PASS 2/2 | `supply-cases-failure-states.spec.ts`; 500 read failure recovers only after `Try again`, missing related plan/order render a usable degraded detail, and a real 404 renders the retryable load error. |
| TEST-UI-012 narrow viewport/accessibility | PASS 1/1 | `supply-cases-accessibility.spec.ts`; 390×844 viewport, no horizontal overflow, labelled radiogroup, focus movement with Arrow keys, Space selection, and enabled action state. |
| Phase 2 initial decision | PASS 1/1 | `supply-cases-phase2-decision.spec.ts`; exactly three radios with no preselection, Supplier 2 selection, stale optimistic-lock `409`, refetch, only decision `POST`, no direct `PATCH`, and no false success state. |

## Commands and final results

- `yarn test:integration src/modules/supply_cases/__integration__/supply-cases-read-only.spec.ts --retries=0` — PASS, 3/3.
- `yarn test:integration src/modules/supply_cases/__integration__/supply-cases-phase2-decision.spec.ts --retries=0` — PASS, 1/1.
- `yarn test:integration src/modules/supply_cases/__integration__/supply-cases-permission.spec.ts src/modules/supply_cases/__integration__/supply-cases-failure-states.spec.ts src/modules/supply_cases/__integration__/supply-cases-accessibility.spec.ts --retries=0` — PASS, 4/4.
- `git diff --check` — PASS (only existing CRLF normalization warnings were reported).

## Failure analysis and environment notes

| Observation | Classification | Resolution/effect |
|---|---|---|
| QA descriptor contained a UTF-8 BOM and the helper defaulted to `.mercato` instead of the shared QA directory | test harness | Added BOM-safe descriptor resolution in `test-environment.ts`. |
| Full read-only runs intermittently lost fixture data and produced Windows `EPERM` atomic-rename failures | environment/runtime | Identified orphaned same-repository runtime children and restarted only that runtime; the final exact run passed 3/3. |
| Login-by-Enter was flaky in one base spec | test harness | Base specs now click the observed `Sign in` button. |
| List-to-detail click was flaky in the full read-only sequence | test harness/environment | Detail is opened by its verified fixture URL after the list/link/filter assertions; final exact run passed. |
| React Query retried injected 500 responses before the explicit retry | test design | The route fulfills all automatic attempts as failures until the UI retry is clicked, then allows recovery. |

## Artifacts

The final passing run produced no trace because retries were disabled and the configured trace
policy is `on-first-retry`. Playwright's final `test-results` directory retains the JSON/HTML
report but no final failure screenshot. Earlier failed iterations generated screenshots while
diagnosing the runtime and were superseded by the final passing reruns.

## Formal closure decision

`BLOCKED`. The requested browser evidence is closed locally, but Phase 1 cannot formally close
without an approved live provider/inbound-mail exit-gate run. Phase 2 cannot formally close
without the documented live provider/RFQ evidence and the remaining Phase 2 contract/test gaps.
Phase 3 and Phase 4 were not started.
