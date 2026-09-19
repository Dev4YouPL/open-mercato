# Implementation status — supplier email agent workflow

Last audited: 2026-09-19

Source of truth: [`2026-09-18-supplier-email-agent-workflow.md`](./specs/2026-09-18-supplier-email-agent-workflow.md)

## Core business goal

Nadrzędnym celem projektu jest doprowadzenie każdego zweryfikowanego problemu z dostawą do potwierdzonego planu z pełnym pokryciem albo do jawnego zamknięcia bez zmian. Zielony sukces pojawia się dopiero po wymaganych potwierdzeniach dostawców i po sprawdzeniu przez system pełnego pokrycia; w głównym scenariuszu demonstracyjnym jest to `500/500 → PROTECTED → RESOLVED`.

Główna ścieżka: częściowa dostawa od Supplier 1 → decyzja operatora o sprawdzeniu Supplier 2 → realna oferta → ostateczny wybór planu → potwierdzenia dostawców → atomowe zastosowanie planu → `RESOLVED`. Rekomendacja agenta, wybór operatora, wysłanie wiadomości ani częściowa dostawa nie zamykają sprawy. Ten cel jest wiążący dla wszystkich agentów, rozwiązań, testów i decyzji projektowych.

## Current stage

**Phase 1 — `IN_PROGRESS`, exit gate NOT met. Phase 2 — `IN_PROGRESS`, exit gate NOT met.**
Audited 2026-09-19 by [`runs/2026-09-19-phase1-phase2-browser-closure`](./runs/2026-09-19-phase1-phase2-browser-closure/STATE.md).

Phase 1's domain, inbound foundation and read-only supply-case queue are implemented; the inbound path
is joined through triage and a workflow boundary, and that boundary is verified against the real
database-backed workflow engine. Phase 2's deterministic impact, strict advisor validation, guarded
human decision, optimistic locking, concurrent decision claim, RFQ send seam, delivery evidence,
retry/exhaustion/timeout handling and explicit workflow transitions are implemented and green,
including the real-database `TEST-006` restart/replay oracle and a browser decision spec.

Both exit gates are blocked on the same class of evidence: **nothing has ever run against a live
provider.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are empty in this environment, so
`createAgentRuntimeInvoker` and `initial_impact_advisor` have never executed against a real model, and
no real RFQ has ever been delivered through `communicationChannelsSendAsUser` — every outbound
assertion injects a fake send port. The Phase 1 TEST-UI-009/010/012 browser matrix is now covered
by the local Playwright closure run, and Phase 2 still owes TEST-006B's `REJECT`/`EDIT` cases plus a decision on the
`INVOKE_AGENT`/Caseload deviation.

The main workflow specification remains `Draft for user review`; the supply-case UI specification is
`in_progress` pending the remaining formal exit-gate evidence.

## Completed

- `T-01`, `T-02`: activation prerequisites, module scaffold, discovery, ACL, setup and five locale files.
- `T-04a`, `T-04b`: email normalization and inbound Zod contracts.
- `T-05a`, `T-05b`: body sanitization, quoted-history stripping and raw/sanitized body split.
- `T-06`, `T-07`: scoped inbound transport gate and atomic RFC message deduplication.
- `T-08a`, `T-08b`: scoped candidate list and reply-thread correlation.
- `T-09a`, `T-09b`: propose-only inbound triage agent and guarded `apply_triage` command.
- `T-10a`: accepted and proposal events are declared and emitted after their persistence boundaries; proposal events are emitted only when a new case is opened.
- `T-10b`: an accepted supplier proposal starts exactly one `WorkflowInstance` on the real engine, the case persists its `workflow_instance_id`, the run parks on `await-reply`, survives a process restart, and the next correlated message signals that same instance. A replay creates no second instance and repeats no effect, and the instance is invisible and unreachable from another tenant. Oracle: `src/modules/supply_cases/__tests__/inbound-workflow-engine.db.test.ts` (TEST-002A).
- `BACKLOG-001`: persistent scoped JSON store, fixtures, restart persistence, append-only inbound messages, atomic writes, scope isolation and coverage calculation.
- IMAP intake persists an `InboundMessage` and emits `supply_cases.inbound_message.accepted` after the message is durably claimed.
- The accepted-event subscriber reaches triage through `supply_cases.inbound.apply_triage`, creates or links the case, starts one workflow per case, persists `workflow_instance_id`, and signals an existing workflow for replies.
- `T-11` Phase 1 read API and backend UI are **implemented but the task row stays `WIP`**: scoped paginated list/detail routes, derived plan coverage, permission-aware message redaction, DataTable filters/URL state, responsive read-only detail, localized states and navigation metadata all ship and are covered by `read-model.test.ts`, `read-api.test.ts` and a 3/3 browser spec. The row's stated oracle is "manual verification against the exit gate", and that gate is not met, so it is not `DONE`.

