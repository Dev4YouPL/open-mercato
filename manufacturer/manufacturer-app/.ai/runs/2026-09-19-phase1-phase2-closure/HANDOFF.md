# Handoff — Phase 1 / Phase 2 closure audit (2026-09-19)

Read [`STATE.md`](./STATE.md) for the full evidence table. This file is the short version.

## What this run did

An audit only. It re-ran every automated oracle that exists for Phase 1 and Phase 2, compared the
results against the three specs and the status file, and corrected the documentation. **No production
code was touched**, no `packages/core` or `packages/enterprise` change, no migration, no
`yarn generate`. Unrelated dirty-worktree changes were left alone.

## Can Phase 1 be marked DONE?

**No.** Status stays `IN_PROGRESS`.

Everything deterministic is green: the transport gate, RFC dedupe, candidate list, thread correlation,
triage, the `apply_triage` command, the post-commit events, and — on a live Postgres — exactly one
durable `WorkflowInstance` per case that survives a restart, resumes on the next correlated message,
and is unreachable from another tenant. The read-only list/detail slice passes 3/3 in the browser.

Missing for the exit gate:

1. **A live provider run.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are empty in `.env`;
   `createAgentRuntimeInvoker` has never executed. Every triage test injects a fake invoker.
2. **A live inbound mail run.** No record anywhere in `.ai/` of a real message from
   `supplier@hackon-om-wro.cloud` reaching the gate. The exit gate's "after repeated polling" clause is
   unproven.
3. **Browser matrix TEST-UI-009 / 010 / 012.** No specs exist. TEST-UI-002 and TEST-UI-004 are done.

## Reusable local mail test helper

`scripts/mail-smoke.py` is available for the live-mail portion of this closure. It loads mailbox
credentials from the ignored local `.env` and supports `check-config`, controlled
`send-inbound`, `list-mail`, and `wait-for-mail`. The tracked `.env.example` documents the
`OM_TEST_*` variable names without containing secrets.

Use it to inject one explicit Supplier 1 proposal or observe delivery to Supplier 2. It does not
close the RFQ gate by itself: the RFQ must be sent by the application through
`communicationChannelsSendAsUser`, and the live agent provider still needs its own evidence.
Never add mailbox passwords to tracked files or retry a send automatically.

`T-11` was moved `TODO → WIP` (not `DONE`): the code and its browser evidence are real, but the row's
stated oracle is the exit gate itself.

## Can Phase 2 be marked DONE?

**No.** Status stays `IN_PROGRESS` — but it is much further along than the spec recorded.

All five items the Phase 2 spec listed as "still open" are now closed by oracles re-run in this audit:
atomic concurrent decision claim, the actionable API/UI option projection, the real-database TEST-006
restart/replay, timeout and exhausted-retry handling, and explicit workflow transitions. TEST-005,
TEST-005B, TEST-006, TEST-006A, TEST-006C and TEST-006D are all covered and green.

Missing for the exit gate:

1. **No real RFQ has ever been delivered.** The gate says "exactly one *real* RFQ is delivered".
   Every test injects a fake `SupplierOutboundPorts.send`; `communicationChannelsSendAsUser` has never
   been called for an `ALTERNATIVE_SUPPLY_REQUEST` over the live SMTP channel. The durability half of
   the gate *is* proven.
2. **No live provider run for `initial_impact_advisor`** — same empty-key blocker as Phase 1.
3. **TEST-006B is only partly covered.** `REJECT` and `EDIT` have no test at all; their zero-outbound
   property is unasserted, though both branches exist in `commands/sourcing.ts`.
4. **A planned mechanism was not built.** Phase 2 plan step 4 / task P2-07 call for a workflow
   `INVOKE_AGENT` step and a Caseload disposition bridge. The implementation uses a `WAIT_FOR_SIGNAL`
   step plus the app's own guarded decision route instead. That may well be the better design, but it
   is an undocumented deviation and needs an explicit owner decision.

## Update after owner decision (2026-09-19)

The owner accepted the current `WAIT_FOR_SIGNAL` + guarded decision route. The Caseload bridge is
not required to close Phase 2 and remains a future migration seam. `REJECT`/`EDIT` coverage is now
present and green in `phase2-decision.test.ts` (8/8). The remaining blockers are live-provider,
real-RFQ/delivery evidence, and the Phase 1 browser matrix.

## Exact list of missing evidence

| # | Missing | Blocks |
|---|---|---|
| B-1 | One live-provider triage run and one live-provider initial-impact run, with the trace recorded | Phase 1 + Phase 2 |
| B-2 | One live inbound mail round trip, and one live outbound RFQ with `communication_channels.message.sent` delivery evidence | Phase 1 + Phase 2 |
| B-3 | Browser specs for TEST-UI-009 (permission/redaction), TEST-UI-010 (loading/empty/error/404/degraded), TEST-UI-012 (keyboard, narrow viewport, light/dark) | Phase 1 + the UI spec's Phase 1 |
| B-4 | TEST-006B cases for `REJECT` and `EDIT` asserting zero outbound and zero plan mutation | Phase 2 |
| B-5 | An owner decision on the `INVOKE_AGENT` / Caseload deviation: accept it in the spec, or implement the bridge | Phase 2 |

## Latest audit update (2026-09-19)

- B-3 is cleared: the complete supply-cases Playwright matrix passes 8/8 after restarting the QA
  runtime with the shared `.ai/qa/supply-cases-data` directory.
- B-4 is cleared: `phase2-decision.test.ts` passes 8/8 with `REJECT`/`EDIT` zero-side-effect
  assertions.
- B-5 is cleared: the owner accepted `WAIT_FOR_SIGNAL` + guarded route for Phase 2; Caseload is a
  future migration seam.
- Only B-1/B-2 remain: live provider execution and real inbound/RFQ delivery evidence.

## Rule for the next agent

**Do not start Phase 3.** The Phase 2 exit gate is not met, and `.ai/runs/2026-09-19-supply-cases-phase-3/STATE.md`
already records `P3-07` as `BLOCKED` on exactly that gate. Starting Phase 3 now would build the final
analysis on an unproven RFQ path.

Clear **B-1** and **B-2** first — one live session closes the live half of both gates. Then **B-4** and
**B-5**, then **B-3**.

Two traps in the existing documents:

- `.ai/runs/2026-09-19-supply-cases-phase-3/STATE.md` claims `workflows.ts` still contains only
  `START -> await-reply -> END`. **That is stale.** The Phase 2 steps and transitions are in place.
  Re-read the file before planning.
- `__tests__/send-supplier-message.test.ts` uses `TEST-005A`–`TEST-005I` for the outbound seam, which
  collides with the Phase 2 spec's own `TEST-005A`/`TEST-005B`. Do not match these by ID alone.
