# Supply cases live-mail browser E2E

Status: `BLOCKED` (implementation blocker fixed; one approved live E2E evidence run remains)

## Scope

- Implemented only the opt-in hybrid QA harness for Phase 1 and Phase 2.
- No Phase 3/4 runtime, production workflow, command, provider or database migration was changed.
- The no-send path requires no credentials and does not invoke SMTP, IMAP or a provider.

## Validation

| Check | Result |
|---|---|
| `yarn test:integration src/modules/supply_cases/__integration__/supply-cases-live-mail.spec.ts --retries=0` | PASS: 1 dry-run passed; live test BLOCKED/skipped without opt-in flags |
| headed-compatible dry-run (`--headed --retries=0`) | PASS: 1 dry-run passed; live test BLOCKED/skipped |
| `yarn typecheck` | PASS |
| targeted ESLint | PASS |
| `git diff --check` | PASS, exit code 0 |
| Approved headed live run `live-mail-20260919084024-eacf9c03` | INCONCLUSIVE: SMTP send passed; no actionable case after 120s |
| 30-second live run `live-mail-20260919091250-e0ad404c` | FAIL: mailbox message found, but no actionable case within 30s |
| Latest single headed workflow run `live-mail-20260919093515-7b65629f` | FAIL after 35.1s: first mailbox checkpoint was false and browser manual-poll navigation timed out |
| Manufacturer mailbox inspection | PASS: unique Supplier 1 message present in mailbox |
| Browser `Pobierz teraz` | PASS: sync timestamp advanced, but Messages remained empty |
| Browser `Importuj historię` | FAIL/BLOCKED: `Could not resolve 'progressService'` |
| Module activation fix | APPLIED: enabled `progress` in `src/modules.ts`; runtime now resolves the service |
| Post-fix browser import | BLOCKED: relation `progress_jobs` does not exist |
| IMAP subject quoting fix | PASS: exact spaced subject returns `found=1` |
| Scheduler module/migration | PASS: scheduler enabled and 3 scheduler migrations applied |
| Full `yarn mercato server dev` runtime | PASS: workers and scheduler started; poll queues discovered |
| Automatic poll | PASS: scheduler found a due poll schedule and enqueued `communication-channels-poll-tick` |
| Browser manual poll | PASS: `/poll-now` returned 202 and sync timestamp advanced |
| Inbound ingest | FAIL: core validator rejected personal-channel messages: `recipients must be empty when visibility is public` |
| Luna core contract fix | PASS: inbound public messages now use `recipients: []`; targeted core regression 19/19 passed |
| Post-fix live E2E `live-mail-20260919095908-f063e69b` | FAIL/INCONCLUSIVE: Supplier 1 mail arrived, but the harness used the wrong locale-specific poll locator; no case was created |
| Scheduler-first post-fix live E2E `live-mail-20260919100736-3035ac6f` | FAIL/INCONCLUSIVE after 2.6m: waited 150s for the background scheduler, then fallback poll returned 202, but no actionable case was created |

## Evidence

- Dry-run report: `.ai/runs/live-mail-20260919082832-a434ef52/REPORT.json` and `REPORT.md`.
- Guard report for the live test: `.ai/runs/live-mail-20260919082832-51f39810/REPORT.json` and `REPORT.md`.
- Live report: `.ai/runs/live-mail-20260919084024-eacf9c03/REPORT.json` and `REPORT.md`.
- Live screenshot: `.ai/runs/live-mail-20260919084024-eacf9c03/preflight.png`.
- The live report records `externalSideEffects: true` because one approved inbound test email was sent; the dedicated local fixture scope was purged.
- No decision/RFQ screenshots or traces were generated because ingestion stopped before the browser detail step.

## Harness behavior

- Preflight reads the shared `.ai/qa/test-env.json` descriptor and requires both `LIVE_MAIL_E2E=1` and `LIVE_MAIL_E2E_APPROVED=1`.
- Approved live mode additionally requires `LIVE_MAIL_E2E_DEDICATED_SCOPE=1` before any local fixture or mail action.
- The mail adapter uses `spawn` with an argument array, bounded output and redacted report commands.
- The live flow creates only scoped production order/plan fixtures, never inbound or outbound records, and purges the dedicated QA scope in `finally`.
- The browser flow uses observed semantic locators, captures preflight/inbound/decision/waiting/RFQ screenshots in approved mode, and asserts the guarded POST decision with no direct PATCH/PUT/DELETE.
- The live harness now accepts both observed `Poll now` and `Pobierz teraz` labels, waits 150 seconds for the background scheduler before using the manual poll fallback, and allows five minutes for the complete approved workflow.

## Remaining gate

- The harness checks the Manufacturer mailbox every 20 seconds, waits through the scheduler grace period, and records any manual poll fallback in `REPORT.json`.
- The Python IMAP search helper was corrected to quote spaced subjects; an exact spaced subject now matches.
- The `progressService` DI issue and missing `progress_jobs` table are fixed after enabling `progress` and applying the user-approved migration.
- The scheduler is enabled in `src/modules.ts`; `yarn mercato server dev` starts workers and scheduler. The communication-channel schedule exists and automatic poll has been observed.
- The communication channel is personal (`user_id` is set). The core inbound composition fix now keeps public inbound messages recipient-free while preserving assignment metadata and `externalEmail`.
- The previous dead-letter evidence predates the fix. The targeted core regression passed 19/19, but the scheduler-first post-fix live run still did not produce an actionable case; the core fix therefore remains without live browser proof.
- The latest live run sent exactly one Supplier 1 message (`live-mail-20260919100736-3035ac6f`), waited through the scheduler window, observed the manual poll fallback return 202, and still reached no case. The next investigation must inspect the poll queue/worker/dead-letter path before another live mail is sent.
- The scheduler interval remains 60s because the installed scheduler rejects intervals below 60s; the harness now waits beyond that interval before using the manual fallback.
- Phase 1 and Phase 2 remain formally open. No `DONE` claim is allowed until the post-fix live run reaches the supply-case detail and Phase 2 decision/conflict assertions.