## Deferred intentionally

- `T-03a`: production ORM `SupplyCase` entity, encryption map and optimistic locking.
- `T-03b`: production ORM `InboundMessage` entity and scoped unique claim index.
- `T-03c`: migration generation and snapshot review.

The JSON store is the active backend for the local demo. Do not run `db:migrate` without explicit approval.

## Phase 2 — initial impact and first sourcing decision (`IN_PROGRESS`)

Implemented and green, each with a re-run oracle:

- deterministic impact service and the reference scenario (`300/500`, shortage `200`, Friday customer breach) — `initial-impact.test.ts`;
- `initial_impact_advisor` under strict result validation: a changed fact or evidence reference fails closed, and the Supplier 2 recipient never comes from the advisor — `initial-impact.test.ts`;
- exactly three canonical options from `buildCanonicalInitialOptions`, with no preselection;
- the guarded human decision through `POST /api/supply_cases/{id}/decision` → `supply_cases.sourcing.apply_decision`, requiring `supply_cases.decisions.apply`, a `428` without the optimistic-lock header and a typed `409` conflict body — `read-api.test.ts`;
- exactly one of two concurrent decisions claims the expected version — `phase2-decision.test.ts`;
- SELECT C sends one logical RFQ and a replay sends none; SELECT A/B create only a pending plan and never contact Supplier 2 — `phase2-decision.test.ts` (TEST-006A);
- delivery evidence: `SENDING_ALTERNATIVE_REQUEST` becomes `WAITING_FOR_ALTERNATIVE_OFFER` only after the trusted `communication_channels.message.sent` correlation — `subscribers/alternative-request-delivered.ts`;
- exhausted delivery and offer timeout fail closed, and the offer timeout starts only after delivery — `phase2-decision.test.ts` (TEST-006C);
- explicit workflow transitions `start → initial-impact-advisor → human-sourcing-decision → alternative-request-delivery → await-reply → end` — `workflows.ts`;
- `TEST-006` on the real database engine: SELECT C, delivery, restart, replay — one workflow, one logical RFQ, `already_applied` on replay;
- `TEST-006D` in the browser: three unselected options, select C, stale-version `409`, conflict bar, refetch.

Still open for Phase 2 (see the closure run for detail):

- **no real RFQ has ever been delivered** — every outbound assertion injects a fake `SupplierOutboundPorts.send`;
- **no live provider run** for `initial_impact_advisor`;
- **TEST-006B is partial** — `REJECT` and `EDIT` have no test; their zero-outbound property is unasserted;
- **`INVOKE_AGENT`/Caseload deviation** — plan step 4 and P2-07 asked for a workflow `INVOKE_AGENT` step and a Caseload disposition bridge; the implementation uses a `WAIT_FOR_SIGNAL` step plus the app's own decision route. Needs an owner decision: accept in the spec, or build the bridge;
- SELECT A/B intentionally leave the instance parked at `human-sourcing-decision`; that durable path has no consumer yet.

## In progress

- `T-11` read-only browser evidence for TEST-UI-002/004 is present: the scoped Playwright spec passes 3/3 and the same fictional `SC-001` scenario was inspected in Chrome computer use. TEST-UI-009/010/012 are covered by dedicated local Playwright specs: permission denied 1/1, failure/degraded states 2/2 and narrow/keyboard/accessibility 1/1.

## Next tasks

