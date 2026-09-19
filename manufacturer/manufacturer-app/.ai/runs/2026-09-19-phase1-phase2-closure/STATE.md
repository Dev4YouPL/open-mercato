# Phase 1 / Phase 2 closure audit — run state

**Run id:** 2026-09-19-phase1-phase2-closure
**Role:** audit and formal status reconciliation only (no Phase 3/4 implementation)
**Date:** 2026-09-19
**Scope guard:** no `packages/core` or `packages/enterprise` change, no `db:migrate`, no production
code change. Only `.ai/**` documentation was written in this run.

## Verdict

| Phase | Status after this audit | Exit gate |
|---|---|---|
| Phase 1 — domain and inbound foundation | `IN_PROGRESS` | **NOT met** — no live provider run, no live inbound mail run, browser matrix TEST-UI-009/010/012 unexecuted |
| Phase 2 — initial impact and first sourcing decision | `IN_PROGRESS` | **NOT met** — no live RFQ delivery, TEST-006B partially uncovered, `INVOKE_AGENT`/Caseload bridge not built |

Neither phase may be marked `DONE`. Every deterministic, automated oracle that exists is green; both
exit gates are blocked on the same missing class of evidence — a real run against live providers.

## Commands actually run in this audit (2026-09-19, local runner, not Docker)

| Command | Result |
|---|---|
| `yarn typecheck` | **passed** (exit 0) |
| `yarn test --runInBand src/modules/supply_cases` | **passed** — 26 suites, 332 tests |
| `yarn test --runInBand src/modules/supply_cases/__tests__/inbound-workflow-engine.db.test.ts` | **passed** — 1 suite, 2 tests (TEST-002A and TEST-006) against the live Postgres from `DATABASE_URL`; the suite is `describe.skip` without that variable, and it reported `passed`, not `skipped` |
| `yarn test --runInBand` (whole app) | **passed** — 26 suites, 332 tests |
| `npx eslint src/modules/supply_cases src/modules.ts` | **passed** — 0 findings |
| `yarn ds:check` | **passed** — 301 files |
| `npx playwright test … supply-cases-read-only.spec.ts --retries=0` | **passed** — 3/3 against the running local runtime (`http://localhost:3000`; HTTP 307 on `/backend` confirmed before the run) |
| `npx playwright test … supply-cases-phase2-decision.spec.ts --retries=0` | **passed** — 1/1 |
| `yarn generate` | **not run** — no auto-discovery file changed in this run; only `.ai/**` markdown was edited |

One expected warning is emitted by the Jest run (`events:factory` — no global event bus in a command
test that intentionally runs without one). It does not fail the run.

## Phase 1 — acceptance evidence

| ID / task | Verified | Evidence |
|---|---|---|
| T-01 activation prerequisites | yes | typecheck + lint + ds:check + the whole Jest suite green with `workflows`, `business_rules`, `api_keys` and the enterprise agent flags enabled; the `@open-mercato/cli` 0.8.0 patch is present in `.yarn/patches/` and referenced from `package.json` |
| T-02 module scaffold | yes | `acl.ts`, `setup.ts`, `di.ts`, `index.ts` and five locale files present and discovered |
| T-03a/b/c ORM + migration | `DEFERRED` (intentional) | JSON store is the active demo backend; no migration generated or applied in this run |
| T-04a / T-04b normalization + Zod | yes | `normalize-email.test.ts`, `inbound-signal.test.ts` |
| T-05a / T-05b sanitization + quoted history | yes | `sanitize-body.test.ts`, `strip-quoted-history.test.ts`, `prepare-inbound-body.test.ts` |
| T-06 inbound transport gate (TEST-004) | yes | `transport-gate.test.ts` |
| T-07 atomic RFC dedupe (TEST-002) | yes | `accept-inbound-message.test.ts`, `json-store.test.ts` |
| T-08a candidate list (TEST-004A) | yes | `candidate-list.test.ts` |
| T-08b thread correlation (TEST-004B) | yes | `thread-resolution.test.ts`, `triage-context.test.ts` |
| T-09a triage agent (TEST-003A/C) | **partly** | `inbound-triage-agent.test.ts` passes, but the agent is injected through `inboundTriageInvokerFactory`; `createAgentRuntimeInvoker` has still never executed against a live provider |
| T-09b `apply_triage` (TEST-003B/D) | yes | `apply-triage.test.ts`, `apply-triage-command-scope.test.ts`, `apply-triage-outcome.test.ts`, `inbound-triage-command.test.ts` |
| T-10a accepted / proposal events (TEST-001A–C, TEST-001H) | yes | `inbound-flow.e2e.test.ts` over a real `CommandBus` |
| T-10b one durable workflow per case (TEST-002A) | yes | `inbound-workflow-engine.db.test.ts` re-run in this audit against the live database: one `WorkflowInstance`, `workflow_instance_id` persisted, parked on `await-reply`, surviving a real restart, the next correlated message signalling the SAME instance, replay adding no instance and no `WorkflowEvent`, foreign tenant refused |
| T-11 read API + backend UI | **partly** | list/detail read model and routes are covered by `read-model.test.ts` and `read-api.test.ts` (scope isolation, message redaction, invalid-filter rejection, 404 out of org, degraded state); browser evidence is `supply-cases-read-only.spec.ts` 3/3, re-run green in this audit. The row's own oracle is "manual verification against the exit gate", and the exit gate is not met, so the row stays `WIP` |

