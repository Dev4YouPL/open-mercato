# Implementation status — supplier email agent workflow

Last audited: 2026-09-19

Source of truth: [`2026-09-18-supplier-email-agent-workflow.md`](./specs/2026-09-18-supplier-email-agent-workflow.md)

## Current stage

The project is at the end of Phase 1 — domain and inbound foundation. The inbound path is now joined through triage and a workflow boundary, but live database-backed workflow restart verification and the UI exit gate are still missing. The main specification remains `Draft for user review`.

## Completed

- `T-01`, `T-02`: activation prerequisites, module scaffold, discovery, ACL, setup and five locale files.
- `T-04a`, `T-04b`: email normalization and inbound Zod contracts.
- `T-05a`, `T-05b`: body sanitization, quoted-history stripping and raw/sanitized body split.
- `T-06`, `T-07`: scoped inbound transport gate and atomic RFC message deduplication.
- `T-08a`, `T-08b`: scoped candidate list and reply-thread correlation.
- `T-09a`, `T-09b`: propose-only inbound triage agent and guarded `apply_triage` command.
- `T-10a`: accepted and proposal events are declared and emitted after their persistence boundaries; proposal events are emitted only when a new case is opened.
- `BACKLOG-001`: persistent scoped JSON store, fixtures, restart persistence, append-only inbound messages, atomic writes, scope isolation and coverage calculation.
- IMAP intake persists an `InboundMessage` and emits `supply_cases.inbound_message.accepted` after the message is durably claimed.
- The accepted-event subscriber reaches triage through `supply_cases.inbound.apply_triage`, creates or links the case, starts one workflow per case, persists `workflow_instance_id`, and signals an existing workflow for replies.

## Deferred intentionally

- `T-03a`: production ORM `SupplyCase` entity, encryption map and optimistic locking.
- `T-03b`: production ORM `InboundMessage` entity and scoped unique claim index.
- `T-03c`: migration generation and snapshot review.

The JSON store is the active backend for the local demo. Do not run `db:migrate` without explicit approval.

## In progress

- `T-10b`: production code resolves `workflowExecutor` and `signalHandler` through DI, and deterministic E2E coverage verifies the start/signal boundary. Live database-backed `WorkflowInstance` restart and signal delivery verification remain.

## Next tasks

1. Finish `T-10b` against the real database-backed workflow engine, including restart and signal delivery verification.
2. Exercise the live agent provider once; current tests inject the agent through `inboundTriageInvokerFactory`.
3. `T-11`: add the scoped list/detail read API and backend UI for supply cases.
4. Implement Phases 2–5: human sourcing decision, Supplier 2 offer, resolution plans, confirmations, atomic resolution, observability and final demo flow.

## Known current limitation

The inbound path is joined through the accepted-event subscriber, but workflow execution is currently verified with a deterministic harness rather than a live database-backed `WorkflowInstance`. A real live provider run and the case list/detail API/UI are still absent.

## Validation at last audit

Run locally from `manufacturer-app`:

- `yarn test --runInBand src/modules/supply_cases` — 17 suites, 248 tests passed.
- `yarn typecheck` — passed.
- `yarn eslint src/modules/supply_cases src/modules.ts` — passed.
- `yarn generate` — passed; generated outputs unchanged.

The focused suite emits one expected warning when a command test intentionally runs without a global event bus; the test run still passes.

## Agent instructions

- Treat the main specification and this file as the current implementation status.
- Keep the JSON repository behind its repository contracts; do not replace it with ORM before the demo flow is joined.
- Do not mark a task `DONE` until its stated oracle has actually been run and passed.
- Keep tenant and organization scope fail-closed, preserve idempotency and emit side effects post-commit.
- After changing discovery files, events, subscribers, routes, pages or agents, run `yarn generate` and the smallest relevant validation gate.
- Update this file and the main spec's phase table/changelog when a task changes state.