1. Exercise the live agent provider once, for both `inbound_triage_advisor` and `initial_impact_advisor`; current tests inject them through `inboundTriageInvokerFactory` and the impact invoker seam. Blocked on an API key.
2. Perform one live mail round trip: a real Supplier 1 proposal in, and a real Supplier 2 RFQ out with `communication_channels.message.sent` evidence. This closes the live half of both the Phase 1 and Phase 2 exit gates.
3. Add TEST-006B's `REJECT` and `EDIT` cases.
4. Resolve the `INVOKE_AGENT`/Caseload deviation in the Phase 2 spec.
5. Preserve the browser closure evidence and obtain the explicitly approved live provider/mail evidence when credentials and approval exist.
6. Only then continue with Phases 3–5.

## Local supplier-mail smoke harness

The repository now contains [`scripts/mail-smoke.py`](../scripts/mail-smoke.py), a standard-library
only local helper for controlled IMAP/SMTP checks against the configured demo mailboxes. It reads
the supplier and Manufacturer credentials from the ignored local `.env`; credentials must never be
copied to tracked files or committed.

Useful commands from `manufacturer-app` are:

```powershell
python scripts/mail-smoke.py check-config
python scripts/mail-smoke.py send-inbound --supplier supplier1 --subject "Test" --body "Treść testowa"
python scripts/mail-smoke.py list-mail --mailbox manufacturer
python scripts/mail-smoke.py wait-for-mail --mailbox supplier2 --timeout 120
```

`send-inbound` is an external side effect and requires explicit approval for the specific smoke
run. The helper can prove mailbox connectivity and deliver a controlled supplier message, but it
does **not** replace the Phase 2 exit-gate evidence: the application itself must send the real
`ALTERNATIVE_SUPPLY_REQUEST` through `communicationChannelsSendAsUser`, and a live provider run
must be recorded separately. The helper intentionally has no automatic retry for sends, so a crash
cannot silently create a second test message.

## Latest closure update — 2026-09-19

- TEST-006B `REJECT` and `EDIT` coverage is implemented; `phase2-decision.test.ts` passes 8/8 and
  asserts zero outbound effects plus zero production-plan mutation.
- The owner accepted Phase 2's `WAIT_FOR_SIGNAL` + guarded decision route. Caseload remains a future
  migration seam, not a Phase 2 exit-gate blocker.
- The complete supply-cases Playwright matrix passes 8/8 after restarting the QA runtime with the
  shared `.ai/qa/supply-cases-data` directory.
- The local Jest gate now passes 26 suites / 334 tests; typecheck, focused ESLint and `ds:check`
  also pass.
- Phase 1/2 remain `IN_PROGRESS` because B-1/B-2 still require live provider and real RFQ evidence.

## Known current limitation

