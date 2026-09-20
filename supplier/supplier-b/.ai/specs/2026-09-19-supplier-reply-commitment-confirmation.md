# Supplier B — Manufacturer Reply → Commitment Update → Confirmation E-mail + Supplier Console

**Date**: 2026-09-19
**Status**: Implemented — Phases 1–4 automated gates verified; MA-1…MA-12 pending manual acceptance

> **Baseline.** This spec extends `.ai/specs/2026-09-18-supplier-shortfall-supply-proposal.md` (the **baseline spec**), whose Phases 1–4 are implemented and verified. The baseline owns, and this spec does not repeat:
> - the `SupplyCase`, `SupplyMessage` and `SupplierProductionSlot` model;
> - the state machine up to `proposal_delivered`;
> - the frozen `SUPPLY_PROPOSAL` envelope;
> - the `sending` marker, send / track / retry, the recipient allowlist and the mailbox actor;
> - the fixture, `demo:reset`, `demo:preflight` and `mail:smoke`.
>
> Everything below is a **delta** on that baseline.

## TLDR

The Supplier OM stops today at `proposal_delivered`. This spec closes the Supplier half of the Level 3 loop (PROPOSAL → ACCEPTANCE → COMMITMENT_CONFIRMED):

1. **Receive.** The Manufacturer's reply arrives through the installed Communication Channels IMAP inbound path (`communication_channels.message.received`). Polling is made automatic by activating the installed `scheduler` module; an on-demand "poll mailbox now" is the stage accelerator.
2. **Validate and record.** A persistent `supplier_demo` subscriber loads the hub rows (scoped, decrypted), extracts the Manufacturer's `SupplyEnvelope` block and validates it against roadmap §9. §9 is strengthened with a mandatory `inReplyToMessageId`. The subscriber records every correlated inbound mail as `SupplyMessage(direction=inbound)` with a validation status. Invalid, untrusted, duplicate or late mail is recorded and surfaced but never changes a commitment.
3. **Apply an acceptance.** A valid `SUPPLY_ACCEPTANCE` runs a deterministic feasibility check. An undoable command then records the accepted and cancelled tranches, books the accepted production into `SupplierProductionSlot`, and reports the freed capacity.
4. **Confirm.** A `SUPPLY_COMMITMENT_CONFIRMED` goes out **in the same e-mail thread** through the generalised baseline send machinery. The hub's `message.sent` for that confirmation moves the case to `resolved`.
5. **Escalate the rest.** `SUPPLY_COUNTER_PROPOSAL` and `SUPPLY_REJECTION` move the case to `needs_human` with a reason. There is no negotiation; Level 5 extends from `needs_human`.
6. **Console.** A Supplier case page shows the roadmap §5 timeline, previews of sent and received e-mails (human text plus parsed envelope) and a "Poll mailbox now" action.
7. **Tooling.** `demo:reset`, `demo:preflight`, a `demo:case` inspector, a real-path `demo:selftest` and a Manufacturer-reply simulator (`mail:simulate-reply`, print or inject) let the Supplier side be proven before the Manufacturer OM is ready.

Covers roadmap backlog S03–S06, S09, S14–S18, S31 (timeline part) and S32–S35.

## Problem Statement

Supplier B's proposal (`400 Wed / 100 Fri` with the Level 4 replan, `300 / 200` in pure Level 3) reaches the Manufacturer, but the Supplier OM cannot hear the answer:

- **Mail is never received.** No subscriber listens to `communication_channels.message.received`. Automatic polling does not run either: the hub registers its poll tick only through `@open-mercato/scheduler`, which is not enabled in `src/modules.ts`. On top of that, IMAP channels default to `poll_interval_seconds = 300`.
- **Nothing checks inbound mail.** No envelope parser, allowlist check, dedupe or correlation exists (S04–S06, S09).
- **A case cannot move past the proposal.** Nothing accepts or cancels tranches, and no confirmation e-mail exists (S15–S17, S32–S34).
- **Nothing to show on stage.** Operators and the stage audience only have a list row: no timeline, no e-mail preview and no way to pull the mailbox on demand (S18, S31, S35).
- **Level 3 cannot finish.** Its Definition of Done ("Supplier realnie go odbiera, aktualizuje commitment, wysyła confirmation" — the Supplier actually receives the reply, updates the commitment and sends the confirmation) is unmet, so the Manufacturer can never reach `RESOLVED`.
- **Safety requirement.** Mail is untrusted input (roadmap §9). Free-text mail must never trigger a mutation, and the hub does **not** verify DKIM/SPF, so a `From` address alone proves nothing.

## Overview and Success Measures

- **Primary outcome.** The Manufacturer sends an acceptance for the live case. Within **≤ 60 s** a `SUPPLY_COMMITMENT_CONFIRMED` e-mail arrives in the Manufacturer inbox, in the same thread. The case is `resolved` with `400 accepted / 100 cancelled` (or `300 / 200` from a Level 3 fixture). This must hold **3/3 manual runs on the real OVH mailbox**, with exactly one confirmation e-mail per case.
- **Leading indicators:**
  - the inbound `SupplyMessage` is recorded ≤ 5 s after the hub ingest;
  - `commitment_updated` is reached ≤ 2 s after that;
  - `confirmation_queued` → `resolved` takes ≤ 20 s;
  - replaying `message.received` produces 0 duplicate confirmations;
  - `demo:preflight` is green, including the scheduler, the poll-tick schedule and the channel interval;
  - `demo:selftest` passes every scenario on the real encrypted fixture.
