# Supply Cases Live Mail Browser E2E

**Date:** 2026-09-19  
**Status:** Draft for user review  
**Scope:** QA harness and evidence only; Phase 1 and Phase 2; no Phase 3/4 runtime work.

## TLDR

Create an explicit opt-in hybrid E2E combining a visible Playwright browser with the existing
`scripts/mail-smoke.py` SMTP/IMAP harness. It sends one uniquely identified Supplier 1 proposal,
observes the Supply Case in the browser, performs the guarded Supplier 2 decision, and confirms one
real RFQ in Supplier 2's mailbox. The flow ends at `WAITING_FOR_ALTERNATIVE_OFFER` and never enters
final resolution.

## Problem Statement

The repository has deterministic backend/browser tests and a standalone SMTP/IMAP helper, but no
single observable scenario proving that a real Supplier 1 message crosses the inbound channel,
appears in the UI, produces a guarded operator decision, and results in one outbound RFQ.

The test must be safe by default: normal CI and ordinary browser runs must never send mail. A live run
requires explicit opt-in, dedicated mailboxes and separate human approval.

## Proposed Solution

Add a separate Playwright integration spec and test-only helpers. Reuse the shared QA runtime, existing
accessible UI, `mail-smoke.py`, scoped fixture conventions and real channel/workflow boundaries. Do
not write directly to the JSON store to simulate inbound mail or the outbound RFQ.

Modes:

- **Dry/no-send:** validate descriptor, safety preconditions, run-id generation and redacted command
  construction without SMTP, mailbox mutation or app decision mutation.
- **Approved live:** require `LIVE_MAIL_E2E=1` and `LIVE_MAIL_E2E_APPROVED=1`, then send exactly one
  inbound message and observe exactly one RFQ. Missing provider/mail/worker is blocked or inconclusive,
  never a fabricated pass.

## Architecture and Data Flow

1. Validate `.ai/qa/test-env.json`, dedicated scope, mail configuration, channel worker and opt-in.
2. Generate a run id, unique subject, RFC 5322 `Message-ID` and idempotency key.
3. Run `python scripts/mail-smoke.py send-inbound --supplier supplier1 ...` as a bounded child process.
4. Let the real app consume `communication_channels.message.received`, persist the scoped message,
   run triage/workflow and expose the case through list/detail UI.
5. Headed Playwright logs in as the dedicated operator, opens detail, selects Supplier 2 and observes
   the guarded decision request.
6. Let the real outbound channel send; run `wait-for-mail` for Supplier 2 and verify one matching RFQ.

The flow ends at RFQ delivery evidence / `WAITING_FOR_ALTERNATIVE_OFFER`. It does not send a Supplier
2 reply, create a confirmed offer, apply a final plan or touch Phase 3/4.

Reuse `scripts/mail-smoke.py`, `src/modules/supply_cases/__integration__/`,
`POST /api/supply_cases/{id}/decision`, `communication_channels.message.received/.sent`,
`.ai/qa/test-env.json` and `.ai/scripts/test-env-up.ps1`. Do not create a second runner or app runtime.

## Safety, Credentials and Opt-in Gate

The spec must skip before browser/mail side effects unless:

- `LIVE_MAIL_E2E=1` and `LIVE_MAIL_E2E_APPROVED=1` are set;
- the shared descriptor has a live PID and readiness probe;
- tenant, organization, operator and all three mailboxes are dedicated QA resources;
- `python scripts/mail-smoke.py check-config` succeeds without printing secrets;
- inbound IMAP/channel and queue workers are healthy;
- real AI is configured, or the result is labelled deterministic-advisor evidence and cannot close the
  live-provider gate.

Never log passwords, tokens, raw bodies or credential-bearing URLs. Never delete remote mail
automatically. The default/no-send path must make zero external calls.

## Test IDs and Acceptance Criteria

### LIVE-MAIL-001 — safe preflight and visible bootstrap

Missing descriptor, stale runtime, non-dedicated scope, missing approval/configuration or unhealthy
worker stops with zero external side effects. Dry-run produces a redacted report. Approved mode opens
headed Chromium, logs in as the dedicated operator and captures a run-id-only screenshot.

### LIVE-MAIL-002 — Supplier 1 inbound to visible case

Send exactly one Supplier 1 message with unique subject and `Message-ID`. The browser must show the new
correlation id and detail through the real app boundary, with sanitized content and correct scope.
Provider failure after inbound send is `BLOCKED`/`INCONCLUSIVE`, never a pass.

### LIVE-MAIL-003 — visible guarded Supplier 2 decision