### Phase 1 exit gate — why it is not met

> *"a live, plain-language proposal from Supplier 1 produces one scoped case with reviewable extracted
> facts after repeated polling, and remains inspectable after restart."*

1. **No live agent provider run.** `.env` carries `OM_AI_PROVIDER=openai` and `OM_AI_MODEL=gpt-5-mini`,
   but `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are both empty in this environment.
   `createAgentRuntimeInvoker` therefore cannot be exercised here at all. Every triage assertion in the
   repository injects a fake invoker.
2. **No live inbound mail run.** IMAP/SMTP seed configuration exists (`OM_SEED_IMAP_ENABLED=true`,
   `manufacturer@hackon-om-wro.cloud`, `imap.mail.ovh.net`, `smtp.mail.ovh.net`), but no run record,
   log or artifact under `.ai/` shows a real message from `supplier@hackon-om-wro.cloud` traversing the
   gate. The "after repeated polling" clause is unproven.
3. **Browser matrix incomplete.** TEST-UI-002 and TEST-UI-004 are covered by the read-only Playwright
   spec. TEST-UI-009 (permission/redaction matrix), TEST-UI-010 (loading / empty / retryable error /
   404 / degraded) and TEST-UI-012 (keyboard-only, narrow viewport, light/dark, live region) have **no
   browser evidence**. TEST-UI-009 and TEST-UI-010 have partial non-browser coverage in
   `read-api.test.ts` and `read-model.test.ts`; that is not what those rows ask for.

## Phase 2 — acceptance evidence

| Test ID | Status | Evidence |
|---|---|---|
| TEST-005 — impact + initial agent, three options, no mutation | **covered** | `initial-impact.test.ts` "computes the reference shortage and Friday customer breach" (300/500, shortage 200, Friday breach); `buildCanonicalInitialOptions` produces exactly the three canonical option IDs |
| TEST-005A — missing/invalid facts, agent unavailable/schema-invalid | **partly** | `initial-impact.test.ts` "fails closed when the advisor changes facts or evidence references" covers strict advisor validation. A dedicated *provider unavailable* case for `initial_impact_advisor` is not separately asserted |
| TEST-005B — agent tries to change recipient/quantity | **covered** | same strict-validation test; the Supplier 2 recipient is read from the case, never from the advisor result |
| TEST-006 — SELECT C, delivery, restart, replay | **covered on the real engine** | `inbound-workflow-engine.db.test.ts` TEST-006, re-run green: one send, workflow `PAUSED` at `alternative-request-delivery`, delivery evidence moves the case to `WAITING_FOR_ALTERNATIVE_OFFER` and the instance to `await-reply`, restart preserves both, replay returns `already_applied` with still exactly one send |
| TEST-006A — SELECT A and B separately | **covered** | `phase2-decision.test.ts` parameterized over `ACCEPT_PRIMARY_DELAY` and `USE_INTERNAL_STOCK`: pending plan only, zero Supplier 2 contact |
| TEST-006B — recommendation only, REJECT, EDIT, stale, forbidden, cross-scope | **partly — GAP** | stale is covered by the concurrent-claim test and by the browser 409 path; forbidden / cross-scope by `read-api.test.ts` (403 metadata, 404 outside org, 428 without the lock header). **`REJECT` and `EDIT` have no test at all** — a grep for them across `src/modules/supply_cases/__tests__` returns only an unrelated `SupplyCaseStatus` row. Both branches exist in `commands/sourcing.ts` and their zero-outbound property is unasserted |
| TEST-006C — delivery retry/exhaustion and offer timeout | **covered** | `phase2-decision.test.ts` "exhausted delivery and offer timeout fail closed", plus "starts the offer timeout only after delivery advances the workflow to await-reply" |
| TEST-006D — browser/detail | **covered** | `supply-cases-phase2-decision.spec.ts`, re-run green: three options rendered, none preselected, select C, guarded stale-version submit returns 409, conflict message shown, list refetched to three radios |
| concurrent decision claim | **covered** | `phase2-decision.test.ts` "allows exactly one of two concurrent decisions to claim the expected version" |
| optimistic locking surface | **covered** | `api/[id]/decision/route.ts` requires the `OPTIMISTIC_LOCK_HEADER_NAME` header (428 without it) and maps a 409 to `OPTIMISTIC_LOCK_CONFLICT_CODE` with `currentUpdatedAt`; asserted in `read-api.test.ts` |
| explicit workflow transitions | **covered** | `workflows.ts` declares `start → initial-impact-advisor → human-sourcing-decision → alternative-request-delivery → await-reply → end` with five named transitions |
| delivery evidence | **covered** | `subscribers/alternative-request-delivered.ts` correlates on the trusted RFC `Message-ID`; `SENDING_ALTERNATIVE_REQUEST` only becomes `WAITING_FOR_ALTERNATIVE_OFFER` after that subscriber runs |

### Phase 2 status claims in the spec that this audit found STALE

The Phase 2 spec's `Implementation Status` row listed five open items. All five are now closed by
real, re-run oracles:

- atomic decision claim under concurrent requests — **closed** (`phase2-decision.test.ts`);
- actionable read-model / API / UI option projection — **closed** (decision route + browser spec);
- real database workflow restart/replay TEST-006 — **closed** (runs on live Postgres);
- timeout and exhausted transient retry handling — **closed** (TEST-006C);
- explicit Phase 2 workflow transitions — **closed** (`workflows.ts`).

Closing those five does **not** close the phase; see the exit gate below.

### Phase 2 exit gate — why it is not met

> *"the user selects `CHECK_ALTERNATIVE_SUPPLIER`, exactly one **real** RFQ is delivered, and the
> durable workflow waits after restart."*

1. **No real RFQ was ever delivered.** The durability half of the gate is proven, but every piece of
   evidence substitutes the transport: TEST-006 injects a `SupplierOutboundPorts.send` that pushes to
   an array, and `send-supplier-message.test.ts` does the same. `communicationChannelsSendAsUser` has
   never been called for an `ALTERNATIVE_SUPPLY_REQUEST` against the live SMTP channel.
2. **No live provider run for `initial_impact_advisor`** — the same empty-API-key blocker as Phase 1.
3. **TEST-006B is not fully covered** (`REJECT` / `EDIT`, above).
4. **The planned `INVOKE_AGENT` / Caseload bridge was not built.** Phase 2 plan step 4 and task P2-07
   call for a workflow `INVOKE_AGENT` step and a Caseload disposition bridge. The implementation
   instead uses a `WAIT_FOR_SIGNAL` step (`initial-impact-advisor`) fed by
   `supply_cases.analysis.record_initial`, and routes the human decision through the app's own
   `POST /api/supply_cases/{id}/decision`. A grep for `agent_orchestrator`, `Caseload`,
   `proposal.disposed` and `INVOKE_AGENT` across non-test module code returns only the `defineAgent`
   import. This is a defensible design — it keeps propose-only and human authority intact — but it is a
   **deviation from the written plan** and must be either accepted in the spec or implemented.

## Closure audit update after owner decision (2026-09-19)

- **B-4 cleared:** `phase2-decision.test.ts` now covers `REJECT` and `EDIT`; the focused suite is
  green at 8/8 tests, including zero outbound effects and zero production-plan mutation.
- **B-5 cleared:** the owner accepted `WAIT_FOR_SIGNAL` plus the app-owned guarded route for Phase
  2. Caseload is retained as a future-compatible migration seam, not a current exit-gate blocker.
- **Remaining:** B-1 live provider evidence, B-2 live inbound/RFQ evidence, and B-3 Phase 1 browser
  matrix evidence. Phase 2 remains `IN_PROGRESS`; neither phase is marked complete.

## Other findings worth recording

- **A/B branches leave the workflow parked.** `commands/sourcing.ts` returns early for
  `ACCEPT_PRIMARY_DELAY` and `USE_INTERNAL_STOCK` without signalling `SOURCING_DECISION_SIGNAL`, so the
  instance stays at `human-sourcing-decision` indefinitely. That is correct for Phase 2's
  no-side-effect contract, but it means the A/B durable path has no consumer and will need one in a
  later phase.
- **Test ID collision.** `__tests__/send-supplier-message.test.ts` labels the outbound-seam cases
  `TEST-005A`–`TEST-005I`. The Phase 2 spec independently defines `TEST-005A` and `TEST-005B` with
  different meanings, so searching by ID is ambiguous. Recommend renaming the outbound-seam series
  (for example `TEST-OUT-A…I`).
- **Phase 3 run state is stale.** `.ai/runs/2026-09-19-supply-cases-phase-3/STATE.md` asserts
  "`workflows.ts` still contains only `START -> await-reply -> END`". That is no longer true. The file
  was left untouched because Phase 3 is out of this run's scope; the next Phase 3 agent must re-read
  `workflows.ts` rather than trust that line.
- **`T-11` contradiction resolved.** The Phase 1 task table said `TODO` while
  `IMPLEMENTATION_STATUS.md` listed T-11 under "Completed". The table is the declared single source of
  truth for Phase 1, so it now carries `WIP` with its real evidence, and the status file was aligned
  to it.

## Could not be verified in this run

- Any live provider behaviour (`createAgentRuntimeInvoker`, `initial_impact_advisor` against a real
  model) — no API key in this environment. This is an environment blocker, not a code gap.
- Any live e-mail round trip through `channel_imap` / SMTP — not attempted; it would send real mail to
  `hackon-om-wro.cloud` and is outside this audit's read-and-record mandate.
- TEST-UI-009 / 010 / 012 as browser evidence — those specs do not exist, so nothing was run.
- `yarn build` — not re-run; nothing affecting the bundle changed in this audit.

## Blockers

| # | Blocker | Owner action |
|---|---|---|
| B-1 | No LLM API key in `.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` empty) | supply a key, then run triage and initial impact once against the live provider and record the trace |
| B-2 | No live mail smoke has ever been performed | run one real Supplier 1 proposal into `manufacturer@hackon-om-wro.cloud` and one real RFQ out to `supplier2@hackon-om-wro.cloud`, with delivery evidence |
| B-3 | TEST-UI-009 / 010 / 012 browser specs do not exist | author them under `src/modules/supply_cases/__integration__/` |
| B-4 | TEST-006B `REJECT` / `EDIT` zero-side-effect coverage missing | add the two cases to `phase2-decision.test.ts` |
| B-5 | `INVOKE_AGENT` / Caseload bridge deviation undocumented | decide: accept the signal-based design in the Phase 2 spec, or implement the planned bridge |

## Latest audit update (2026-09-19)

- B-3 is cleared: the complete supply-cases Playwright matrix passes 8/8 locally.
- B-4 is cleared: `phase2-decision.test.ts` passes 8/8 with `REJECT`/`EDIT` zero-side-effect
  assertions.
- B-5 is cleared: the owner accepted `WAIT_FOR_SIGNAL` + guarded route for Phase 2; Caseload is a
  future migration seam.
- B-1/B-2 remain open: live provider execution and real inbound/RFQ delivery evidence.

## Decisions taken in this run

1. Neither phase is marked `DONE`. Green automated coverage is recorded as exactly that, and the live
   gap is named rather than absorbed.
2. `T-11` moves `TODO → WIP`, not `DONE`, because its stated oracle is the unmet exit gate.
3. The Phase 2 spec's stale "still open" list is corrected against re-run oracles, each with the test
   that closes it, so no historical result is reused as a fresh one.
4. No production code, no `packages/core`, no `packages/enterprise`, no migration, no `yarn generate`.
   Unrelated dirty-worktree changes were left untouched.

## Recommended next step for Phase 3

**Do not start Phase 3 implementation yet.** The Phase 3 run state already records `P3-07 BLOCKED` on
the Phase 2 exit gate, and that gate is still open.

Order of work:

1. Clear **B-1** and **B-2** together in one live session: key in `.env`, one real Supplier 1 message
   in, triage against the live provider, SELECT C, one real RFQ out with a
   `communication_channels.message.sent` record, restart, confirm the instance still waits. That single
   session closes the live half of both exit gates.
2. Clear **B-4** (small) and **B-5** (a spec decision, not code, if the signal-based design is
   accepted).
3. Clear **B-3** — it blocks the UI spec's Phase 1 sign-off, and TEST-UI-009/010/012 are cheap next to
   a live run.
4. Only then re-read `workflows.ts` and restart Phase 3 from
   `.ai/runs/2026-09-19-supply-cases-phase-3/PLAN.md`, correcting the stale `START -> await-reply -> END`
   claim first.
