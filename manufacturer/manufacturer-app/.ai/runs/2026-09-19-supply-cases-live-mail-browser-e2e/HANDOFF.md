# Handoff

Status: `BLOCKED`

The safe opt-in live-mail browser harness is implemented. The earlier 30-second run reached the real Manufacturer IMAP mailbox, but no actionable supply case was created because of a core contract defect that has now been fixed. Phase 1 and Phase 2 are not formally closed.

## Verified

- `progress` was enabled in `src/modules.ts` and the user applied the database migration; browser history import now queues successfully.
- `scheduler` was enabled in `src/modules.ts` and its three migrations were applied.
- Full `yarn mercato server dev` was started with workers and scheduler. The runtime discovered `communication-channels-poll`, `communication-channels-poll-tick` and inbound queues.
- The scheduler found a due communication-channel schedule and enqueued `communication-channels-poll-tick`.
- Browser `Pobierz teraz` returned HTTP 202 and advanced the channel sync timestamp.
- The live harness checks the mailbox every 20 seconds and triggers the browser manual poll action at each checkpoint.
- `scripts/mail-smoke.py` now quotes spaced IMAP search values; an exact subject containing spaces matches.
- No Phase 3/4 runtime was implemented and no live provider smoke test was run outside the explicitly approved mailbox test.
- Luna applied the owning core fix in `packages/core/src/modules/communication_channels/commands/ingest-inbound-message.ts`: public inbound messages now use `recipients: []` while assignment remains conversation metadata.
- The targeted core regression for the fix passed 19/19, and `git diff --check` passed.
- The live harness now accepts the observed English `Poll now` label as well as Polish `Pobierz teraz`, waits 150 seconds for the background scheduler before using the manual poll fallback, and allows five minutes for the complete approved workflow.
- Scheduler-first headed live run `live-mail-20260919100736-3035ac6f` sent exactly one Supplier 1 message, waited 150 seconds, observed the fallback poll return HTTP 202, and still did not produce an actionable supply case.

## Current blocker

The configured IMAP channel is personal (`communication_channels.user_id` is set). Before the fix, core inbound composition created a public message with a user recipient. The core messages validator rejected this combination with:

`recipients must be empty when visibility is public`

The poll worker recorded a dead-letter entry and advanced the mailbox cursor, so the pre-fix live test could not reach the supply-case detail or Phase 2 decision assertions. The owning core contract is now fixed and covered by a targeted regression. The scheduler-first post-fix run removed the locator/timeout blocker, but still did not create an actionable case after the mail was sent and the poll fallback returned 202. Do not mark either phase `DONE` until the poll queue/worker/dead-letter path is resolved and one complete live workflow passes.

The installed scheduler enforces a minimum persisted schedule interval of 60 seconds. The harness now waits beyond that interval; the latest live evidence shows that waiting longer alone does not complete inbound processing.

## Evidence

- 30-second live run: `.ai/runs/live-mail-20260919091250-e0ad404c/REPORT.json`
- Latest single headed workflow run: `.ai/runs/live-mail-20260919093515-7b65629f/REPORT.json` (failed after 35.1s; browser manual-poll navigation timed out at the first mailbox checkpoint)
- Locator-fixed scheduler-first run: `.ai/runs/live-mail-20260919100736-3035ac6f/REPORT.json` (failed after 2.6m; scheduler window elapsed, fallback poll returned 202, no actionable case)
- Earlier approved live run: `.ai/runs/live-mail-20260919084024-eacf9c03/REPORT.json`
- Browser screenshot from the approved run: `.ai/runs/live-mail-20260919084024-eacf9c03/preflight.png`
- Current status: `.ai/runs/2026-09-19-supply-cases-live-mail-browser-e2e/STATE.md`

## Recommended next step

Do not send another live mail until the poll queue/worker/dead-letter path is inspected. After that fix, run exactly one explicitly approved headed live test against the full runtime and verify inbound mail -> supply case -> decision -> stale 409/refetch -> guarded RFQ path. Until that post-fix browser evidence passes, the correct handoff state is `BLOCKED`, not `READY_FOR_CLOSURE`.