No supply-cases agent has ever run against a live provider. `.env` sets `OM_AI_PROVIDER=openai` and `OM_AI_MODEL=gpt-5-mini`, but `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are both empty here, so `createAgentRuntimeInvoker` cannot be exercised in this environment at all. Likewise, no real e-mail has traversed the gate in either direction: IMAP/SMTP seed configuration exists (`manufacturer@hackon-om-wro.cloud`, `imap.mail.ovh.net`, `smtp.mail.ovh.net`) but no run record shows it used.

The case list/detail API/UI read-only slice and the TEST-UI-009/010/012 browser matrix are implemented and verified under `T-11`; the formal Phase 1 gate is still open for live provider/mail evidence.

The workflow durability suite needs a reachable `DATABASE_URL`. It skips with a printed reason when the variable is unset, and fails rather than skips when the variable is set but the database cannot be reached.

`__tests__/send-supplier-message.test.ts` labels its cases `TEST-005A`–`TEST-005I`, which collides with the Phase 2 spec's own `TEST-005A`/`TEST-005B`. Do not match those IDs by name alone.

## Validation at last audit (2026-09-19, local runner, not Docker)

Run locally from `manufacturer-app` during the closure audit:

- `yarn typecheck` — passed.
- `yarn test --runInBand src/modules/supply_cases` — 26 suites, 332 tests passed.
- `yarn test --runInBand src/modules/supply_cases/__tests__/inbound-workflow-engine.db.test.ts` — 1 suite, 2 tests passed (TEST-002A and TEST-006) against the live database; the suite reports `passed`, not `skipped`, so `DATABASE_URL` was set and reachable.
- `yarn test --runInBand` — 26 suites, 332 tests passed; Playwright specs are excluded from Jest and run through the integration runner.
- `npx playwright test … src/modules/supply_cases/__integration__/supply-cases-read-only.spec.ts --retries=0` — 3 browser tests passed against the local QA runtime.
- `npx playwright test … src/modules/supply_cases/__integration__/supply-cases-phase2-decision.spec.ts --retries=0` — 1 browser test passed.
- `npx eslint src/modules/supply_cases src/modules.ts` — passed, 0 findings.
- `yarn ds:check` — passed for 301 files.
- `yarn generate` — **not re-run**; the audit changed only `.ai/**` markdown, no auto-discovery file.
- `yarn build` — **not re-run** in this audit; the previous run passed with the existing dynamic filesystem tracing warning from the JSON store.

The focused suite emits one expected warning when a command test intentionally runs without a global event bus; the test run still passes.

## Phase 4 — confirmation join (built ahead of Phase 3)

The confirmation half of Phase 4 is implemented and green: `SupplyConfirmation` append-only
collection, plan-contract parsing, per-role multiset validation, a join evaluated inside the
store's critical section, and `resolution.{record_confirmation,apply_confirmed,expire_confirmations}`.
Apply is re-entrant, writes target state rather than deltas, and commits the case LAST, so every
crash leaves a non-green case. Spec + run record:
[`2026-09-19-supply-cases-phase-4-confirmation-join.md`](./specs/2026-09-19-supply-cases-phase-4-confirmation-join.md),
[`2026-09-19-phase4-confirmation-join.state.md`](./runs/2026-09-19-phase4-confirmation-join.state.md).

Three things are deliberately NOT done: the adapter between Phase 3's `resolutionPlanSchema` and
the join's `ConfirmationPlanContract` (shapes differ; until it exists a real plan reads as
`unreadable_plan` and is inert), the `COVERAGE_SHORTFALL` enum value, and the `await-confirmations`
workflow step (deferred while `workflows.ts` is owned by the Phase 2 agent).

The Phase 3/Phase 4 adapter run remains `BLOCKED` before implementation. The closure artifacts now
exist — [`runs/2026-09-19-phase1-phase2-closure/STATE.md`](./runs/2026-09-19-phase1-phase2-closure/STATE.md)
and [`HANDOFF.md`](./runs/2026-09-19-phase1-phase2-closure/HANDOFF.md) — but their finding is that
**neither the Phase 1 nor the Phase 2 exit gate is met**: no live provider run, no live RFQ delivery.
The owner accepted Phase 2's `WAIT_FOR_SIGNAL` + guarded route, and the intended contract decision
is to add `COVERAGE_SHORTFALL` additively and use it only when confirmations are complete and valid
but coverage remains below the required quantity.

## Outbound transport seam (built ahead of the Phase 2 spec)

`lib/outbound/sendSupplierMessage.ts` is the one way this module mails a supplier. It
resolves the sending actor from the channel row (the mailbox's owner — the platform only
lets a channel's owner send through it), mints the RFC 5322 `Message-ID` itself, writes the
`OutboundCorrelation` anchor BEFORE the send, and refuses fail-closed when the mailbox is
missing, unconnected, unowned or addressless. A replay sends nothing and reports the
original identity; an explicit `resend` delivers again under the SAME `Message-ID`. Its
`accepted` status means the hub took the delivery, not that SMTP ran — delivery evidence
stays the platform's `communication_channels.message.sent`, which is what the Phase 2 spec
requires before `WAITING_FOR_ALTERNATIVE_OFFER`.
`lib/outbound/ports.ts` wires it to `communicationChannelsSendAsUser`; the real call site is
`yarn mercato supply_cases send-supplier-message`. Oracle: TEST-005A–I in
`__tests__/send-supplier-message.test.ts` (14 tests).

The three things this section previously listed as "deliberately NOT built" — RFQ content, the
`sourcing.*` commands and the workflow steps that call this seam — have since been built by Phase 2
(`commands/sourcing.ts`, `lib/sourcing/alternativeRequest.ts`, the `human-sourcing-decision` and
`alternative-request-delivery` steps in `workflows.ts`). What is still missing is the live half: the
seam has never actually been driven through `communicationChannelsSendAsUser` against the real SMTP
channel, so `TEST-005A`–`TEST-005I` and `TEST-006` alike prove the logic, not a delivery.

## Run records

- [`2026-09-19-phase1-phase2-closure`](./runs/2026-09-19-phase1-phase2-closure/STATE.md) — the Phase 1 / Phase 2 closure audit: per-acceptance-ID evidence, the exact commands and results, what could not be verified, the five blockers (B-1…B-5) and the rule that Phase 3 must not start. [`HANDOFF.md`](./runs/2026-09-19-phase1-phase2-closure/HANDOFF.md) is the short version.
- [`2026-09-19-supply-cases-phase-3`](./runs/2026-09-19-supply-cases-phase-3/STATE.md) — Phase 3 slices, `BLOCKED` on the Phase 2 exit gate. **Contains one stale claim:** it says `workflows.ts` holds only `START -> await-reply -> END`, which the Phase 2 steps and transitions superseded. Re-read the file before trusting that line.
- [`2026-09-19-phase4-confirmation-join.state.md`](./runs/2026-09-19-phase4-confirmation-join.state.md) — the confirmation join built ahead of Phase 3.

## Research notes

- [`2026-09-19-phase2-outbound-spike.md`](./specs/2026-09-19-phase2-outbound-spike.md) — read-only rozpoznanie of the installed outbound contract (`communicationChannelsSendAsUser`, SMTP via `channel_imap`, delivery evidence, pre-minted RFC `Message-ID` for the `OutboundCorrelation` anchor). Input for the Phase 2 spec; nothing implemented.

## Agent instructions

## Supply operations control tower UI — 2026-09-19

- P0 is implemented and locally verified: the scoped read model now separates baseline coverage from live operational coverage, projects Supplier 1's `300 Wednesday + 200 Friday` reality, shortage, production/customer impact, supplier evidence and degraded data quality. The list and detail render the control-tower sections with semantic tokens and localized states.
- P1 has a partial, read-only projection: valid persisted Supplier 2 offers and exactly three typed resolution plans are displayed without preselection; durable confirmation records project into a typed checklist and the server-owned final gate. Tests cover one-confirmation non-green and complete-confirmation green fixture states.
- P1 remains blocked from completion. There is no registered guarded `supply_cases.resolution.apply_decision` HTTP route and the Phase 3 `resolutionPlanSchema` → Phase 4 `ConfirmationPlanContract` adapter is still missing. The UI therefore exposes no false final-action button and does not issue direct PATCH requests.
- The P0 projection now keeps planned resolution allocations out of live coverage until the matching inbound confirmations exist; a selected but unconfirmed plan cannot make the operational view read `500/500`. A server-confirmed gate remains the only source of the green banner, with its quantity rendered dynamically.
- Focused evidence: `yarn test --runInBand src/modules/supply_cases` passed (26 suites, 337 tests); `yarn eslint src/modules/supply_cases/data/read-model.ts src/modules/supply_cases/components/SupplyCaseDetail.tsx src/modules/supply_cases/components/SupplyCasesTable.tsx src/modules/supply_cases/__tests__/read-model.test.ts` passed; `yarn ds:check` passed; focused Playwright read-only, accessibility and failure-state specs passed.

- Treat the main specification and this file as the current implementation status.
- Keep the JSON repository behind its repository contracts; do not replace it with ORM before the demo flow is joined.
- Do not mark a task `DONE` until its stated oracle has actually been run and passed.
- Keep tenant and organization scope fail-closed, preserve idempotency and emit side effects post-commit.
- After changing discovery files, events, subscribers, routes, pages or agents, run `yarn generate` and the smallest relevant validation gate.
- Update this file and the main spec's phase table/changelog when a task changes state.