Detail shows exactly three unselected options. The browser selects Supplier 2 and submits the existing
UI action. Capture `POST /api/supply_cases/{id}/decision` with optimistic-lock information. Assert no
direct `PATCH`, local-store write, false `Resolved` state or green success.

### LIVE-MAIL-004 — one real outbound RFQ

Wait for Supplier 2 mail using the unique subject/run id and bounded timeout. Verify sender, recipient,
subject, one message identity and correlation where exposed. Zero, multiple, timeout, bounce or
unmatched thread is `FAIL`; a local fake transport is not evidence.

## Browser Observability

Use observed `getByRole`, `getByLabel` and `getByText` locators. The visible command is:

```powershell
yarn test:integration src/modules/supply_cases/__integration__/supply-cases-live-mail.spec.ts --headed --debug --retries=0
```

Capture screenshots at preflight, inbound case, selected decision, waiting state and RFQ evidence.
Use shared trace policy and no per-test timeout/retry overrides.

## Mail Helper Contract

Use `child_process.spawn` or `execFile` with an argument array, never a shell-built command. Parse only
exit code, bounded output and non-secret identifiers. Allowed calls are:

```text
python scripts/mail-smoke.py check-config
python scripts/mail-smoke.py send-inbound --supplier supplier1 --subject <unique> --body <fixture> --message-id <unique>
python scripts/mail-smoke.py wait-for-mail --mailbox supplier2 --subject <unique> --timeout <bounded>
```

Do not duplicate SMTP/IMAP code, add Python dependencies or pass passwords as CLI arguments. Do not
send a Supplier 2 reply in this spec; `In-Reply-To`/`References` are for a later scenario.

## Isolation, Idempotency, Cleanup and Failure States

- Use a dedicated tenant/organization and unique run id in every subject, message id and idempotency key.
- Create only local production-plan/order fixtures needed by the browser; never seed inbound/RFQ results.
- In `finally`, purge only local records from the run and write the report.
- Never delete remote mail automatically; report non-secret remote identifiers for manual cleanup.
- A rerun uses a new run id and refuses an already matching message id.
- Classify outcomes as `PASS`, `FAIL`, `BLOCKED` or `INCONCLUSIVE`.
- Missing approval/configuration is `BLOCKED`; inbound accepted but no case is `FAIL`; provider outage
  is blocked before side effects and inconclusive after inbound side effects; RFQ timeout/bounce/
  duplicate is `FAIL`; cleanup failure is `FAIL`.

The report must contain redacted commands, runtime summary, fixture ids, non-secret mail ids,
screenshots/traces, per-test failure analysis and an explicit side-effect statement.

## Implementation Boundaries for luna-hight

Allowed:

- `manufacturer-app/src/modules/supply_cases/__integration__/supply-cases-live-mail.spec.ts`;
- test-only helpers under that integration directory;
- `.ai/qa/**` for opt-in runner/report support;
- `.ai/runs/<run-id>/**` for evidence;
- this spec only for implementation-discovered contract ambiguity.

Forbidden: `packages/core`, `packages/enterprise`, production workflows/commands,
`lib/resolution/`, `lib/outbound/`, Phase 3/4 runtime/provider behavior, credentials, raw mailbox
content, automatic remote deletion, `db:migrate`, or a live run without both opt-in flags and approval.

## Phased Implementation Plan

1. **Preflight/dry-run:** flags, descriptor validation, run id, redacted report and no-send tests.
2. **Mail adapter:** bounded child-process wrapper, redaction, timeout/non-zero handling and unit tests.
3. **Browser orchestration:** headed-compatible inbound wait, detail, Supplier 2 selection and
   network/no-PATCH assertions.
4. **Mailbox evidence/cleanup:** unique Supplier 2 wait, exactly-one assertion, artifacts and local
   cleanup; explicit duplicate/timeout handling.
5. **Validation:** dry/no-send first. A separate approved live run may execute later and must state
   whether AI was live; otherwise it cannot claim the live-provider gate.

## Validation Commands

```powershell
yarn test:integration src/modules/supply_cases/__integration__/supply-cases-live-mail.spec.ts --retries=0
yarn test:integration src/modules/supply_cases/__integration__/supply-cases-live-mail.spec.ts --headed --debug --retries=0
git diff --check
```

The first command must be safe without live credentials. The second is observation mode, not automatic
permission for external side effects.

## Review Notes

This is one capability: observable live-mail evidence for the existing Phase 1/2 surface. It changes
no production contracts, adds no dependency and does not broaden the workflow into Phase 3/4. The only
human approvals required are dedicated mailbox/scope confirmation and approval immediately before the
first live send.