- **Baseline.** Today 0 inbound mails are processed, no case ever leaves `proposal_delivered`, and polling is manual only.
- **Market / product reference.** EDI 855 (PO acknowledgment with changes) → buyer-accepted change → EDI 865 (PO change acknowledgment); SAP Ariba / Coupa supplier-collaboration "order confirmation with partial acceptance".
  - **Adopted:** the acceptance explicitly references the message it answers (`inReplyToMessageId`, as in EDI's `BAK`/`BCA` reference segments); partial acceptance is expressed as accepted lines plus a cancelled quantity; the confirmation echoes the final commitment back to the buyer.
  - **Rejected:** a portal round trip, AS2/EDI transport and multi-round negotiation. The constraint is plain e-mail between two independent systems, and negotiation is Level 5.

## Goals

- **REQ-101** — Inbound mail on the Supplier mailbox is fetched automatically, with a scheduler-driven hub poll and a ≤ 15 s channel interval. An operator with `supplier_demo.supply_cases.manage` can also trigger an immediate poll from the console.
- **REQ-102** — Every inbound mail that correlates to a `SupplyCase` is persisted exactly once as `SupplyMessage(direction=inbound)` with a validation status and reason. Mail that does not correlate is logged and ignored.
- **REQ-103** — An inbound envelope drives automation only when **all** of these hold:
  - the transport sender is allowlisted and is the case partner;
  - exactly one foreign machine block is present;
  - the schema is valid;
  - the envelope addresses match the transport;
  - `correlationId` and `sku` match the case;
  - the `messageId` is new;
  - `inReplyToMessageId` names the case's latest outbound message;
  - the case is waiting for a reply.

  Anything else is recorded and surfaced and never mutates state. Natural-language text never triggers a mutation.
- **REQ-104** — A valid `SUPPLY_ACCEPTANCE` passes a deterministic feasibility check. Then one undoable command records the accepted and cancelled commitment, books the accepted production into `SupplierProductionSlot`, and computes the freed capacity. An infeasible acceptance goes to `needs_human` and no confirmation is sent.
- **REQ-105** — After the commitment update, exactly one `SUPPLY_COMMITMENT_CONFIRMED` e-mail goes to the case partner in the same hub thread, using the baseline send / sending-marker / track / retry machinery. Its hub `message.sent` moves the case to `resolved`. Delivery failures are retryable without duplicates.
- **REQ-106** — A valid `SUPPLY_COUNTER_PROPOSAL` or `SUPPLY_REJECTION` moves the case to `needs_human`, with a reason and an attention notification, and nothing is sent automatically. Late replies (to a resolved case) and duplicate replies are recorded without any mutation or notification.
- **REQ-107** — The Supplier console `/backend/supplier-demo/supply-cases/{id}` shows:
  - the roadmap §5 timeline, with 11 steps: detected, baseline, replan, policy, e-mail sent, waiting, e-mail received, feasibility, commitment updated, confirmation sent, resolved;
  - the original, proposed, accepted and cancelled commitments;
  - previews of every sent and received e-mail (human text plus parsed envelope, and the validation badge for inbound mail);
  - a "Poll mailbox now" action.

  It shows only Supplier-owned data.
- **REQ-108** — `demo:reset` / `demo:preflight` cover the full loop. `demo:case` prints a case and its messages. `demo:selftest` exercises every inbound scenario against the real encrypted fixture. `mail:simulate-reply` prints (or, in dev only, injects through the real hub ingest command) a valid Manufacturer reply bound to the live case.

## Non-goals

- The LLM Supplier Agent (separate spec), multi-turn negotiation, `maxNegotiationTurns`, the counter-proposal replan (S27–S30), Supplier C and anything on the Manufacturer side.
- Any change to the frozen `SUPPLY_PROPOSAL` contract. Its rendered output stays byte-identical (a regression test pins it).
- Changing the sales order line, WMS stock or WMS reservations when quantity is cancelled (Q5). The timeline states this explicitly.
- A manual "apply acceptance" or "accept counter-proposal" UI. `needs_human` is resolved outside the system in Level 3.
- DKIM/SPF verification. This is hub territory; the residual risk is accepted and mitigated by the binding checks in REQ-103.
- Recording mail that correlates to no case (spam, unrelated mail). It is logged only.

## Proposed Solution

Stay on installed seams end to end, and generalise the baseline machinery by message type instead of cloning it.

1. **Polling (Q9).**
   - Activate `scheduler` (`@open-mercato/scheduler`) in `src/modules.ts` before `communication_channels`, which brings its shipped migrations. The hub's `seedDefaults` then registers the per-organization poll tick.
   - The hub only does this for new tenants, so `demo:reset` re-invokes the installed hub `setup.seedDefaults` for the demo scope. That call is an idempotent upsert keyed by a deterministic schedule id.
   - Env knobs: `SCHEDULER_POLL_INTERVAL_MS=5000`, `OM_HUB_POLL_SCHEDULER_TICK_SECONDS=10`.
   - The Supplier channel's `pollIntervalSeconds` is set to 15 through the installed connect route. The IMAP connect widget hard-codes 300, and no update route exists, so this is a one-time runbook step (Phase 1). `demo:preflight` verifies it.
2. **Poll now (Q10).** A guarded app route, `POST /api/supplier_demo/mailbox/poll-now` (`…manage`), repeats the installed poll-now pre-checks and enqueues the hub's own `poll-channel` job for the configured Supplier channel through the hub queue helper. Any Supplier operator can pull the mailbox, not only the mailbox owner or a hub admin.
3. **Inbound (REQ-102/103).**
   - Subscriber `supplier-demo:inbound-supply-reply` on `communication_channels.message.received` calls the command `supplier_demo.supply_message.receive_inbound`.
   - The command loads the hub link, message and sender (`lib/hub-inbound.ts`) and extracts the blocks (`lib/envelope-parse.ts`).
   - It then correlates, validates (`lib/inbound-validation.ts`, ordered rules V1–V14), persists the record and classifies it.
4. **Acceptance (REQ-104).** After commit, `supplier_demo.supply_case.reply_received` triggers subscriber `supplier-demo:apply-acceptance`. That subscriber calls the command `supplier_demo.supply_case.apply_acceptance`, which is undoable and uses the pure `lib/feasibility.ts`.
5. **Confirmation (REQ-105).**
   - `supplier_demo.supply_case.commitment_updated` triggers subscriber `supplier-demo:send-confirmation-email`, which calls the generalised `supplier_demo.supply_message.send`.
   - Threading uses `parentMessageId` = the inbound hub `messages.Message` id and `inReplyTo`/`references` = the inbound RFC `Message-ID`.
   - The generalised `track_delivery` sets `resolved` on `message.sent`.
6. **Console (REQ-107).** A detail route `GET /api/supplier_demo/supply-cases/{id}` returns the case, its messages and a timeline computed server-side by the pure `lib/timeline.ts` from persisted timestamps. The page uses shared primitives; the list page links to it and notifications deep-link to it.
7. **Tooling (REQ-108).** CLI `mail:simulate-reply` prints a ready-to-send reply by default. `--inject` executes the installed `communication_channels.message.ingest_inbound` command on the Supplier channel. That is the real hub ingest: threading, dedupe, compose, then `message.received`. It needs no IMAP, is dev-only, and is double-gated.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| One spec: loop first, console last (Q1) | They share one state machine and one migration; the console is the stage deliverable | Two specs | User decision; phases stay independently shippable |
| `inReplyToMessageId` is mandatory (Q4) | Binds a reply to a specific proposal; makes stale or replayed mail harmless; compensates for no DKIM | `correlationId` + thread only | Weaker against replay and spoofing |
| Mismatch ⇒ record + notify, **case unchanged** | A forged or stale mail must not be able to push a real case into `needs_human`, which would be a denial-of-service on the demo | Move the case to `needs_human` | Lets any spoofed allowlisted From stall the loop. This interprets Q4's "escalates" as human attention, not a state change |
| Commitment only, not the sales order or WMS (Q5) | Smallest blast radius; no stage risk from sales/WMS cascades | Sales line partial cancel | Cascades into WMS reservations; out of scope |
| Book only the accepted production (Q6) | No retroactive change to the verified Phase 4 command; freed capacity is derived from the diff | Tentative holds at proposal time | Changes verified behaviour and the fixture |
| States `reply_received → commitment_updated → confirmation_queued → resolved`, plus `needs_human` (Q7) | Every stage is visible and recoverable; Level 5 extends from `needs_human` | A single `commitment_confirmed` | Hides the in-flight steps the console must show |
| Two commands (record, then apply) linked by a post-commit event | The inbound record must commit even if apply fails; apply is undoable and record is not; each is independently retryable | One command | A feasibility failure would roll back the audit record |
| Timeline derived from persisted timestamps | Deterministic; testable as a pure function; no write contention | An append-only timeline entity or jsonb log | Extra table or lost updates under concurrent subscribers; Q12 limits the change to the two existing tables |
| Scheduler activation + 15 s channel interval (Q9) | No-click inbound on stage | Poll-now only | A human click becomes a single point of failure |
| App poll-now route that enqueues the hub job (Q10) | Operator ≠ mailbox owner on stage | Call the installed route | Needs owner or `communication_channels.admin` |
| Simulator `--inject` through the installed **ingest command**, not the test-seed route (refines Q11b) | A real hub path (dedupe, threading, compose, full event payload); no `OM_ENABLE_TEST_CHANNEL_SEEDING` needed; callable in-process from a CLI | Test-seed `emit-inbound` | That route needs an authenticated HTTP session, bypasses compose, and its event lacks `messageId`. The loader still supports it, so integration tests may use it |
| One additive migration on the two existing tables (Q12); `message_type` becomes nullable for unparseable inbound mail | Minimal DDL; no fake type on a row we could not parse | A `SupplyInboundReceipt` entity | More surface for no gain |
| No manual apply / counter-accept UI | Level 3 scope; negotiation is Level 5 | A button on `needs_human` | Deferred |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Supplier mailbox channel | The hub channel `SUPPLIER_DEMO_MAILBOX_CHANNEL_ID`, resolved with the baseline `resolveMailboxActor` | env + `communication_channels` | Inbound on any other channel is ignored silently |
| Hub inbound record | `MessageChannelLink` (by `channelLinkId`, present in every `message.received` payload) → `messages.Message` (`link.messageId`; `subject`/`body` encrypted) → `ExternalMessage` (by `externalMessageId` when present) | hub | Rows missing → log `hub_rows_missing`, no record (persistent-subscriber retry covers a read-after-commit race) |
| Transport sender | `ExternalMessage.senderIdentifier`, else `link.channelPayload.from` (first address); lower-cased | hub | Missing → `untrusted_sender` |
| Inbound text | `Message.body` (decrypted) when `bodyFormat` is text/markdown; HTML is tag-stripped and entity-decoded; else `link.channelPayload.text`. CRLF → LF | hub | Empty → `no_envelope` |
| Machine block | Text between `---OPEN-MERCATO-SUPPLY-MESSAGE---` and `---END-OPEN-MERCATO-SUPPLY-MESSAGE---`. Each line inside is stripped of leading quote markers (`>`, `> >`) and whitespace. At most 16 KB per block, at most 10 blocks per mail | `lib/envelope-parse.ts` | Oversize → `schema_invalid` |
| Foreign block | A parsed block whose `messageId` is **not** one of this case's outbound `businessMessageId`s and whose `messageType` ∉ {`SUPPLY_PROPOSAL`, `SUPPLY_COMMITMENT_CONFIRMED`}. These drop our own proposal quoted in the reply | parser | 0 → `no_envelope`; > 1 distinct → `ambiguous_envelope` |
| Case correlation | By the envelope `correlationId` (scoped, non-deleted); else by thread (`Message.threadId` = an outbound `commThreadId` of the case); else by a subject token `[SC-…]` | `SupplyCase`, `SupplyMessage` | No case → log `unmatched_inbound`, no record |
| Case partner | `SupplyCase.recipientEmail` (decrypted) — the address the proposal went to | `SupplyCase` | Sender ≠ partner → `sender_not_case_partner` |
| Latest outbound reference | `businessMessageId` of the case's most recent outbound message of type `SUPPLY_PROPOSAL` | `SupplyMessage` | Mismatch → `stale_reference` |
| Awaiting reply | Case `status ∈ {proposal_queued, proposal_delivered}`. `proposal_queued` is included because the hub `.sent` event can lag a very fast reply | `SupplyCase.status` | `resolved` → `case_closed`; any other status → `case_not_awaiting_reply` |
| Inbound dedupe | Only **valid** inbound rows store the envelope `messageId` in `business_message_id`, which is covered by the existing partial unique index. V10 compares against valid rows only. Event redelivery is idempotent via the unique `hub_channel_link_id` | `SupplyMessage` | A duplicate of a valid envelope creates no new row; the original row's `duplicate_count` is incremented. An invalid or untrusted mail can therefore never reserve ("squat") an id and block the real acceptance |
| Synthetic inbound id | Every inbound row that is **not valid** stores `business_message_id = INB-<channelLinkId>`. The envelope id it carried, if any, goes to `envelope_message_id` for display only | receive command | — |
| Inbound storage bound | At most 20 inbound rows per case. `untrusted_sender` rows store no `body_excerpt` (subject + reason only) | receive command | Over the cap → log `inbound_cap_reached`, no row |
| `needs_human` vs `escalated` | `escalated` (baseline) = the Supplier's own planning or policy stopped **before** anything was sent. `needs_human` = the **partner's reply** or the reply automation needs a person **after** the proposal was sent. Level 5 negotiation starts from `needs_human` only | `SupplyCase.status` | — |
| Reopen | Operator command `supply_case.reopen` leaves `needs_human`. The target depends on the reason: `counter_proposal_received`, `rejection_received`, `acceptance_infeasible_F*` and `acceptance_undone` → `proposal_delivered` (waiting for a new reply). `auto_reply_disabled_apply` → `reply_received` + re-emit `reply_received`. `auto_reply_disabled_send` → `commitment_updated` + re-emit `commitment_updated`. The two `auto_reply_disabled_*` targets are refused while the reply toggle is off | `SupplyCase` | 409 stale version; 422 when not `needs_human` or when the toggle is off for an `auto_reply_disabled_*` target |
| Accepted commitment | `acceptedCommitments` from a valid acceptance, normalised to `[{quantity, date}]` sorted by date | `SupplyCase.acceptedCommitment` | — |
| Cancelled commitment | Taken from the acceptance's `cancelledCommitments` (explicit per-date tranches, validated by F2/F3), normalised to `[{quantity, date}]` sorted by date. It is never derived by the Supplier: the Manufacturer states exactly which tranches it cancels | `SupplyCase.cancelledCommitment` | — |
| Production quantity of a tranche | `accepted(date) − (date == originalDate ? warehouseReserved : 0)`, floored at 0. `warehouseReserved` = the baseline tranche quantity on the original date | `lib/feasibility.ts` | — |
| Freed capacity | For each date: `proposedProduction(date) − acceptedProduction(date)` where > 0. Display only; nothing was held (Q6) | `SupplyCase.freedCapacity` | — |
| Feasibility rules | **F1** `acceptedCommitments` is non-empty; every quantity in `acceptedCommitments` and `cancelledCommitments` is an integer > 0 (`cancelledCommitments` may be empty). **F2** every accepted and every cancelled date is one of `currentCommitment`'s dates, and no date repeats within either list. **F3** for **every** date of `currentCommitment`: `accepted(date) + cancelled(date) == proposed(date)` (an absent entry counts as 0). This implies `accepted ≤ proposed` and leaves no tranche unaccounted for. **F4** no accepted date is before today (tenant timezone). **F5** each tranche's production quantity fits the free capacity of the slot on that date (a missing slot with quantity 0 is fine) | `lib/feasibility.ts` | First failing rule → `needs_human` / `acceptance_infeasible_F<n>`, no confirmation |
| Reply kill switch | Feature toggle `supplier_demo_auto_supply_reply` (default on). It gates `apply_acceptance` and the confirmation send. Recording always runs | `feature_toggles` | Off at apply → `needs_human` / `auto_reply_disabled_apply`. Off at send → `needs_human` / `auto_reply_disabled_send`. Both raise an attention notification (never a silent stall) and are re-driven by `reopen` |

### State machine delta (`SupplyCase.status`)

```text
proposal_queued | proposal_delivered                      (= "awaiting reply")
   ├─ valid SUPPLY_ACCEPTANCE ────────────▶ reply_received
   │                                          ├─ feasible ──▶ commitment_updated ─send ok─▶ confirmation_queued ─hub sent─▶ resolved (terminal)
   │                                          │                      │ enqueue fail / state unknown   │ hub delivery_failed (non-transient)
   │                                          │                      └──────────────▶ send_failed ◀──┘
   │                                          │                                         └─operator retry─▶ commitment_updated
   │                                          ├─ infeasible (F1–F5) ─▶ needs_human
   │                                          └─ reply toggle off ───▶ needs_human (auto_reply_disabled_apply)
   │                           commitment_updated + toggle off at send ─▶ needs_human (auto_reply_disabled_send)
   │                           commitment_updated + undo apply_acceptance ─▶ needs_human (acceptance_undone)
   │   needs_human ─operator reopen─▶ proposal_delivered | reply_received | commitment_updated  (see "Reopen")
   ├─ valid SUPPLY_COUNTER_PROPOSAL ─▶ needs_human (counter_proposal_received)   ← Level 5 extends here
   ├─ valid SUPPLY_REJECTION ───────▶ needs_human (rejection_received)
   └─ invalid / untrusted / stale / duplicate ─▶ (no transition; inbound recorded)
resolved | needs_human + any later inbound ─▶ (no transition; recorded as case_closed / case_not_awaiting_reply)
```

Rules:

- **Proposal delivery tracking is monotonic.** `track_delivery` sets `proposal_delivered` only while the case is `proposal_queued`, so a fast acceptance is never regressed.
- **`send_failed` still means "an outbound message failed".** `retry` picks the case's latest non-delivered outbound message and returns the case to `proposal_ready` (proposal) or `commitment_updated` (confirmation).
- **`retry` also accepts `reply_received` with an unapplied valid acceptance.** It re-emits `reply_received`, which recovers a lost event. There is no backlog to worry about, because acceptances only move the case once the consumer ships (Phase 3).
- **Attention notifications.** Every transition to `needs_human` or `send_failed` emits `supplier_demo.supply_case.attention_required`.

`SupplyMessage.validationStatus` (inbound only; `null` for outbound): `valid | untrusted_sender | sender_not_case_partner | no_envelope | ambiguous_envelope | schema_invalid | unsupported_type | envelope_address_mismatch | correlation_mismatch | sku_mismatch | stale_reference | case_closed | case_not_awaiting_reply`. Duplicates do not create rows. They increment `duplicate_count` on the original valid row, and the UI shows that as a "duplicate ignored ×n" count, not as a badge.

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| System (hub + our subscribers) | Record inbound mail, apply an acceptance, send the confirmation, track delivery | `tenantId` + `organizationId` from the trusted hub/command-emitted event payload; the org must equal the Supplier mailbox org; both required | n/a (`systemActor: true` command ctx, baseline `helpers.ts`) |
| Supplier operator | View a case, its messages and timeline | Selected organization | `supplier_demo.supply_cases.view` |
| Supplier operator | Poll the mailbox now; retry `send_failed` | Selected organization = mailbox organization | `supplier_demo.supply_cases.manage` |
| Operator (CLI) | `demo:*`, `mail:simulate-reply` | Tenant/org of the configured mailbox user | shell access; `--inject` additionally requires `NODE_ENV !== 'production'` and `SUPPLIER_DEMO_ALLOW_REPLY_INJECTION=true` |

- **Subscribers** return early when scope is missing or when the channel is not the Supplier mailbox. They never infer scope and never read scope from the mail.
- **Routes** derive scope from auth and the selected organization, never from the body.
- **Poll-now** 404s when the selected organization differs from the mailbox channel's organization.
- **No new ACL features.** `view` and `manage` are reused.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| IMAP fetch, MIME, threading, hub dedupe | Reuse | `communication_channels`, `channel_imap`, `messages` | event `communication_channels.message.received`; entities `MessageChannelLink`, `ExternalMessage`, `messages.Message` (read-only, scoped, decrypting) | Canonical mailbox hub |
| Automatic polling | Reuse (activate) | `scheduler` (`@open-mercato/scheduler`) | hub `setup.seedDefaults` poll-tick registration | Installed mechanism; currently inactive |
| Poll on demand | Reuse the hub job | `communication_channels` | `getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)` + `PollChannelJobPayload`; `isHubPolledChannel` | Same worker as the installed poll-now |
| Threaded reply send | Reuse | `communication_channels` | DI `communicationChannelsSendAsUser` with `parentMessageId`, `inReplyTo`, `references` | The baseline send path |
| Simulated inbound | Reuse | `communication_channels` | command `communication_channels.message.ingest_inbound` | Real ingest without IMAP |
| Envelope parse/validate, feasibility, commitment update, timeline | App-own | `supplier_demo` | commands + app events | Supplier-private domain |
| Attention notifications | Reuse | `notifications` | existing type `supplier_demo.supply_case.attention_required` (href → detail page) | Frozen type id, additive reasons |
| Reply kill switch | Reuse | `feature_toggles` | new toggle `supplier_demo_auto_supply_reply` | Canonical toggles |

## Architecture and Data Flow

```text
OVH IMAP ◀─poll─ hub poll-channel worker ◀─ poll-tick (scheduler, every 10 s; channel due every 15 s)
                                          ◀─ POST /api/supplier_demo/mailbox/poll-now (operator)
   └─▶ communication_channels.message.ingest_inbound (installed; dedupe, thread match, compose)
         └─▶ communication_channels.message.received {messageId, externalMessageId, channelLinkId, channelId, …, tenantId, organizationId}
               └─▶ supplier_demo:inbound-supply-reply (persistent, NEW)
                     └─▶ cmd supplier_demo.supply_message.receive_inbound (non-undoable, one transaction)
                           ├─ channelId ≠ Supplier mailbox → return {ignored}
                           ├─ existing row with hub_channel_link_id → return (idempotent redelivery)
                           ├─ lib/hub-inbound.load() (scoped, decrypting)
                           ├─ lib/envelope-parse.extract() → foreign blocks
                           ├─ correlate case (correlationId → thread → subject token); none → log, return
                           ├─ lib/inbound-validation.validate() → V1…V14 → validationStatus
                           ├─ duplicate → duplicate_count++ on the original; return
                           ├─ insert SupplyMessage(inbound, …) with id assigned in code
                           ├─ ACCEPTANCE ∧ valid   → case reply_received, reply_received_at   (Phase 3; in Phase 2 recorded only, case unchanged)
                           ├─ COUNTER|REJECTION ∧ valid → case needs_human (+ reason)
                           └─ after commit: reply_received | attention_required (per notification rule)

supplier_demo.supply_case.reply_received
   └─▶ supplier_demo:apply-acceptance (persistent, NEW) → cmd supplier_demo.supply_case.apply_acceptance (undoable)
         guard: status reply_received ∧ inbound valid ACCEPTANCE ∧ applied_at null; reply toggle on (else needs_human auto_reply_disabled_apply)
         lock affected SupplierProductionSlot rows (pessimistic_write, same transaction), then
         lib/feasibility.evaluate(case, acceptance, slots, today)
         ├─ infeasible → needs_human (acceptance_infeasible_F<n>) + attention_required
         └─ feasible  → accepted/cancelled/freed, commitment_updated_at; slot allocations += accepted production
                        (command log snapshotBefore.productionSlots); inbound.applied_at;
                        insert SupplyMessage(outbound, SUPPLY_COMMITMENT_CONFIRMED, pending) with id assigned in code;
                        status commitment_updated → after commit emit commitment_updated

supplier_demo.supply_case.commitment_updated
   └─▶ supplier_demo:send-confirmation-email (persistent, NEW) → cmd supplier_demo.supply_message.send (generalised)
         guard by type: CONFIRMATION requires case commitment_updated ∧ message pending; reply toggle off → needs_human
         (auto_reply_disabled_send) + attention_required — never a silent no-op
         sending marker → sendAsUser({…, parentMessageId: inbound.hubMessageId, inReplyTo: inbound.rfcMessageId,
                                        references: [inbound.rfcMessageId], channelMetadata: {supplierDemoBusinessMessageId, …}})
         ok → queued_in_hub, queued_at; case confirmation_queued → emit confirmation_queued
communication_channels.message.sent → track_delivery (generalised): CONFIRMATION → delivered_at; case resolved, resolved_at → emit resolved
```

- **Module boundaries.** Everything stays in `supplier_demo`, because the inbound record, the acceptance and the confirmation share the case invariant. `index.ts` `requires` gains `messages` only. `scheduler` is deliberately **not** a hard requirement: automatic polling degrades to poll-now without it, `demo:preflight` reports its absence, and the rollback stays possible.
- **Extension points.** Installed events, the DI send facade, the hub ingest command, the hub queue helper and the scheduler (via the hub `seedDefaults`) are used. No installed file is edited.
- **Imports of installed internals are read-only.** They are the hub entities, `lib/queue`, `lib/polling-eligibility`, the `workers/poll-channel` payload type and `setup`. They are pinned to the installed 0.8.0. Phase 1 step 1 re-verifies each path; a missing export is a stop-and-ask, never a copy.
- **Compatibility.** Additive only:
  - new states, reasons, events, routes, columns and a toggle;
  - `SupplyEnvelope` becomes a discriminated union, and the `SUPPLY_PROPOSAL` output is pinned byte-identical;
  - the existing event payloads are unchanged;
  - the notification type id is unchanged; only its action href moves to the detail page.

## User Journeys

### Journey J-101 — Stage loop (main path)

1. Preconditions: `demo:reset` → `demo:preflight` all green (scheduler, poll tick, channel interval ≤ 15 s, toggles, encryption maps). The baseline J-001 runs and the case is `proposal_delivered` with `400 Wed / 100 Fri`. The operator opens **Supply cases → SC-SO-441**; the console shows "Waiting for response".
2. The Manufacturer OM (or the operator from the Manufacturer webmail, using `mail:simulate-reply` output) replies: accept 400 Wed, cancel 100.
3. Within ≤ 15–25 s the hub polls. For an instant pull, the operator presses **Poll mailbox now**; the button confirms "Poll queued" and disables itself for 10 s.
4. The timeline updates live (3 s refetch while the case is not terminal): **E-mail received ✓ valid → Feasibility ✓ → Commitment updated: 400 Wed accepted, 100 Fri cancelled (100 pcs Fri capacity freed) → Confirmation sent → Resolved**. The e-mail panel shows the received acceptance and the sent confirmation, each with its human text and parsed envelope.
5. The Manufacturer inbox receives `[SC-SO-441] Commitment confirmed — MAT-42` in the same thread.

### Journey J-102 — Unsafe or unexpected replies

- **Mail from a non-allowlisted sender, no block, two blocks, or a bad schema.** The timeline shows "E-mail received — rejected: <reason>". The case stays waiting. An attention notification fires only for mail from the case partner.
- **An acceptance referencing an older proposal id.** It is recorded as `stale_reference` and an attention notification fires; the case stays waiting.
- **A counter-proposal or rejection.** The case becomes **Needs human** with its reason, the parsed envelope is visible, a notification fires, and nothing is sent.
- **The same acceptance again (re-send, or event replay).** No new row and no second confirmation; the timeline shows "duplicate ignored ×n".
- **A reply after `resolved`.** It is recorded as `case_closed`, with no notification and no send.

### Journey J-103 — Confirmation delivery failure

The mailbox is disconnected when the confirmation is sent. The case goes to `send_failed` / `mailbox_disconnected` and a notification fires. The operator reconnects the mailbox and presses **Retry** on the list or the console, sending the current `updatedAt`. Exactly one confirmation goes out and the case reaches `resolved`. A stale version returns 409, which is surfaced by the shared conflict UI.

### Journey J-104 — Before the Manufacturer OM exists

1. `yarn mercato supplier_demo mail:simulate-reply --type acceptance --accept 400` prints the subject, the human body and a valid envelope bound to the live case (its `correlationId`, the latest proposal `messageId`, the SKU, and the dates of `currentCommitment`). With `--accept N`, the accepted tranche is N on the original date, and `cancelledCommitments` lists the remainder of every tranche per date, so F3 holds by construction.
2. The operator pastes it into a **reply** to the proposal in the Manufacturer's OVH webmail. That exercises the real IMAP path.
3. For fast local loops, `--inject` runs the installed hub ingest instead. `--type counter|rejection|malformed|wrong-sender|stale` produces each negative scenario.

## UI and Interaction Contracts

Closest installed references:

- `node_modules/@open-mercato/core/src/modules/workflows/backend/instances/[id]/page.tsx` — record detail with an event history, `JsonDisplay`, `Alert`, `Tabs`, guarded actions and `useConfirmDialog`;
- the baseline list `src/modules/supplier_demo/backend/supplier-demo/supply-cases/page.tsx` + `components/SupplyCasesTable.tsx`.

The rules are in `.ai/guides/backend-ui.md`. Implementation invokes `om-backend-ui-design` and reads `references/quality-states.md`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/supplier-demo/supply-cases/[id]` (new, `navHidden`) | Case console: stage stepper, commitments, timeline, e-mail previews; **Poll mailbox now**; **Retry** (only when `send_failed`); **Reopen** (only when `needs_human`, with `useConfirmDialog`) | `GET /api/supplier_demo/supply-cases/{id}`; `POST /api/supplier_demo/mailbox/poll-now`; `POST /api/supplier_demo/supply-cases/{id}/retry`; `POST /api/supplier_demo/supply-cases/{id}/reopen` | `workflows/backend/instances/[id]/page.tsx` | `Page`, `PageBody`, `FormHeader`/`SectionHeader`, `StepIndicator`, `ActivityFeed`, `StatusBadge`, `Tabs`, `JsonDisplay`, `Alert`, `Button`, `LoadingMessage`, `ErrorMessage`, `RecordNotFoundState`, shared conflict surfacing, `apiCall`/`useGuardedMutation` | loading, not found (404/other org), permission denied, error + retry, waiting (live refetch), needs_human alert, send_failed alert + Retry, conflict (409), poll queued / poll refused (409 mailbox state) / 503 not configured, empty e-mail panel | REQ-101, REQ-105, REQ-106, REQ-107 |
| `/backend/supplier-demo/supply-cases` (changed) | Row action **Open** (stable id `open`) + case-number link → console; new status badges and filter options; the "Proposed" column shows `accepted + cancelled` when present | existing list API (new statuses only) | baseline list | existing `DataTable` + `RowActions` | existing states + new statuses in light/dark | REQ-107 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Supplier operator | … **Supply Recovery → Supply cases** (unchanged); the console is reached from a row or a notification | none | Supply cases → row **Open** (2 clicks); notification → console (1 click) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Console timeline | Before any reply: the "Waiting for response" step is `current`, with the hint "Replies are fetched automatically every ~15 s. Use Poll mailbox now to fetch immediately." | Single column below `md`; commitments cards stack; the stepper switches to compact dots (`StepperDots`) | Header actions in DOM order (Poll, Retry); the timeline is an ordered list; the live-status region is `aria-live="polite"` announcing status changes |
| E-mail previews | "No e-mails yet" plus an explanation | `Tabs` scroll horizontally; body `pre` wraps | Tabs support arrow keys; each tab label has direction, type and validation for screen readers |

### `/backend/supplier-demo/supply-cases/[id]` — Supply case console

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Supply cases   SC-SO-441 · SO-441 · Manufacturer A · MAT-42   [Resolved ●]      │
│                                              [⟳ Poll mailbox now] [Retry]*        │
│ (Detected)──(Proposal sent)──(Reply received)──(Commitment updated)──(Resolved)   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Original        Proposed           Accepted          Cancelled                    │
│ 500 Wed         400 Wed / 100 Fri  400 Wed           100 Fri (capacity freed)     │
│ ⓘ Sales order and warehouse reservations are not changed by this commitment.     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Timeline                                                                          │
│ ✓ 10:02:01 Delivery risk detected — shortfall 200 (WMS)                           │
│ ✓ 10:02:01 Baseline 300 Wed / 200 Fri                                             │
│ ✓ 10:02:01 Replan: SO-442 +4 h, +120 PLN, other SLA protected   (– if Level 3)    │
│ ✓ 10:02:01 Policy AUTO APPROVED                                  (– if Level 3)    │
│ ✓ 10:02:04 E-mail sent to Manufacturer A — 400 Wed / 100 Fri (delivered)          │
│ ✓ 10:02:04 Waiting for response                                                   │
│ ✓ 10:03:12 E-mail received — SUPPLY_ACCEPTANCE ✓ valid   (+ rejected mails, dup×n)│
│ ✓ 10:03:12 Feasibility ✓                                                          │
│ ✓ 10:03:13 Commitment updated — 400 Wed accepted, 100 Fri cancelled               │
│ ✓ 10:03:15 Confirmation sent (delivered)                                          │
│ ✓ 10:03:15 Resolved                                                               │
├──────────────────────────────────────────────────────────────────────────────────┤
│ E-mails  [↗ Proposal] [↙ Acceptance ✓] [↗ Confirmation]                           │
│ From / To / Subject / time / delivery or validation badge                          │
│ ┌ Message ───────────────────┐ ┌ Parsed envelope (JsonDisplay) ─────────────────┐ │
│ │ human text (plain, escaped) │ │ { schemaVersion, messageId, correlationId, …} │ │
│ └─────────────────────────────┘ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
* Retry only in send_failed; Reopen only in needs_human; Poll only with …manage and a configured mailbox.
```

- **Behavior:**
  - Data loads through `apiCall`, with react-query keyed by the case id and the organization scope version.
  - `refetchInterval` is 3 s while the status is not terminal (`resolved`, `needs_human`, `escalated`); the page also refetches on focus and after every action.
  - **Poll mailbox now** uses `useGuardedMutation` → flash "Poll queued" → 10 s cooldown. A 409 shows the localized mailbox-state message (disconnected / requires reauth / not polled); a 503 shows "mailbox not configured".
  - **Retry** sends the case `updatedAt`; a 409 goes to the shared conflict message plus a refetch.
  - **Reopen** (only in `needs_human`) asks for confirmation via `useConfirmDialog`, showing the target state; it sends `updatedAt` and handles 409/422 like Retry.
  - Body text renders as escaped plain text (never HTML). Addresses are decrypted server-side.
  - `JsonDisplay` shows the stored envelope (without addresses) or, for invalid inbound mail, the validation reason.
- **Why no DataTable on the console:** at most ~6 messages per case, shown as a timeline and tabs, which is not tabular data. The list page keeps `DataTable`.
- **Localization:** namespace `supplier_demo.supplyCases.*`, adding:
  - `status.{reply_received, commitment_updated, confirmation_queued, resolved, needs_human}`;
  - `reason.*` for the new reasons;
  - `validation.*`, `timeline.*`, `console.*`, `mailbox.poll.*`.

  Both `en` and `pl` are required, including every validation status and reason. Commitments render as `{qty} {weekday, date}` in the user's locale.
- **Design system:** `StatusBadge` with a `StatusMap` of semantic variants:
  - info: `reply_received`, `commitment_updated`, `confirmation_queued`;
  - success: `resolved`;
  - warning: `needs_human`;
  - error: `send_failed`.

  Validation badges: `valid` success; `case_closed` and `case_not_awaiting_reply` neutral; all others warning. Duplicates appear as a "duplicate ignored ×n" count on the original row. No hard-coded colors and no arbitrary values; verify in light and dark.

## Data Models

One additive migration (`yarn db:generate`, review the scoped SQL and snapshot, **ask before applying**). The only change to an existing column is `supply_messages.message_type` dropping NOT NULL, which is backward compatible because existing rows keep their value. The TS unions widen with no DDL, because `direction` and `message_type` are `text`.

### `SupplyCase` delta

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `status` | text — adds `reply_received`, `commitment_updated`, `confirmation_queued`, `resolved`, `needs_human` | existing index | no | command-only transitions |
| `accepted_commitment` | jsonb `[{quantity, date}]`, null | — | no | set once by `apply_acceptance`; cleared by undo |
| `cancelled_commitment` | jsonb `[{quantity, date}]`, null | — | no | same |
| `freed_capacity` | jsonb `[{date, quantity}]`, null | — | no | same (display only) |
| `reply_received_at` / `commitment_updated_at` / `resolved_at` | timestamptz, null | — | no | set at each transition; timeline source |

`current_commitment` keeps its baseline meaning (the commitment we proposed) and is never rewritten.

### `SupplyMessage` delta

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `direction` | text — adds `inbound` (TS only) | new index (org, tenant, supply_case_id, direction) | no | — |
| `message_type` | text — all 5 contract types (TS only) | — | no | inbound: the parsed type, or `null` when unparseable (column becomes nullable → the **only** alteration; flag in SQL review) |
| `validation_status` / `validation_reason` | text, null (reason ≤ 500 chars, no body content) | — | no | inbound only |
| `envelope_message_id` | text, null | — | no | inbound: the envelope `messageId` as received, even when invalid; display and forensics only, never deduplicated. `business_message_id` holds it only for `valid` rows |
| `hub_channel_link_id` | uuid, null | **unique** (org, tenant, hub_channel_link_id) where not null and `deleted_at is null` | no | inbound idempotency |
| `hub_external_message_id` | uuid, null | — | no | — |
| `hub_message_id` | uuid, null | — | no | inbound `messages.Message.id`; the confirmation's `parentMessageId` |
| `rfc_message_id` | text, null | — | no | inbound RFC `Message-ID` → the confirmation's `inReplyTo`/`references` |
| `in_reply_to_business_id` | text, null | — | no | the envelope's `inReplyToMessageId` (inbound) or the acceptance id we answer (confirmation) |
| `received_at` / `queued_at` / `delivered_at` / `applied_at` | timestamptz, null | — | no | timeline sources; `applied_at` = the acceptance consumed |
| `duplicate_count` | int, default 0 | — | no | incremented on a duplicate envelope |
| `body_excerpt` | text, null | — | **yes** (encryption map) | inbound: the normalised text, ≤ 8 000 chars (`null` for `untrusted_sender`); outbound: the human part only. Read with `findWithDecryption` |

- **`envelope_payload` for inbound rows:** the parsed foreign envelope without `sender`/`recipient`, as for outbound rows, or `{}` when unparseable.
- **`sender_email` / `recipient_email`** (already encrypted) hold the transport addresses.
- **`subject`:** the inbound subject, truncated to 500 chars.
- **`supply_case_id`** stays NOT NULL, because uncorrelated mail is not recorded.

**Encryption:** add `body_excerpt` to `supplier_demo:supply_message` in `encryption.ts`. The map is copied into tenants only at creation, so `demo:reset` / `seedExamples` re-run `ensureSupplierDemoEncryptionMaps`. `demo:preflight` checks **field-level** presence of `body_excerpt`, not just the entity row.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| command | `supplier_demo.supply_message.receive_inbound` | system actor | hub `message.received` payload (`channelLinkId` required; `messageId`, `externalMessageId` optional) | `{ recorded, ignoredReason?, supplyMessageId?, caseId?, validationStatus? }`; after commit `…supply_case.reply_received` (from Phase 3) or `…attention_required` | never throws for business conditions; unique `hub_channel_link_id` absorbs redelivery | REQ-102, 103, 106 |
| command | `supplier_demo.supply_case.apply_acceptance` | system actor or `…manage` | `{ caseId, supplyMessageId }` | `{ status }`; after commit `…commitment_updated` or `…attention_required` | no-op unless guards hold. Slot rows are locked `pessimistic_write` in the transaction and F5 is re-checked under the lock. **Undo** restores the accepted/cancelled/freed fields, slot allocations (`snapshotBefore.productionSlots`) and `applied_at`, soft-deletes the pending confirmation, and moves the case to `needs_human` / `acceptance_undone`, so the change is visible and `reopen` re-drives it. Undo is refused with 409 `confirmation_already_sent` once the confirmation is past `pending`/`enqueue_failed`. Honest scope: with the reply toggle on, the confirmation leaves within milliseconds, so undo is practically usable only when the send was held (toggle off → `auto_reply_disabled_send`) or failed (`enqueue_failed`) | REQ-104 |
| command | `supplier_demo.supply_case.reopen` | `…manage` | `{ caseId, updatedAt }` | target per the "Reopen" rule; re-emits `reply_received` / `commitment_updated` where the rule says so | 409 version; 422 not `needs_human`, or toggle off for an `auto_reply_disabled_*` target | REQ-106 |
| command (generalised) | `supplier_demo.supply_message.send` | system actor or `…manage` | `{ supplyMessageId }` | PROPOSAL: unchanged. CONFIRMATION: `confirmation_queued` + `…confirmation_queued` | type-specific guard; `sending` marker; no automatic resend | REQ-105 |
| command (generalised) | `supplier_demo.supply_message.track_delivery` | system actor | hub payload | PROPOSAL: `proposal_delivered` only from `proposal_queued`. CONFIRMATION: `resolved` + `…resolved` | unknown id → ignore | REQ-105 |
| command (generalised) | `supplier_demo.supply_case.retry` | `…manage` | `{ caseId, updatedAt }` | `send_failed`: selects the latest non-delivered outbound message; confirmation → `commitment_updated` + re-emit. `reply_received` with an unapplied valid acceptance: re-emit `reply_received` | 409 version; 422 status | REQ-105 |
| `POST` | `/api/supplier_demo/supply-cases/{id}/reopen` | auth + `…manage` | `{ updatedAt }` | 202 `{ status }` | 400/403/404/409/422 | REQ-106 |
| `GET` | `/api/supplier_demo/supply-cases/{id}` | auth + `…view` | path `id` (uuid) | `{ case: {…, acceptedCommitment, cancelledCommitment, freedCapacity, updatedAt}, messages: [{ id, direction, messageType, businessMessageId, subject, sender, recipient, deliveryStatus, validationStatus, validationReason, envelope, bodyExcerpt, duplicateCount, createdAt, receivedAt, queuedAt, deliveredAt }], timeline: [{ key, state: 'done'\|'current'\|'pending'\|'error'\|'skipped', at, labelKey, params }], mailbox: { pollable: boolean } }` | 400/401/403/404 (another org → 404) | REQ-107 |
| `POST` | `/api/supplier_demo/mailbox/poll-now` | auth + `…manage` | `{}` | 202 `{ queued: true, requestedAt }`. Mirrors the installed pre-checks: allowed in the channel states `connected` and `error` | 403; 404 org ≠ mailbox org; 409 `{code: mailbox_disconnected\|mailbox_requires_reauth\|mailbox_disabled\|mailbox_not_polled}` (`mailbox_not_polled` = push-driven channel); 503 `mailbox_not_configured` | REQ-101 |

Both new routes are custom guarded routes. They are not `makeCrudRoute`: the detail joins decrypted messages and a computed timeline, and poll-now is not CRUD. Each declares per-method `metadata` (`requireAuth`, `requireFeatures`) and `openApi` (added to `api/supplier-cases-openapi.ts`). Poll-now runs `validateRouteMutationGuard` (`resourceKind: 'supplier_demo.mailbox'`, `operation: 'custom'`). The detail response includes `updatedAt` for Retry.

### Shared contract addendum v1 (proposed; frozen jointly with the Manufacturer owner — Q2/Q3)

**Two layers in every mail, in both directions (roadmap §8, Level 3 §10–11).** Every contract e-mail, including `SUPPLY_ACCEPTANCE`, has:

1. a human-readable body; and
2. exactly one machine-readable `SupplyEnvelope` block between the `---OPEN-MERCATO-SUPPLY-MESSAGE---` / `---END-OPEN-MERCATO-SUPPLY-MESSAGE---` markers.

A reply with only natural-language text ("We accept 400 pcs Wednesday…") is recorded as `no_envelope` and never triggers automation (V4). `inReplyToMessageId` is a mandatory field **inside** the envelope. It adds a binding; it does not replace the envelope. "Plain text" elsewhere in this spec refers only to the MIME body format (`text/plain` preferred over HTML, so the block is not escaped or re-wrapped). It never means "without the envelope".

The top level is unchanged from the frozen contract (`schemaVersion: 1, messageId, correlationId, messageType, sender, recipient, payload`). `correlationId` stays `SC-<orderNumber>`, the same as the proposal. The same markers are used. Dates are ISO calendar dates.

`inReplyToMessageId` lives in `payload`, not at the top level. The top-level key set is frozen, and the parser rejects unknown top-level keys, so adding a top-level field would be a change to the frozen contract.

Complete example of an acceptance e-mail (Manufacturer → Supplier):

```text
Subject: Re: [SC-SO-441] Delivery update — MAT-42

We accept 400 pcs Wednesday.
The remaining 100 pcs are no longer required.
Please confirm.

---OPEN-MERCATO-SUPPLY-MESSAGE---
{
  "schemaVersion": 1,
  "messageId": "MSG-<uuid>",
  "correlationId": "SC-SO-441",
  "messageType": "SUPPLY_ACCEPTANCE",
  "sender": "<manufacturer mailbox>",
  "recipient": "<supplier mailbox>",
  "payload": {
    "sku": "MAT-42",
    "inReplyToMessageId": "MSG-<proposal messageId>",
    "acceptedCommitments": [{"quantity": 400, "date": "YYYY-MM-DD"}],
    "cancelledCommitments": [{"quantity": 100, "date": "YYYY-MM-DD"}]
  }
}
---END-OPEN-MERCATO-SUPPLY-MESSAGE---
```

Payload shapes:

```text
SUPPLY_ACCEPTANCE              (Manufacturer → Supplier)
payload: { "sku": "MAT-42",
           "inReplyToMessageId": "MSG-<proposal messageId>",           // required (Q4)
           "acceptedCommitments": [{"quantity": 400, "date": "YYYY-MM-DD"}],     // ≥ 1 tranche
           "cancelledCommitments": [{"quantity": 100, "date": "YYYY-MM-DD"}] }  // 0..n tranches; per date,
                                                  // accepted + cancelled == proposed (F3)

SUPPLY_COMMITMENT_CONFIRMED    (Supplier → Manufacturer)
subject: [SC-<orderNumber>] Commitment confirmed — <SKU>
payload: { "sku": "MAT-42",
           "inReplyToMessageId": "MSG-<acceptance messageId>",
           "confirmedCommitments": [{"quantity": 400, "date": "YYYY-MM-DD"}],
           "cancelledCommitments": [{"quantity": 100, "date": "YYYY-MM-DD"}] }   // echoes the accepted cancellation
human:   "We confirm 400 pcs of MAT-42 on <weekday date> for order SO-441. The 100 pcs planned for <weekday date> are cancelled as requested."

SUPPLY_COUNTER_PROPOSAL / SUPPLY_REJECTION   (recorded only in this spec; Level 5 tightens)
payload: { "sku", "inReplyToMessageId", … }   // only sku + inReplyToMessageId are validated; the rest is stored verbatim
```

- **Validation:** Zod discriminated union on `messageType`; `schemaVersion` must be `1`; unknown top-level keys are rejected; unknown payload keys are rejected for ACCEPTANCE and passed through for COUNTER/REJECTION.
- **Supplier rendering:** `lib/compose.ts` gains `composeCommitmentConfirmation`. The `SUPPLY_PROPOSAL` renderer is untouched.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| scheduler interval (10 s) | `scheduler` | hub `poll-tick` worker (installed) | enqueues due channels (15 s) | hub-owned |
| `communication_channels.message.received` | hub | `supplier-demo:inbound-supply-reply` (persistent, NEW) | `receive_inbound` | unique `hub_channel_link_id`; never throws for business conditions |
| `supplier_demo.supply_case.reply_received` `{caseId, supplyMessageId}` (NEW) | supplier_demo | `supplier-demo:apply-acceptance` (persistent, NEW) | `apply_acceptance` | guard `applied_at is null` |
| `supplier_demo.supply_case.commitment_updated` `{caseId, confirmationMessageId}` (NEW) | supplier_demo | `supplier-demo:send-confirmation-email` (persistent, NEW) | `supply_message.send` | `sending` marker; no automatic resend |
| `supplier_demo.supply_case.confirmation_queued` `{caseId, supplyMessageId, commMessageId}` (NEW) | supplier_demo | — | — | — |
| `communication_channels.message.sent` / `.delivery_failed` | hub | existing track subscribers (generalised command) | `resolved` / `send_failed` | idempotent state writes; monotonic |
| `supplier_demo.supply_case.resolved` `{caseId}` (NEW) | supplier_demo | — | — | — |
| `supplier_demo.supply_case.attention_required` (existing, new reasons) | supplier_demo | existing notification subscriber | notification → **console href** | one per transition or per notifiable inbound |

**Notification rule for inbound mail:** notify for any invalid status from the case partner (the sender passed V2 and V3) except `case_closed` and `case_not_awaiting_reply`, and notify for every `needs_human` transition. Mail from untrusted senders is recorded but never notified, so a spoofed flood cannot become a notification flood.

The new event IDs go in `events.ts` (additive), followed by `yarn generate`. The existing event payloads are unchanged. `confirmation_queued` and `resolved` have no in-app consumer. They mirror the baseline lifecycle events `proposal_queued` / `proposal_delivered` so the full lifecycle is observable (and workflow-triggerable) without a later contract change.

## Security, Privacy, and Compliance

- **Authorization:** the existing features only; no role-name checks. Poll-now requires `…manage` and org = mailbox org.
  - **Accepted exception (Q10):** the app poll-now route deliberately widens the installed route's gate. The installed gate is "channel owner or `communication_channels.admin`"; ours is "any `supplier_demo.supply_cases.manage` holder, for the one configured Supplier mailbox only". It can only trigger a fetch, never read or send mail. It still runs the mutation guard.
- **Tenant isolation:**
  - Every hub read is filtered by the payload `tenantId`/`organizationId` plus `channelId` = the Supplier mailbox.
  - Case lookup is scoped.
  - The detail route returns 404 across organizations.
  - Scope is never taken from mail content.
- **Inbound validation (ordered; first failure wins; all recorded):**
  - **V1** channel = Supplier mailbox (else ignored, not recorded);
  - **V2** transport sender allowlisted (`untrusted_sender`);
  - **V3** sender = case partner (`sender_not_case_partner`);
  - **V4** foreign block count = 1 (`no_envelope` / `ambiguous_envelope`);
  - **V5** JSON + Zod schema (`schema_invalid`);
  - **V6** type ∈ {ACCEPTANCE, COUNTER_PROPOSAL, REJECTION} (`unsupported_type`);
  - **V7** envelope `sender` = transport sender and envelope `recipient` = our mailbox address (`envelope_address_mismatch`);
  - **V8** envelope `correlationId` = the case's (`correlation_mismatch`, for cases found by thread or subject);
  - **V9** `sku` = case SKU (`sku_mismatch`);
  - **V10** `messageId` not already used by a **valid** row of this tenant/org (duplicate → count only; invalid rows never reserve ids);
  - **V11** `inReplyToMessageId` = the latest outbound proposal id (`stale_reference`);
  - **V12** case not `resolved` (`case_closed`);
  - **V13** case awaiting reply (`case_not_awaiting_reply`);
  - **V14** → `valid`.
- **Prompt-injection rule:** only the parsed, schema-valid machine block is read; the human text is stored for display and never interpreted.
- **Sensitive data:** the inbound body excerpt and addresses are encrypted at rest and decrypted only in scoped reads; `validation_reason` never contains body text. The UI renders text escaped. The confirmation carries only SKU, quantities, dates and the order number.
- **Abuse and failure modes:**
  - Spoofed From: mitigated by V3 + V7 + V8 + V11 + F1–F5, and the case is never moved by invalid mail. Residual risk: an attacker who knows the correlation id and the proposal `messageId` and spoofs the partner address can submit an acceptance; they can only accept what we proposed (F2/F3). Accepted for the demo; documented.
  - Replay: V10 + V11 + V12.
  - Oversized mail: hub truncation at 50 000 chars, plus our 16 KB per block and 10 blocks per mail.
  - Poll-now spam: 10 s UI cooldown; the hub worker dedupes per channel.
  - Simulator `--inject`: refused in production and without `SUPPLIER_DEMO_ALLOW_REPLY_INJECTION=true`. It never bypasses our validation.

## Integration Coverage

Mock-only unit tests hid real bugs in Phases 1–4. So every phase ships (a) pure unit tests, (b) `__integration__` specs, and (c) a **real-path `demo:selftest` scenario**. That scenario runs the commands through `commandBus` against the seeded, encrypted fixture on the local database, injecting inbound mail with the installed hub ingest command. It then asserts, and ends with `demo:reset`.

`yarn test:integration:ephemeral` is currently blocked by the pre-existing `agent_examples` typecheck errors. Until that is fixed, (c) plus the manual gate are the phase evidence, and (b) must at least compile and be listed.

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-101 | unit | pure | `envelope-parse` on: plain block; `>`-quoted block; CRLF; HTML-escaped; own proposal quoted + foreign acceptance; 2 foreign blocks; oversize; none | exactly the foreign block; `ambiguous_envelope`; `schema_invalid`; `no_envelope` | REQ-103 |
| TEST-102 | unit | pure | `inbound-validation` V2–V14, one case each | the expected status; order of precedence | REQ-103 |
| TEST-103 | unit | pure | `feasibility`: 400/100 accept 400 + cancel 100@Fri; 300/200 accept 300 + cancel 200@Fri; F1–F5 violations incl. a cancellation on a date not proposed, a duplicate date, and accepted + cancelled ≠ proposed on one date while the totals balance; freed capacity | accepted/cancelled/freed; `acceptance_infeasible_F<n>` | REQ-104 |
| TEST-104 | unit | pure | `timeline.build` for Level 3 (no replan), Level 4, needs_human, send_failed, resolved | step states/keys; replan/policy `skipped` in Level 3 | REQ-107 |
| TEST-105 | unit | pure | `composeSupplyProposal` snapshot + `composeCommitmentConfirmation` | PROPOSAL output byte-identical to the baseline; confirmation subject/body/envelope shape | REQ-105 |
| TEST-106 | selftest + integration | reset; case `proposal_delivered`; inject a valid acceptance | receive → apply → send (test adapter or real) → `.sent` | 1 inbound `valid`; case `resolved`; accepted `[400]`, cancelled `[100]`; slot allocation SO-441 +100 on the original date; confirmation `parentMessageId`/`inReplyTo` set | REQ-104, 105 |
| TEST-107a | selftest + integration (Phase 2) | case `proposal_delivered` | inject the same acceptance 2×; replay `message.received` 2× | 1 inbound row, `duplicate_count = 1`; case unchanged | REQ-102 |
| TEST-107b | selftest + integration (Phase 3) | as TEST-106 | replay `message.received`, `reply_received` and `commitment_updated` 2× each | 1 applied acceptance; 1 confirmation; 1 hub outbound | REQ-105 |
| TEST-117 | selftest + security (Phase 2) | case `proposal_delivered` | inject a `schema_invalid` mail carrying envelope id X from the partner, then a valid acceptance with id X; inject 21 untrusted mails | invalid row `business_message_id = INB-…`, `envelope_message_id = X`; the valid row is recorded with `business_message_id = X`; `body_excerpt` is ciphertext at rest; the untrusted rows have no excerpt and stop at the 20-row cap | REQ-102, 103 |
| TEST-108 | security | non-allowlisted sender; allowlisted non-partner; stale `inReplyToMessageId`; second tenant with the same correlation id | inject each | statuses `untrusted_sender` / `sender_not_case_partner` / `stale_reference`; case unchanged; notifications only for partner mail; tenant B has no record and cannot read the case (404) | REQ-103 |
| TEST-109a | selftest + integration (Phase 2) | inject counter, rejection, malformed, no block; `reopen` with a stale then a fresh version | — | `needs_human` + reason + notification for counter/rejection; malformed recorded, case waiting; reopen 409 then `proposal_delivered` | REQ-106 |
| TEST-109b | selftest + integration (Phase 3) | a resolved case | inject a reply after `resolved` | `case_closed`, no notification, no send | REQ-106 |
| TEST-110 | integration | mailbox disconnected at confirmation send | apply; retry with a stale then a fresh version | `send_failed`; 409; then `resolved`; exactly 1 confirmation hub message | REQ-105 |
| TEST-111 | integration | infeasible acceptance (accept 450; wrong date); reply toggle off | inject | `needs_human` `acceptance_infeasible_F2` / `auto_reply_disabled_apply` (and `auto_reply_disabled_send` when the toggle is flipped after apply); no confirmation; slots unchanged; after toggling on, `reopen` completes the loop | REQ-104, 106 |
| TEST-112 | integration | apply succeeded, confirmation `pending` vs `queued_in_hub` | undo `apply_acceptance` | restored fields and slots, case `needs_human`/`acceptance_undone`, confirmation soft-deleted / 409 `confirmation_already_sent` | REQ-104, 106 |
| TEST-113 | API | users with view only, manage, other org; mailbox connected / disconnected / not configured | `GET` detail; `POST` poll-now | 200/403/404; 202 enqueues exactly one `poll-channel` job; 409 codes; 503 | REQ-101, 107 |
| TEST-114 | UI | cases in every new status incl. needs_human, send_failed, resolved | console light/dark, narrow width, keyboard only | stepper/timeline/tabs render; Retry only in `send_failed`; Reopen only in `needs_human` (with the confirm dialog); Poll cooldown; live refetch updates the status; `aria-live` announces | REQ-107 |
| TEST-115 | selftest | fresh + existing tenant | `demo:reset` ×2; `demo:preflight` | scheduler active; poll-tick schedule present; channel interval ≤ 15; reply toggle; `body_excerpt` map; preflight fails with remediation on each broken item | REQ-101, 108 |
| TEST-116 | unit + CLI | live case | `mail:simulate-reply` for each `--type` (print) | printed envelope parses to exactly the addendum shape, bound to the latest proposal id and the current dates | REQ-108 |

## Implementation Phases

### Delivery mode: continuous (owner decision, 2026-09-19)

This spec is implemented **in one continuous run, Phase 1 → 4, without stopping for manual checks between phases.** This deliberately overrides, for this spec only, the default "stop after each phase for the manual exit gate" behaviour of `om-implement-spec` and `.ai/guides/spec-delivery.md`.

- **Automated exit gate (blocking).** Every phase ends with a gate the implementing agent runs itself: the validation commands, the unit tests and the `demo:selftest` scenarios. The next phase starts as soon as that gate is green. Phases remain strictly sequential: never start Phase N+1 while Phase N's automated gate is red.
- **Manual acceptance (non-blocking).** Every check that needs a human, the real OVH mailbox, a browser, or a credential goes into the **Final Manual Acceptance Run** (MA-1…MA-12, after Phase 4). The owner runs it once, after all four phases. A failed MA item is fixed as a normal bug fix on the finished code; it does not reopen a phase.
- **Human-only runbook steps never block.** The poll-interval reconnect, the env values and the scheduler process are human steps. `demo:preflight` reports them as **WARN** with remediation, not FAIL, and the agent continues.
- **Migrations.** The owner pre-approves applying exactly two migrations after the agent reviews the SQL: the `scheduler` shipped migrations (Phase 1) and the one additive `supplier_demo` migration (Phase 2). The pre-approval holds only if the generated SQL contains **only** the Data Models deltas: new nullable columns, `message_type` dropping NOT NULL, the new index, and the partial unique index on `hub_channel_link_id`. The agent records the SQL summary in the progress log. Any other statement (drop, rename, type change, another module's tables) is a stop-and-ask.
- **The only reasons to stop and ask:**
  1. an automated gate stays red after reasonable fixing;
  2. an installed seam or import differs from this spec;
  3. a migration outside the pre-approved change set;
  4. anything that needs secrets or credentials;
  5. a contract change to the frozen envelope.

Each phase's first step:

- re-verifies the installed imports and paths that phase uses (a mismatch is a stop-and-ask, never a copy);
- maps each new extension surface to its `src/modules/example/**` file (see Requirement Traceability);
- invokes the routed skills.

Routes: `module-data` + `umes` (hub/scheduler seams) + `integration` (mailbox) for Phases 1–3, and `backend-ui` for Phase 4. Load `om-module-scaffold`, `om-data-model-design` (Phase 2 migration), `om-integration-builder` (mailbox inbound) and, for Phase 4, `om-backend-ui-design`.

Known blocker: `yarn typecheck`, `yarn build` and `yarn test:integration:ephemeral` fail on pre-existing `src/modules/agent_examples/**` errors. Automated gates therefore use `npx tsc --noEmit` with **zero `supplier_demo` diagnostics**. The blocker is reported, never fixed as part of this spec.

`demo:selftest` sends real e-mail only to the allowlisted partner address (`SUPPLIER_DEMO_PARTNER_EMAILS`), so it must run against the test mailbox pair. It ends with `demo:reset`.

### Phase 1 — Automatic polling + on-demand poll (transport only)

- **Depends on:** the baseline spec (Phases 1–4 implemented).
- **Outcome:** once the scheduler runs, mail sent to the Supplier mailbox lands in the hub without a click, and an operator can force a fetch through the API.
- **Why this order / value delivered:** automatic polling is platform infrastructure with its own blast radius (it enables `scheduler` app-wide), so it is isolated first. Every later phase depends on it.
- **Deliverables:**
  1. **Verify:** the `@open-mercato/scheduler` specifier; the hub `setup.seedDefaults` signature and its side effects. It also registers the Gmail watch-renewal cron (harmless without Gmail channels) and seeds the test-seed channel only when `OM_ENABLE_TEST_CHANNEL_SEEDING` is set, which must stay unset. Also verify `getCommunicationChannelsQueue`, `COMMUNICATION_CHANNELS_QUEUES.poll`, `PollChannelJobPayload` and `isHubPolledChannel`.
  2. **`src/modules.ts`:** add `scheduler` before `communication_channels`; apply its shipped migrations under the pre-approval above. `scheduler` is **not** added to `supplier_demo` `requires`.
  3. **`demo:reset`** ensures the hub poll tick for the demo scope by re-invoking the installed hub `seedDefaults`. **`demo:preflight`** adds these checks:
     - FAIL: scheduler not enabled; poll-tick schedule row missing or disabled;
     - WARN with remediation: channel `pollIntervalSeconds > 15`, env knobs unset, scheduler process not detected.
  4. **`lib/mailbox-poll.ts` `requestMailboxPoll()`:** the installed pre-checks plus the hub poll-job enqueue. It is used by `POST /api/supplier_demo/mailbox/poll-now` (metadata, openApi, mutation guard; API only — the button ships in Phase 4) and by the selftest.
  5. **`demo:selftest --scenario mailbox-poll`.**
  6. **Runbook appendix** (below; human, non-blocking).
- **Independent slices / estimated commits:** (a) activation + migrations; (b) reset/preflight ensure; (c) poll lib + route + selftest. About 3 commits.
- **Requirements closed:** REQ-101 (code); its behaviour is proven by MA-1 and MA-2.
- **Tests:** TEST-113 (poll-now part, unit-level pre-check matrix), TEST-115 (scheduler/interval part).
- **Automated exit gate (blocking):**
  1. `yarn generate && yarn lint && yarn test && npx tsc --noEmit` (zero `supplier_demo` diagnostics).
  2. `demo:reset` ×2 is idempotent (one poll-tick schedule row).
  3. `demo:preflight` has no FAIL; WARNs are allowed.
  4. `demo:selftest --scenario mailbox-poll` enqueues exactly one hub `poll-channel` job for the configured channel, and the pre-check unit tests cover connected / error / disconnected / requires_reauth / disabled / push-driven / not configured.
- **Manual acceptance (deferred):** MA-1, MA-2.

**Runbook (one-time, per environment; human; does not block the agent):**

1. The mailbox owner reconnects the Supplier channel through `POST /api/communication_channels/channels/connect/credentials` with `pollIntervalSeconds: 15`, from an authenticated client. The credentials are re-entered by the owner and are never stored outside the hub.
2. Set `SCHEDULER_POLL_INTERVAL_MS=5000` and `OM_HUB_POLL_SCHEDULER_TICK_SECONDS=10`.
3. Make sure the scheduler runs: auto-spawned in dev, or `yarn mercato scheduler start`.

### Phase 2 — Inbound receive / validate / record / classify + simulator (acceptances recorded, not applied)

- **Depends on:** the Phase 1 automated exit gate.
- **Outcome:** every reply to a live case is recorded exactly once with its validation status.
  - Counter-proposals and rejections move the case to `needs_human` (plus a notification), and an operator can `reopen` it.
  - Invalid, untrusted, duplicate and late mail is recorded without effect.
  - A **valid acceptance is recorded only: the case stays waiting.** Nothing consumes acceptances yet, so nothing can be stranded.
  - The simulator produces every scenario.
- **Why this order / value delivered:** the safety rules (roadmap §9) are proven before any automated mutation exists.
- **Deliverables:**
  1. **Verify:** the ingest command id and `normalizedInboundMessageSchema`; which field carries the IMAP sender (`ExternalMessage.senderIdentifier` vs `channelPayload.from`).
  2. **One additive migration** for every delta in Data Models (under the pre-approval above), the entity/TS union widening, and `encryption.ts` `body_excerpt`.
  3. **Libraries:** `lib/hub-inbound.ts`, `lib/envelope-parse.ts`, `lib/inbound-validation.ts`; `lib/envelope.ts` as a discriminated union with a pinned PROPOSAL snapshot.
  4. **Command and subscriber:** `receive_inbound` + subscriber `inbound-supply-reply`, with the dedupe/squatting rule, the storage bound, the `needs_human` transitions for counter/rejection and the attention reasons.
  5. **Reopen:** command `reopen` + `POST …/supply-cases/{id}/reopen`.
  6. **Toggle:** `supplier_demo_auto_supply_reply` (ensured idempotently from `seedDefaults`, `seedExamples` and `demo:reset`).
  7. **CLIs:**
     - `demo:reset` soft-deletes inbound rows with their cases and ensures the toggle and the encryption maps.
     - `demo:preflight` checks the reply toggle and the field-level `body_excerpt` map.
     - `demo:case --correlation SC-…` prints the case, its commitments and its messages with validation statuses.
     - `mail:simulate-reply --type acceptance|counter|rejection|malformed|wrong-sender|stale [--accept N] [--inject]`.
     - `demo:selftest --scenario inbound-*` (inject via the installed hub ingest command).
- **Independent slices / estimated commits:** (a) migration + toggle + reset/preflight; (b) pure libs + unit tests; (c) command + subscriber + reopen + simulator + selftest, after (a) and (b). About 5 commits.
- **Requirements closed:** REQ-102, REQ-103, REQ-106 (counter/rejection + reopen); REQ-108 (partial).
- **Tests:** TEST-101, 102, 107a, 108, 109a, 115 (encryption/toggle part), 116, 117.
- **Automated exit gate (blocking):**
  1. `yarn generate && yarn lint && yarn test && npx tsc --noEmit` (zero `supplier_demo` diagnostics).
  2. `demo:preflight` has no FAIL.
  3. `demo:selftest --scenario inbound-all` passes. It covers:
     - a valid acceptance recorded once with the case unchanged;
     - replay/duplicate (`duplicate_count`);
     - squatting (invalid id X, then valid id X);
     - counter → `needs_human` → `reopen` (stale 409, then `proposal_delivered`);
     - rejection;
     - untrusted (no excerpt, 20-row cap);
     - stale reference;
     - `body_excerpt` ciphertext at rest;
     - a second-tenant read → nothing.
  4. `mail:simulate-reply` output for every `--type` is classified by our own validator with the intended status (TEST-116).
- **Manual acceptance (deferred):** MA-3, MA-4.

### Phase 3 — Acceptance → feasibility → commitment update → threaded confirmation → resolved (Level 3)

- **Depends on:** the Phase 2 automated exit gate.
- **Outcome:** the Supplier half of Level 3 is closed end to end.
- **Why this order / value delivered:** this is the mandatory Level 3 Definition of Done; the Manufacturer can reach `RESOLVED`.
- **Deliverables:**
  1. `receive_inbound` now moves a case with a valid acceptance to `reply_received` and emits the event; `lib/feasibility.ts` + unit tests.
  2. `apply_acceptance` (undoable, slot rows locked, command-log slot snapshot, ids assigned in code, undo → `needs_human`/`acceptance_undone`) + subscriber `apply-acceptance`.
  3. Generalise `supply_message.send`, `track_delivery` and `retry` by `messageType`: type→status map; monotonic proposal tracking; latest non-delivered outbound message for retry; `reply_received` re-emit; thread arguments for CONFIRMATION; toggle-off → `needs_human`. Proposal behaviour must not change (baseline tests re-run).
  4. `lib/compose.ts` `composeCommitmentConfirmation`.
  5. Subscriber `send-confirmation-email`; events `reply_received` (consumed), `commitment_updated`, `confirmation_queued`, `resolved`; the list shows the new statuses and "accepted/cancelled" in the Proposed column; en/pl translations for every new status and reason.
  6. `demo:reset` clears acceptance data and removes SO-441 allocations appended by `apply_acceptance` (restoring the seeded slot allocations).
  7. `demo:selftest --scenario loop-*`.
- **Independent slices / estimated commits:** (a) feasibility + compose (pure); (b) the send/track/retry generalisation with baseline regression; (c) apply command + subscribers + selftest, after (a) and (b). About 4 commits.
- **Requirements closed:** REQ-104, REQ-105, REQ-106 (late/duplicate after resolve; toggle/undo reopen paths).
- **Tests:** TEST-103, 105, 106, 107b, 109b, 110, 111, 112; re-run the baseline TEST-003, 004, 006, 008, 012 command paths.
- **Automated exit gate (blocking):**
  1. `yarn generate && yarn lint && yarn test && npx tsc --noEmit` (zero `supplier_demo` diagnostics), including the pinned PROPOSAL snapshot and the baseline unit tests.
  2. `demo:selftest --scenario loop-all` passes. It runs the commands in sequence: inject the acceptance, then receive, apply, send, and finally `track_delivery` with the hub `.sent` payload of the queued confirmation. It asserts:
     - `resolved`, accepted `[400]`, cancelled `[100@Fri]`, freed `[100@Fri]`, SO-441 +100 in the original-date slot;
     - the confirmation's hub link has `inReplyTo`/`references`, and the message has `parentMessageId` = the inbound hub message;
     - replays give exactly one confirmation;
     - the Level 3 variant (accept 300 of 300/200) resolves;
     - infeasible F2/F3 → `needs_human`;
     - toggle off → `auto_reply_disabled_apply`, and after `reopen` the case resolves;
     - undo while `pending` restores the slots, and undo after `queued_in_hub` → 409.
- **Manual acceptance (deferred):** MA-5 … MA-8.

### Phase 4 — Supplier console (case detail, timeline, e-mail previews, poll now, reopen)

- **Depends on:** the Phase 3 automated exit gate.
- **Outcome:** the stage-ready Supplier Agent Console (roadmap §5, S18/S31/S35).
- **Why this order / value delivered:** it visualises a loop that already works; if it slips, the list plus `demo:case` still demonstrate Level 3.
- **Deliverables:**
  1. `lib/timeline.ts` + unit tests.
  2. `GET /api/supplier_demo/supply-cases/{id}` (read logic in a lib function, unit-tested).
  3. The page `backend/supplier-demo/supply-cases/[id]/page.tsx` + `page.meta.ts` (`navHidden`, breadcrumb to the list) and client components `SupplyCaseConsole.tsx`, `SupplyCaseTimeline.tsx`, `SupplyMessagePreview.tsx`, with the Poll, Retry and Reopen buttons.
  4. The list row action **Open** + case-number link.
  5. The notification href → console.
  6. i18n `console.*`, `timeline.*`, `validation.*`, `mailbox.poll.*` (en + pl, identical key sets).
- **Independent slices / estimated commits:** (a) timeline lib + detail API; (b) page + components + list link + notification href, after (a). About 3 commits.
- **Requirements closed:** REQ-107, REQ-108 (complete).
- **Tests:** TEST-104, 113 (detail part), 114 (spec file written; executed in MA or when the harness is unblocked).
- **Automated exit gate (blocking — last gate of the run):**
  1. `yarn generate && yarn lint && yarn ds:check && yarn test && npx tsc --noEmit` (zero `supplier_demo` diagnostics).
  2. The unit tests for `timeline.build` and the detail read cover Level 3 vs Level 4, `needs_human`, `send_failed` and `resolved`; view-only → 403 on poll/retry/reopen and 404 across organizations.
  3. The en/pl i18n key sets are identical.
  4. `demo:selftest --scenario all` passes.
- **Manual acceptance (deferred):** MA-9 … MA-12.

### Final Manual Acceptance Run (owner, once, after Phase 4)

Preconditions: complete the runbook (interval 15, env, scheduler running); `demo:reset` → `demo:preflight` with no FAIL or WARN; the test mailbox pair, or the Manufacturer OM once Q-015 is frozen.

| ID | Check (real OVH mailbox / browser) | Proves |
|---|---|---|
| MA-1 | 3/3: a mail from the Manufacturer webmail to the Supplier mailbox appears in the hub within ≤ 30 s with no click | AC-101 |
| MA-2 | With the scheduler stopped, `POST /mailbox/poll-now` (or the console button) fetches it within ≤ 15 s; with the channel disconnected → 409 | AC-101 |
| MA-3 | 3/3: reply to a live proposal with the `mail:simulate-reply` acceptance; `demo:case` shows one `valid` inbound row within ≤ 30 s | AC-102, AC-103 |
| MA-4 | A counter-proposal reply → `needs_human` + notification, then `reopen` works; a reply from a non-allowlisted address → `untrusted_sender`, case unchanged | AC-103, AC-106 |
| MA-5 | **3/3 Level 3 loop:** the confirmation arrives in the Manufacturer inbox in the same thread ≤ 60 s after the acceptance is sent, with exactly one confirmation per run; `resolved`, 400 accepted, 100 Fri cancelled | AC-104, AC-105 |
| MA-6 | Re-sending the same acceptance → no second confirmation | AC-105, AC-106 |
| MA-7 | Level 3 fixture (accept 300 of 300/200) resolves | AC-104 |
| MA-8 | Reply toggle off → `needs_human`/`auto_reply_disabled_apply`; toggle on + `reopen` → resolved | AC-104, AC-106 |
| MA-9 | 3/3 J-101 stage run in the console: every timeline step appears live; the e-mail previews show the proposal, the acceptance (✓ valid) and the confirmation with envelopes | AC-107 |
| MA-10 | J-102 badges/alerts and Reopen; J-103 Retry from the console | AC-106, AC-107 |
| MA-11 | Console keyboard-only, light and dark mode, 375 px width | AC-107 |
| MA-12 | A view-only user: no Poll/Retry/Reopen buttons; API 403 | AC-107 |

A failing MA item is filed and fixed as a bug on the finished implementation (`direct` route) and re-checked individually.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-101 | J-101 steps 1, 3; console | `scheduler`, hub poll tick, `POST /mailbox/poll-now` | 1 (button: 4) | TEST-113, 115 | AC-101 |
| REQ-102 | J-101 step 4, J-102 | `receive_inbound`, `SupplyMessage` inbound fields | 2 | TEST-107a, 117 | AC-102 |
| REQ-103 | J-102 | V1–V14, `envelope-parse`, addendum schemas | 2 | TEST-101, 102, 108 | AC-103 |
| REQ-104 | J-101 step 4 | `apply_acceptance`, `feasibility` F1–F5, slot lock/snapshot/undo | 3 | TEST-103, 106, 111, 112 | AC-104 |
| REQ-105 | J-101 step 5, J-103 | generalised send/track/retry, `composeCommitmentConfirmation`, `confirmation_queued`, `resolved` | 3 | TEST-105, 106, 107b, 110 | AC-105 |
| REQ-106 | J-102 | `needs_human`, `reopen`, `attention_required` reasons, `case_closed` | 2 (counter/rejection, reopen), 3 (late/duplicate after resolve, toggle/undo) | TEST-109a, 109b, 111, 112 | AC-106 |
| REQ-107 | J-101 step 4, console, list | `GET /supply-cases/{id}`, `lib/timeline.ts`, page | 4 | TEST-104, 113, 114 | AC-107 |
| REQ-108 | J-104 | `demo:reset/preflight/case/selftest`, `mail:simulate-reply` | 1–2 (+3, 4 scenarios) | TEST-115, 116 | AC-108 |

**Extension surfaces** (one row each; the reference file is adapted, never copied wholesale; all classified `emitted-example`, except the scheduler activation, which is `framework-only`, an app-level module setting):

| Surface | Reference file (`src/modules/example/**`) | Phase | Own test |
|---|---|---|---|
| `scheduler` module activation + poll-tick ensure | — (`framework-only`; `src/modules.ts`) | 1 | TEST-115 |
| Custom guarded route poll-now + OpenAPI | `api/organizations/route.ts`, `api/openapi.ts` | 1 | TEST-113 |
| Persistent subscriber on `communication_channels.message.received` | `subscribers/example-event.ts` | 2 | TEST-107a |
| Additive migration + encryption map field | `migrations/Migration20260226161000_example.ts`, `encryption.ts` | 2 | TEST-117 (ciphertext at rest), TEST-115 |
| Custom guarded route reopen | `api/organizations/route.ts` | 2 | TEST-109a |
| Feature toggle `supplier_demo_auto_supply_reply` | `setup.ts` | 2 | TEST-111, 115 |
| New app events in `events.ts` | `events.ts` | 3 | TEST-107b |
| Persistent subscribers on app events `reply_received`, `commitment_updated` | `subscribers/example-event.ts` | 3 | TEST-106, 107b |
| Undoable command with a slot snapshot | `commands/todos.ts` | 3 | TEST-112 |
| Custom guarded detail route | `api/organizations/route.ts` | 4 | TEST-113 |
| Backend detail page shell + meta | `backend/todos/page.tsx`, `backend/todos/page.meta.ts` | 4 | TEST-114 |
| Notification href change (existing type) | `notifications.ts` | 4 | TEST-114 |
| CLI commands | `cli.ts` | 1–3 | TEST-115, 116 |

## Rollout, Migration, and Rollback

- **Order:**
  1. Phase 1: `scheduler` activation (shipped migrations, approval).
  2. Restart dev (scheduler process).
  3. Runbook: channel interval 15.
  4. `demo:reset` → `demo:preflight`.
  5. Phase 2: app migration (approval), then `demo:reset`.
  6. Phases 3–4 need no further DDL.
- **Env (new):** `SCHEDULER_POLL_INTERVAL_MS=5000`, `OM_HUB_POLL_SCHEDULER_TICK_SECONDS=10`, `SUPPLIER_DEMO_ALLOW_REPLY_INJECTION` (dev only, default unset). No secrets.
- **Kill switches:** `supplier_demo_auto_supply_reply` off stops apply and confirmation (recording continues); the baseline `supplier_demo_auto_supply_proposal` is unchanged.
- **Rollback:**
  - Toggle off, then remove the three new subscribers. Recorded rows are inert.
  - Deactivating `scheduler` stops automatic polling only; poll-now (Phase 1) still works, because `scheduler` is not in `requires`.
  - An applied acceptance is undone through the command undo while the confirmation is still `pending`.
  - Shipped migrations are never edited; the app migration is additive.
- **Observability:** structured logs carry `correlationId`, `businessMessageId`, `channelLinkId` and `validationStatus` at every step. `demo:case` is the operator-side inspector; the console timeline is the stage view.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| The scheduler process is not running (dev auto-spawn off, or `QUEUE_STRATEGY` mismatch) | No automatic inbound | Preflight checks the module, schedule row and env; the console Poll button; runbook | Low (Poll covers it) |
| The channel interval stays at 300 s because the connect widget hard-codes it | Reply latency up to 5 min | Runbook reconnect with 15; preflight fails with remediation; Poll now | Low |
| The Manufacturer's mail client quotes, re-wraps or HTML-mangles the block (smart quotes, NBSP, `>` prefixes) | `schema_invalid` → no confirmation | The parser strips quote markers and normalises whitespace; the Manufacturer OM sends a `text/plain` body (human text + envelope block, not HTML); rehearse with the real Manufacturer mailbox; notification to the operator | Medium until the joint rehearsal |
| Our quoted proposal block is mistaken for their reply | Wrong type / ambiguity | Foreign-block filter (own ids + own types) | Very low |
| Spoofed partner From (no DKIM in the hub) | Unauthorized acceptance | V3, V7, V8, V11, F2, F3; can only accept what we offered | Accepted for the demo |
| Fast reply before hub `.sent` for the proposal | Status regression | `proposal_queued` counts as awaiting reply; monotonic tracking | Very low |
| Confirmation send crash between the hub call and our commit | Duplicate or missing confirmation | Baseline `sending` marker + link lookup on retry | Very low |
| The Manufacturer contract (Q2/Q3) is not acknowledged | Joint E2E fails validation | Addendum published in this spec; the simulator emits exactly it; a joint freeze is required before the joint rehearsal (tracked below) | Medium, external |
| Importing installed hub internals (queue helper, setup, entities) that change in an upgrade | Build break | Pinned 0.8.0; Phase 1/2 first-step verification; imports isolated in `lib/hub-inbound.ts` and the poll route | Low |
| The IMAP poll reads a mail before the hub has committed the link (race) | Missing rows | Persistent subscriber retry; the loader logs and returns and never records partial state | Very low |
| Integration harness still blocked | Weaker automated evidence | Real-path `demo:selftest` as the blocking automated gates + the Final Manual Acceptance Run on real OVH | Accepted |
| Cancelled quantity is not reflected in the sales order or WMS (Q5) | Supplier data inconsistency after resolve | Explicit timeline note; out of scope by decision | Accepted |

## Acceptance Criteria

- [ ] **AC-101** — With `demo:preflight` green, a reply sent to the Supplier mailbox is ingested with no operator action within ≤ 30 s. **Poll mailbox now** (manage only) enqueues exactly one hub poll and fetches it within ≤ 15 s. Poll on a disconnected mailbox returns a localized 409.
- [ ] **AC-102** — Each correlated inbound mail produces exactly one `SupplyMessage(direction=inbound)` with a validation status, even after event replays. `body_excerpt` and addresses are ciphertext at rest. Uncorrelated mail produces no row. An invalid mail can never reserve the envelope id of a later valid acceptance. Untrusted mail stores no excerpt and is capped at 20 rows per case.
- [ ] **AC-103** — Every V2–V13 failure is recorded with its status and leaves the case status, commitments and slots unchanged. Only partner-origin failures notify. No free-text-only mail ever triggers a mutation. A second tenant never sees or affects the case.
- [ ] **AC-104** — A valid acceptance (400 of 400/100) sets accepted `[400@Wed]`, cancelled `[100@Fri]`, freed `[100@Fri]` and books SO-441 +100 in the original-date slot, in one undoable command. An infeasible acceptance (F1–F5) or the toggle off yields `needs_human` with the specific reason and no confirmation. Undo before the confirmation leaves restores the slots and yields `needs_human`/`acceptance_undone`.
- [ ] **AC-105** — Exactly one `SUPPLY_COMMITMENT_CONFIRMED` with the addendum shape arrives in the Manufacturer inbox, in the proposal's thread, ≤ 60 s after the acceptance was sent, 3/3 on real OVH. The case ends `resolved`. A delivery failure is recoverable by Retry (409 on a stale version) with no duplicate.
- [ ] **AC-106** — A counter-proposal or rejection gives `needs_human` plus a notification, with nothing sent. A reply after `resolved` is recorded as `case_closed` with no notification and no send. A duplicate acceptance increments `duplicate_count` only. `reopen` (manage, current version) returns a `needs_human` case to its rule-defined state; a stale version returns 409.
- [ ] **AC-107** — The console shows all 11 timeline steps (replan/policy marked skipped in Level 3), the four commitment cards, and previews of every e-mail with parsed envelopes. It updates live, works keyboard-only, in light/dark and at 375 px, and hides Poll/Retry/Reopen without `manage`.
- [ ] **AC-108** — `demo:reset` ×2 then `demo:preflight` pass on an existing tenant (scheduler tick, interval, toggle, `body_excerpt` map). `mail:simulate-reply` prints an envelope accepted by our own validator for every positive type and rejected with the intended status for every negative type. `demo:selftest --scenario all` passes.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes. Exception while the harness is blocked: the `demo:selftest` real-path scenarios (automated gates) plus the Final Manual Acceptance Run stand in for execution.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `supplier-app/AGENTS.md`; `.ai/guides/spec-delivery.md`, `backend-ui.md`, `upstream/BACKWARD_COMPATIBILITY.md` (events/routes/schema additive); `.ai/lessons.md` (no matching records); `SPEC-000-template.md`; baseline spec incl. Changelog; hub sources (`ingest-inbound-message.ts`, `thread-matcher.ts`, `send-as-user.ts`, `poll-now/route.ts`, `setup.ts`, `test-seed/route.ts`); scheduler `cli.ts`/services |
| Data models, APIs, events, UI, and tests are internally consistent | pass | One state-machine delta; V1–V14 and F1–F5 referenced identically in the rules, contracts and tests; traceability table |
| Every workflow completes end to end without a catch-all integration phase | pass | Phase 1 polling transport, Phase 2 inbound record/classify, Phase 3 Level 3 loop, Phase 4 console — each with a blocking automated gate; real-mailbox/browser checks consolidated in the Final Manual Acceptance Run (MA-1…MA-12) |
| Platform-native reuse and extension points were chosen before custom code | pass | Installed scheduler, hub ingest/queue/send facade, events, feature toggles, notifications; no installed file edited; the no-DataTable exception is justified |
| UI contracts identify references, canonical components, and theme/state coverage | pass | Console + list delta with a reference page, primitives, states, a11y, i18n and tokens |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | See Implementation Phases |

Verdict: `Ready for implementation`. The document status changes once the user approves (spec-delivery gate 7).

## Implementation Status

Source doc: .ai/specs/2026-09-19-supplier-reply-commitment-confirmation.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Automated exit gate (blocking) |
|---|---|---|---|---|---|
| Phase 1 — Automatic polling + on-demand poll | verified | baseline Phase 4 | REQ-101 | `yarn generate && yarn lint && yarn test && npx tsc --noEmit` | Phase 1 automated gate green (preflight no FAIL, `mailbox-poll` selftest); MA-1, MA-2 deferred |
| Phase 2 — Inbound receive / validate / record / classify + simulator | verified | Phase 1 automated gate | REQ-102, REQ-103, REQ-106, REQ-108 | As specified | Phase 2 automated gate green (`inbound-all` selftest); MA-3, MA-4 deferred |
| Phase 3 — Acceptance → commitment update → confirmation | verified | Phase 2 automated gate | REQ-104, REQ-105, REQ-106 | As specified | Phase 3 automated gate green (`loop-all` selftest); MA-5…MA-8 deferred |
| Phase 4 — Supplier Agent Console | verified | Phase 3 automated gate | REQ-107, REQ-108 | As specified | Phase 4 automated gate green (`all` selftest, ds:check); MA-9…MA-12 deferred |

### Phase 1 progress

- [x] activation and shipped migrations: `src/modules.ts` enables `@open-mercato/scheduler` immediately before `communication_channels`; `yarn db:generate` produced no app SQL or snapshot diff, and the three reviewed scheduler migrations were applied with `yarn db:migrate`.
- [x] polling reset/preflight and guarded poll-now route — `yarn mercato supplier_demo demo:reset` passed twice; `yarn mercato supplier_demo demo:preflight` passed with only the allowed interval, scheduler-environment, and scheduler-process WARNs; `yarn mercato supplier_demo demo:selftest --scenario mailbox-poll` passed with exactly one queued poll job; `yarn lint` passed (9 pre-existing warnings), `yarn test --runInBand` passed (5 suites/20 tests), `yarn generate` passed, and `npx tsc --noEmit` reported no `supplier_demo` diagnostics (only the known `agent_examples` diagnostics). MA-1 and MA-2 remain deferred runbook checks.

> Delivery mode is continuous (see Implementation Phases). The remaining Phase 1 items that need a human (reconnecting with `pollIntervalSeconds: 15`, the real-mail check) are now runbook / MA-1 and MA-2 items. `demo:preflight` reports the interval as WARN, and the implementation continues once the automated gate is green.

### Phase 2 progress

- [x] inbound receive, strict envelope parsing/validation, idempotent recording/classification, and the reply simulator: `yarn test --runInBand` passed 6 suites/23 tests; `yarn lint` passed with 9 warnings and no errors; `yarn generate` passed; `yarn mercato supplier_demo demo:preflight` passed with WARN-only runbook items; `yarn mercato supplier_demo demo:selftest --scenario inbound-all` passed the acceptance/duplicate/squatting/counter/rejection/untrusted/stale/ambiguous/malformed matrix; `npx tsc --noEmit` reported no `supplier_demo` diagnostics (only the known `agent_examples` diagnostics).
- [x] migration evidence recorded before Phase 2: `yarn db:migrate` applied no pending migrations. The reviewed SQL set is limited to the pre-approved deltas: scheduler shipped migrations for `scheduled_jobs`/`scheduled_job_runs` and their scheduler indexes/columns; one additive `supplier_demo` migration adding nullable reply/commitment, validation, hub-link, RFC, timing, and body-excerpt columns, changing `message_type` to nullable, adding `duplicate_count` default `0`, and adding only the scoped hub-link partial unique index and case/direction index.

### Phase 3 progress

- [x] acceptance application and confirmation path: valid acceptance transitions to `reply_received`, the acceptance command uses locked production slots, evaluates F1–F5 feasibility, records accepted/cancelled/freed capacity, creates a threaded confirmation, and has an undo snapshot restoring slots and reopening the case.
- [x] Phase 3 automated gate: `yarn generate`, `yarn lint` (9 warnings, no errors), `yarn test --runInBand` (6 suites/23 tests), `yarn mercato supplier_demo demo:preflight`, `yarn mercato supplier_demo demo:selftest --scenario loop-all`, and `npx tsc --noEmit` (zero `supplier_demo` diagnostics; only known `agent_examples` diagnostics) passed.

### Phase 4 progress

- [x] Supplier Agent Console: scoped detail/timeline API, status and accepted/cancelled commitment list deltas, responsive detail page, loading/error/permission-aware action states, localized en/pl strings, and timeline/message previews are implemented.
- [x] Phase 4 automated gate: `yarn generate`, `yarn lint` (9 warnings, no errors), `yarn ds:check` (276 files), `yarn test --runInBand` (7 suites/24 tests), `yarn mercato supplier_demo demo:preflight`, `yarn mercato supplier_demo demo:selftest --scenario all`, and `npx tsc --noEmit` (zero `supplier_demo` diagnostics; only known `agent_examples` diagnostics) passed. en/pl locale parity is 102/102 keys. `yarn db:generate` reported no changes and `yarn db:migrate` reported no pending migrations.


## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Split into two specs? | Supplier owner | — | One spec; console last — 2026-09-19 |
| Q-002 | `SUPPLY_ACCEPTANCE` payload | Both owners | — | Addendum v1 above (Supplier side) — 2026-09-19 |
| Q-003 | `SUPPLY_COMMITMENT_CONFIRMED` payload/subject | Both owners | — | Addendum v1 above — 2026-09-19 |
| Q-004 | `inReplyToMessageId` mandatory | Supplier owner | — | Mandatory; a mismatch is recorded and notified, the case is unchanged — 2026-09-19 |
| Q-005 | Sales order / WMS side effects | Supplier owner | — | None; commitment + slots only — 2026-09-19 |
| Q-006 | Capacity release model | Supplier owner | — | Book accepted production only; freed capacity derived — 2026-09-19 |
| Q-007 | State names | Supplier owner | — | `reply_received`, `commitment_updated`, `confirmation_queued`, `resolved`, `needs_human` — 2026-09-19 |
| Q-008 | Late/duplicate replies | Supplier owner | — | Record only; no notification, no mutation — 2026-09-19 |
| Q-009 | Automatic polling | Supplier owner | — | Activate `scheduler`, interval 15 s; poll-now as accelerator — 2026-09-19 |
| Q-010 | Poll-now implementation | Supplier owner | — | App route enqueuing the hub job, gated by `manage` — 2026-09-19 |
| Q-011 | Reply simulator | Supplier owner | — | Print + `--inject` (refined: via the installed ingest command) — 2026-09-19 |
| Q-012 | Migration | Supplier owner | — | One additive migration on the two existing tables — 2026-09-19 |
| Q-013 | Latency target | Supplier owner | — | ≤ 60 s reply-sent → confirmation-in-inbox, 3/3 — 2026-09-19 |
| Q-014 | Feasibility rule | Supplier owner | — | F1–F5 (subset of the current commitment; totals balance) — 2026-09-19 |
| Q-015 | Manufacturer owner acknowledges addendum v1. The ACCEPTANCE mail carries a human body **plus** a `SupplyEnvelope` block (with `payload.inReplyToMessageId`), in a `text/plain` MIME body; the Manufacturer parses our CONFIRMED envelope | Manufacturer owner | no for Phases 1–3 (simulator); **yes for the joint Level 3 rehearsal** | pending |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Skeleton + Open Questions Q1–Q14 with verified hub research |
| 2026-09-19 | Q1–Q14 resolved per recommendations. Full draft. Refinements: the simulator injects via the installed ingest command; Q4 mismatch means record + notify with the case unchanged; timeline derived from timestamps; phases regrouped (later split into 4 by the review) |
| 2026-09-19 | Independent scope-cohesion review applied. Changes: dedupe only on valid rows, with `envelope_message_id` added (prevents an invalid mail from squatting the id); acceptances are recorded without a state change until their consumer ships, and retry re-emits `reply_received`; poll-now moved to the first phase; scheduler activation split into its own Phase 1 and removed from `requires`; `reopen` command/route added so `needs_human` is not a dead end; the toggle-off at apply/send and undo surface as `needs_human` reasons instead of silent stalls; untrusted mail has no excerpt and a 20-row cap; slot rows locked for F5; the widened poll-now gate is recorded as an accepted exception; the `inbound_recorded` event is dropped; `needs_human` vs `escalated` is defined; tests split per phase (107a/b, 109a/b, new 117). Phases are now 4: polling, inbound, loop, console |
| 2026-09-19 | External review fix: the addendum now states the two-layer rule explicitly (human body + mandatory `SupplyEnvelope` for every contract mail, including ACCEPTANCE; text-only replies → `no_envelope`, no automation), includes a complete acceptance e-mail example, and places `inReplyToMessageId` inside `payload` because the top-level keys are frozen. Q-015 and the risk-table wording no longer say "plain text" in a way that could mean "without the envelope"; it now means the `text/plain` MIME body. |

| 2026-09-19 | Contract change before joint freeze: `cancelledQuantity` (a single number) is replaced by `cancelledCommitments: [{quantity, date}]` in both ACCEPTANCE and COMMITMENT_CONFIRMED. F1–F3 now check each date separately (accepted + cancelled == proposed on every proposed date). The cancelled commitment is taken from the acceptance instead of being derived. The simulator, the example and TEST-103 are updated. |
| 2026-09-19 | Delivery mode changed to **continuous** (owner decision). Each phase now has a blocking **automated** exit gate (validation + `demo:selftest`); every manual check (real OVH mailbox, browser, credentials) moves to one Final Manual Acceptance Run (MA-1…MA-12) after Phase 4. Runbook items are preflight WARN, not FAIL. The two named migrations are pre-approved when the SQL matches the Data Models delta. Added `lib/mailbox-poll.ts` + the `mailbox-poll` selftest. The Implementation Status block was moved out of the Final Compliance Report. |
| 2026-09-19 | Code review of the full implementation (Phases 1–4) with fixes applied. `apply_acceptance` booked the whole accepted quantity into the slot and never checked capacity: it now books only production (accepted minus warehouse-reserved on the original date) under the slot lock, and feasibility reports F1–F5 (`acceptance_infeasible_F<n>`, incl. F4 past dates and F5 capacity). Undo now refuses once the confirmation left (409 `confirmation_already_sent`), resets `applied_at` and finds the case via the snapshot (it could not before). `reopen` targets now follow the spec (partner-driven/infeasible/undone → `proposal_delivered`; held apply/send resume only with the toggle on). `track_delivery` is monotonic (late/replayed hub events no longer regress a case). Inbound: sender allowlist check (V2) added, non-partner mail gets no excerpt and shares the 20-row cap, redelivered hub events no longer count as duplicates, envelope recipient checked against our mailbox, events emitted post-commit. Retry re-drives a stuck `reply_received`. Console rebuilt on `StepIndicator` with the 11 roadmap steps, Poll mailbox now, live refetch, parsed envelopes, translated badges and a reopen confirm dialog; detail page `navHidden`. Selftest matrices now assert expected statuses. Simulator fixed (per-date cancellation, recipient, allowlist preview, `SUPPLIER_DEMO_ALLOW_REPLY_INJECTION=true`, synthetic RFC Message-ID). Poll-now: configuration errors → 503, errors logged, OpenAPI shape fixed; preflight no longer warns unconditionally and fails on test-seed channel seeding. Known gaps: `demo:selftest` is still pure-logic (no database path) and correlation by hub thread is not implemented (subject/correlationId only). |
