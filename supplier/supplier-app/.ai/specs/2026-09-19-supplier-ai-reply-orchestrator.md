# Supplier B — AI Counter-Proposal Orchestrator (Level 5 negotiation)

**Date**: 2026-09-19
**Status**: Revised draft after architectural re-review. Document corrections completed; owner approval, installed-code verification and implementation tests remain pending (spec-delivery gate 7).

> **Baseline.** This spec extends two implemented specs and does not repeat them:
> - `.ai/specs/2026-09-18-supplier-shortfall-supply-proposal.md` (the **proposal spec**): `SupplyCase`, `SupplyMessage`, `SupplierProductionSlot`, the frozen `SUPPLY_PROPOSAL`, send / track / retry, the `sending` marker, the recipient allowlist, `lib/planner.ts` (`replan`) and `lib/policy.ts` (`evaluate`).
> - `.ai/specs/2026-09-19-supplier-reply-commitment-confirmation.md` (the **reply spec**), **including its Changelog**: inbound receive with V1–V14, feasibility F1–F5, `apply_acceptance`, the threaded `SUPPLY_COMMITMENT_CONFIRMED`, `needs_human` + `reopen`, the console and its 11-step timeline, the CLIs, and shared-contract addendum v1.
>
> Everything below is a **delta** on those two specs. The baseline-reported acceptance → confirmation path is not changed.

## Source Authority and Verification Boundary

This revision consolidates the partially applied changes in the supplied draft and addresses architectural review findings **R1-R14** and **L1-L5**. The review supplied by the owner is the evidence for observations about the installed runtime. This editing pass did **not** inspect or execute that runtime, apply migrations, invoke another reviewer agent, or run application tests.

Source precedence for this document:
1. Fixed owner decisions Q-001-Q-011 below, the supplied architectural review, and this revision's explicit resolution rules.
2. `HackON_OpenMercato_Final_Roadmap_Supplier_vs_Manufacturer.md` (final roadmap) and `HackON_OpenMercato_MINIMUM_Level3_Email.md` (minimum).
3. `HackON_OpenMercato_Self-Healing_Supply_Chain_Email_Playbook.md` for historical intent only; its shared Control Tower and team split are superseded.

The two baseline implementation specs named above and their repository source files were **not provided in full** for this revision. Their behaviour is an imported dependency, not newly verified evidence. Phase 1 records the checkout/lockfile revision and checks the seams identified by the reviewer. Do not invent an installed API, override an owner decision silently, or turn a local document check into a runtime PASS.

A dedicated **Roadmap Conformance and Explicit Deviations** section separates business alignment from implementation changes. In particular, the app-owned orchestrator, the changed Level 5 fixture, and the definition of a negotiation turn are not silently presented as identical to the roadmap.

## TLDR

A Manufacturer's valid `SUPPLY_COUNTER_PROPOSAL` today stops the case at `needs_human`. This spec turns that dead end into a bounded negotiation. The design has four layers, and each layer does one thing:

- **Code calculates.** A deterministic evaluator checks the counter (rules C1–C6) and asks the planner whether the requested split can be produced, at what shift, cost and SLA effect. It returns at most three candidate options (the requested split plus up to two alternatives), each with its own Supplier-policy verdict.
- **The LLM recommends.** The installed `ai_assistant` runtime (`runAiAgentObject`, provider OpenRouter, model `meta/muse-spark-1.3-contributor`) receives a pseudonymised structured context: the validated counter, the candidate options and the policy limits. The mail text is never sent. The model returns a typed decision that **names one option or escalates**, plus reason codes and an English rationale. Its output contains **no quantities or dates**, so it cannot invent a plan.
- **Policy authorises.** Auto-send requires G1-G9 on a fresh locked case/counter/slot snapshot. A queued automatic revision is checked again at the actual hub handoff; a disabled toggle produces an explicit held state, never a silent return. A human may approve business risk, but not infeasibility or a stale plan.
- **Humans decide risk.** The operator approves an existing feasible recommendation or rejects the active counter, even when no recommendation exists. Reopen either schedules a new fenced attempt or supersedes the counter and returns to waiting. Every live failure has a terminal reason; crash recovery is bounded after the application and its existing scheduler are available again.

Open Mercato executes and audits: each revision is an undoable command through the existing send machinery. Every claimed attempt has a durable attempt identity and a matching usage reservation before any model call. Effective prompt/model information and the canonical input are audited when available. No transaction is held across the model call. The Manufacturer acceptance/confirmation path remains the baseline dependency, and its regression tests must pass.

Covers the Supplier negotiation delta for final-roadmap sections 12/22/37 and backlog S27-S31; preserves, but does not reimplement or independently verify, the existing S11 initial agent path. See the explicit conformance/deviation matrix.

## Problem Statement

- **Level-5 gap reported by the draft.** The roadmap §12 story is: Supplier proposes 400 Wed / 100 Fri, Manufacturer asks "can you deliver 450 Wed / 50 Fri?", Supplier answers. Today every valid counter sets `needs_human` / `counter_proposal_received` (`commands/inbound.ts`), and nothing in the Supplier OM can evaluate or answer it. `SupplyCase.negotiationTurn` exists and is never used.
- **Planner gap reported by the draft.** `planner.replan()` only maximises the early tranche. Nothing answers "can we produce exactly *this* split, and would the policy approve it?". Without such a tool an agent would have to do the arithmetic itself, which roadmap §37 forbids ("LLM math → deterministic tools").
- **Baseline counter payload reported by the draft.** `SUPPLY_COUNTER_PROPOSAL.payload` is `passthrough()`: only `sku` and `inReplyToMessageId` are checked. So there is no frozen field to negotiate over.
- **The stage needs the "agent" moment** (roadmap §4/§5/§39: "Agents reason and negotiate… Policies govern. Humans authorize risk."). The human boundary must remain visible and safe: an LLM that mutates state, sends mail, or reads attacker-controlled text with authority would break the story and the security model (roadmap §9).
- **Evidence gap reported by the draft.** `demo:selftest` is still pure logic (reply-spec Changelog: "Known gaps: `demo:selftest` is still pure-logic (no database path)"). A negotiation loop that is proven only by pure functions would repeat the bugs found in review. This spec therefore also delivers the real-path harness it needs.

## Overview and Success Measures

- **Primary outcome.** Two runs on the real OVH mailbox, each 3/3:
  1. **Autonomous run.** A within-policy counter (`400 Wed / 60 Thu / 40 Fri`) produces a revised proposal in the Manufacturer inbox, in the same thread, within ≤ 60 s. There is no human click, and the console shows AUTO APPROVED. The Manufacturer's acceptance of that revision ends with the case `resolved`.
  2. **Human-approved run.** An outside-policy counter (`450 Wed / 50 Fri`, which needs a high-priority order moved) shows HUMAN REQUIRED with the recommendation. One **Approve** click sends the revision, and the acceptance ends with the case `resolved`.
- **Leading indicators:**
  - counter recorded → deterministic evaluation persisted ≤ 2 s;
  - one model attempt has a single end-to-end 20 s deadline by default, including its one permitted transport retry; no claim of statistical p95 from only three samples;
  - evaluation → revised proposal queued ≤ 25 s;
  - 0 duplicate revisions on event replay;
  - 0 agent runs for rejections, free-text mail, invalid counters, or with the kill switch off;
  - observed live failures reach `needs_human` within the attempt deadline + 5 s; a process crash follows the separate lease/recovery bound in RCV1-RCV6;
  - `demo:preflight` green, including the key, the model and connectivity;
  - every real-path selftest passes with isolated dummy model credentials, the same toolless runtime seam as production, and an assertion that no provider HTTP call occurred;
- **Baseline reported by the supplied draft.** No counter evaluation/revision flow existed at its recorded checkout; current repository state must be re-verified by the implementer.
- **Design analogy, not a verified product comparison.** A buyer counter followed by a supplier revision is used only as a bounded change-confirmation pattern. No external product capability or benchmark is asserted by this spec.
  - **Adopted:** bounded rounds (max 3); every offer is computed by the Supplier's own planning engine; the negotiating agent picks between system-computed options inside a policy envelope; a full audit trail of every offer and decision.
  - **Rejected:** free-form LLM counter-offers (the model inventing numbers), negotiating over free-text mail, and a separate negotiation portal.
  - **Skipped:** multi-issue negotiation (price, penalties). Only quantity per date is negotiable here.

## Goals

- **REQ-201** - Enable the installed `ai_assistant` adapter. Keep provider/model/limits in validated env configuration. The requested model remains `meta/muse-spark-1.3-contributor` through OpenRouter; availability, structured-output support and live latency are **verification prerequisites**, not assertions from this editing pass. Offline selftests require no real key. Runtime may read secrets; the implementing assistant must never inspect, print, persist or commit their values.
- **REQ-202** - Shared addendum v2: strict counter `{ sku, inReplyToMessageId, requestedCommitments[] }`; revised proposal adds `inReplyToMessageId` and `negotiationTurn` together. The first proposal remains byte-identical. Tightening the counter is a compatibility change that requires the Manufacturer contract gate.
- **REQ-203** - Persist deterministic C1-C6/T1 evaluation with at most three candidate options and their Supplier-policy verdicts. The planner reserves all requested dates before moving other allocations. No raw mail, invalid counter or rejection reaches the model.
- **REQ-204** - One **toolless** object-mode call selects an option id or escalates. Strict output validation O1-O4; confidence is informational. No model-produced executable quantities, dates, commands or mail. Input and effective prompt/model metadata are auditable.
- **REQ-205** - Reliability: claim-time usage reservation, fenced attempts, stale-run recovery, lost-event recovery, working Retry/Reopen and rejection without a recommendation. Replays do not create another logical attempt or revision. An explicitly authorised reopen creates a **new** attempt. Enforce the model deadline and output limit in the provider callback. A disabled switch is observable and never silently strands a pending revision.
- **REQ-206** - Every claimed attempt is persisted with `attemptNo`, `runId`, lease, evaluation identity, configured and resolved provider/model, prompt version, effective system prompt hash, input hash/input, outcome, latency and known/unknown token usage. Reserve one matching usage row at claim, then finalise that same row. Failed or crashed attempts still consume the daily attempt cap.
- **REQ-207** - Human boundary: `manage` approves a matching feasible recommendation under locks and current version, or rejects the **active counter** with or without a recommendation. No quantity editing. A changed execution plan/risk summary invalidates approval. One command creates one revision; undo is refused after handoff or conflicting slot changes.
- **REQ-208** - Console: turn `n / max`, deterministic options, recommendation or explicit absence, inert English rationale, runs, meaningful Approve/Reject/Retry/Reopen actions, held-send reason and per-round timeline. UI codes have matching pl/en translations; no secrets or raw provider errors.
- **REQ-209** - Phase 5 enables bounded autonomous negotiation through G1-G9. Phases 3-4 are a manual precursor, **not completed autonomous Level 5**. The implementation counts revised proposals (default 3); this interpretation and the changed fixture require the joint documentation gates below. Acceptance of a revision uses the baseline confirmation path.
- **REQ-210** - Tooling: real command/DB/ingest selftests, scripted provider callback, simulator bound to the latest proposal, explicit live smoke, and preflight split into offline and live checks. Tests include crash/restart, competing approvals, pending-send toggles, failed-run caps, protected later capacity, and duplicate recommendation events. No completed test is claimed before execution.

## Non-goals

- Anything on the Manufacturer side, Supplier C, and changes to the verified acceptance → confirmation path (F1–F5, `apply_acceptance`, confirmation send).
- The LLM reading mail text, handling `SUPPLY_REJECTION`, interpreting free-text mail, drafting replies, sending e-mail or mutating state. Rejections keep the reply-spec behaviour (`needs_human` / `rejection_received`, no LLM).
- A Supplier-originated `SUPPLY_REJECTION` e-mail, and negotiation of anything but quantity per date (price, penalties, SKU substitution). This preserves the owner decision but leaves the partner waiting at a turn-limit/local rejection; J-203 names the manual coordination requirement.
- Operator editing of quantities or dates (Q9), and a "re-run agent" button (re-runs go through `reopen`).
- Enabling core `workflows` or enterprise `agent_orchestrator` (Q-002). App commands, persisted state, scheduler recovery and subscribers implement this Supplier process. This is an explicit architectural exception to the original native-workflow plan, not native `INVOKE_AGENT` / `WAIT_FOR_SIGNAL` / Caseload reuse.
- Fixing the `agent_examples` typecheck blocker (see Implementation Phases).
- Releasing an allocation moved by an earlier revision when a later revision no longer needs the move (documented simplification; the freed capacity simply stays free).

## Proposed Solution

1. **Activate the installed adapter.** Register `ai_assistant` in `src/modules.ts` and apply only its shipped migrations. Declare `supplier_demo.counter_negotiator` as object-only, read-only, `allowedTools: []`; force `enableTools: false` on every invocation. No `ai-tools.ts` is added. Lazy runtime loading preserves the baseline when the adapter is missing.
2. **Freeze and validate the contract.** Implement the v2 counter schema and revision composer. Simulation can precede joint acknowledgement, but real Manufacturer negotiation may not be enabled before Q-201/Q-204 are resolved; the D1 fixture amendment is recorded in Q-205.
3. **Evaluate deterministically.** Persist the counter and C1-C6/T1 result, candidate plans and policy data. Phase 2 ends at `needs_human/counter_evaluated_manual` with no agent event. Phase 3 replaces that tail with the disabled-switch path or an attempt-specific `counter_evaluated` event.
4. **Claim, call, complete.** Under the claim locks reserve the daily budget and usage row and persist the attempt/lease. Call the real `runAiAgentObject` outside transactions, via the same runner-owned `generateObject` seam in live and stub modes. A single AbortSignal/deadline and an explicit output-token limit reach the SDK. Finalise only the currently claimed attempt; late results never revive a recovered or superseded one.
5. **Persist delivery intent.** Phase 5 stores an auto-eligible recommendation and `dispatch.pending` before emitting `recommendation_ready`. Redelivery, Retry and the existing scheduler recovery sweep reconstruct lost post-commit emissions from durable state.
6. **Dispose under locks.** Lock the case first, read/lock the fresh counter, then lock all relevant slots in deterministic order. Recompute the plan and gates. Persist the verdict and exactly one pending revision atomically. Human rejection works without a recommendation.
7. **Check again at send.** The existing send command rechecks the proposal switch and, for automatic revisions, the negotiation switch immediately before the hub handoff. A block records `needs_human` and a specific held-send reason; Retry uses the same message and source after the block is cleared. Nothing silently bypasses switches.
8. **Expose and test recovery.** Console/API/CLI use the same disposition commands. The existing scheduler runs a scoped recovery sweep; no new workflow engine or separate queue is introduced. Tests kill a worker after claim and lose an event after commit, then prove recovery from persisted state.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| One spec; autonomous negotiation last (Q1) | Owner decision; Phases 3-4 prove a manual precursor, Phase 5 proves autonomous Level 5 | Two specs | No scope split required |
| `ai_assistant` as LLM adapter only (Q2) | Reuse registry, policy/model resolution and object-mode callback; app owns process state and Supplier policy | Native `agent_orchestrator` + `workflows` | Deferred by owner. The supplied review reports disabled modules and integration/typecheck cost; this revision does not independently verify the checkout |
| Orchestration in `supplier_demo` commands + persistent subscribers, not the `workflows` module | The same verified pattern as the reply spec (record → post-commit event → next command); every step is idempotent and retryable | `workflows` `WAIT_FOR_SIGNAL` | Owner decision (Q2); `workflows` is not enabled |
| **The agent chooses an option id; it never outputs quantities or dates** | Makes "the LLM calculates nothing" structural rather than a prompt promise; re-checking is exact; no model-produced quantity field can be executed | The agent outputs a split, which is then validated | A validated-but-invented split is still LLM math, and gives larger injection and drift surfaces |
| **Decline is a recommendation, not an automated refusal (D2)** | A shortage-aware model may advise a person to reject a counter-proposal, while the person retains the decision and no refusal e-mail is sent | Deterministic acceptance or automatic refusal after `decline` | Both would turn an informational model decision into an unauthorised business disposition |
| **Mail text never enters the input** | Removes the raw-mail instruction channel; structured fields are strictly validated and rationale is inert | Redacted free text | Adds no required business information. This reduces risk; it does not prove that all prompt injection is impossible |
| Confidence is informational only (Q5) | Owner decision: policy authorises, not the model's opinion | `confidence ≥ 0.8` gate | Rejected by the owner |
| Gates G8/G9 added on top of the owner's Q5 list | They only **narrow** autonomy: no auto-send of a no-op revision, and no automatic deviation from a buyer request that is itself feasible within policy | Only the Q5 list | Without G9 an agent could auto-offer an alternative the buyer did not ask for while the request itself was acceptable |
| Deterministic fallback recommendation (the requested split only, when feasible) for human approval when the agent failed, was skipped (toggle off) or escalated | Keeps a one-click human path on stage when the LLM is down; it is a human decision on computed data, never an automatic send and never a guess (Q8) | No recommendation, only Reject / Reopen | Would leave the stage without a way forward whenever the LLM is down. **Owner may veto (Q-202)** |
| **Toolless agent (R3/R5)** | All deterministic options are already in input. `allowedTools: []` and `enableTools: false` ensure production and stub use the object callback | Two read-only tools | Redundant context, untested tool path, missing tool-output audit; tool-step configuration is removed |
| Runner-owned object callback (R4) | Pass prepared model/messages/schema with our abort signal, output-token cap and SDK retries disabled; audit the actual resolved prompt/model | Outer race only | Stops waiting but does not cancel the underlying request. Abort support is an execution gate, not assumed |
| Evaluation and agent run are separate commands | The deterministic evaluation commits even if the LLM fails; the LLM call holds no DB transaction or lock | One command | A slow LLM would hold locks; a failure would lose the evaluation |
| One additive jsonb column (Q10) | Counter row holds bounded evaluation/attempt/recommendation/dispatch/verdict data; installed ledger stores one usage reservation per attempt | New run-log table | Not required if the existing ledger supports transactional reservation and same-row finalisation. Unsupported ledger seams require a stop/owner decision, not a fabricated API |
| `current_commitment` now means "the latest commitment we proposed" | F2/F3 already compare an acceptance to `currentCommitment`, so the acceptance of a revision works unchanged | A new `revised_commitment` column | More DDL, and every existing consumer would need to choose between two fields |
| Fixture gains a Saturday slot and a high-priority allocation | Preserve the initial `400/100` +120 PLN plan with Wednesday capacity 450, existing `SO-442`, high-priority `SO-443` 50, unchanged Friday, and a new Saturday capacity-100 slot | Restore roadmap auto `450/50` | D1 makes stock consume the shipment-date slot; `450/50` now requires moving high-priority `SO-443` and is human-only |
| At most one transport retry in one attempt | 429/502/503 only, only within the original deadline; SDK retries disabled | Unbounded or stacked retries | Would defeat attempt/time caps. Reopen is a separately counted attempt |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behaviour |
|---|---|---|---|
| Counter | Valid inbound `SUPPLY_COUNTER_PROPOSAL`; V11 binds it to the latest outbound proposal | Baseline validation plus v2 payload | Invalid/untrusted mail is recorded under baseline rules; no LLM |
| Active counter | Latest valid counter with no terminal verdict, associated with the currently awaiting proposal | Scoped case and fresh message row | Another counter cannot be disposed accidentally |
| Requested split | Normalised `requestedCommitments`, sorted by date | Strict envelope | C1-C6 below |
| Negotiation turn | Number of revised proposals queued, not model calls or all e-mails. First proposal = 0 | `SupplyCase.negotiationTurn` | Interpretation must be agreed in Q-204 |
| Max turns | `SUPPLIER_DEMO_MAX_NEGOTIATION_TURNS`, default 3, integer 1-3 | Env | Invalid configuration fails preflight; never silently increase the roadmap limit |
| **T1** | A new revision is allowed only when `negotiationTurn < maxTurns` | Evaluator and final disposition | `needs_human/negotiation_turn_limit_reached`, no model call |
| **C1** | 1-5 tranches, integer quantity > 0 | Schema/evaluator | `counter_invalid_C1` if it reaches business validation; envelope schema failures keep their baseline status |
| **C2** | No repeated date | Evaluator | `counter_invalid_C2` |
| **C3** | Sum requested equals sum latest proposed; partial cancellation belongs in ACCEPTANCE | Evaluator | `counter_invalid_C3` |
| **C4** | No date before **today in UTC**; date-only `YYYY-MM-DD` is not converted through tenant/browser timezone | Shared date helper | `counter_invalid_C4`; confirm the baseline F4 helper agrees before implementation, otherwise stop for a compatibility decision rather than silently changing acceptance |
| **C5** | Every date is originalDate or a live Supplier slot date in the selected organization | Evaluator | `counter_invalid_C5` |
| **C6** | Requested split differs from current commitment | Evaluator | `counter_equals_proposal`; partner should send acceptance |
| Production need | **D1:** every unit shipped on a date consumes that date's slot capacity, including warehouse-reserved units on originalDate; use `q` for every requested date and keep F5 unchanged | `lib/planner.ts` capacity model; `lib/feasibility.ts` F5 | Never agree to more shipment on a date than the Supplier planner can produce |
| Requested-plan function | `planRequestedCommitment` is pure and uses the capacity reservation algorithm below | Planner | Explicit `capacity` or `no_slot`, no partial mutation |
| Candidate options | At most three ids: `requested`, `alt_within_policy`, `alt_best_effort`; only include alternatives that are feasible, unique, and different from both requested and current commitment | `buildCounterOptions` | No feasible option -> no approvable recommendation |
| Alternative policy restriction | Normal-priority moves, each shift <= 4 h, protected SLA, cumulative case cost + proposed cost <= 500 PLN | Existing Supplier policy | Outside-policy option is human-only |
| Alternative distance | Greedy by requested dates ascending, carry unfulfilled quantity forward; distance = sum of absolute per-date quantity differences; stable tie-breaks | Pure planner | Reuse the same reserved-capacity rule for every option |
| Option policy | `policy.evaluate` receives max shift, SLA, high-priority impact and **cumulative** additional cost | Baseline `lib/policy.ts` | `auto_approved` or `human_required` |
| Agent decision | `accept_requested`/`requested`, `propose_alternative`/`alt_*`, `decline`/null, or `escalate`/null; `decline` is recommendation-only and never sends a refusal | Strict object output | Inconsistent output -> `invalid_output`; decline -> `needs_human/agent_recommends_decline` with no recommendation |
| Reason codes | `requested_feasible_within_policy`, `requested_needs_human_approval`, `requested_infeasible_capacity`, `alternative_closest_within_policy`, `alternative_best_effort_only`, `no_feasible_option`, `high_priority_order_affected`, `sla_risk`, `cost_above_policy`, `turn_limit_near`, `insufficient_information` | Enum | Unknown code fails output validation |
| **O1-O4** | O1 strict Zod; O2 decision/id consistency; O3 option exists in the persisted evaluation; O4 rationale 1-1000 chars, plain text, no control characters | Output validator | `agent_unavailable/invalid_output` |
| Recommendation | Agent selection of an existing feasible option, or deterministic **requested** fallback after failure/skip/escalation when feasible; otherwise null | Record, linked to `evaluationId` | Null disables Approve, but never disables Reject counter/Reopen |
| Execution fingerprint | Hash canonical commitments, allocation moves/identities, shift/SLA/high-priority effects and cumulative cost. Not just the output quantities | Persisted evaluation | Changed risk/plan invalidates human approval even when quantities match |
| **G1-G9** auto gates | G1 valid counter; G2 O1-O4 valid; G3 source agent and not escalation; G4 fresh plan feasible; G5 fresh policy auto; G6 T1; G7 negotiation switch on; G8 not same commitment; G9 if requested is feasible+auto, selection must be requested | Case/counter/slots locked at disposition | First failure -> `needs_human` with explicit reason; confidence never authorises |
| **H1-H5** human gates | H1 matching recommendation and active counter, no verdict; H2 appropriate `needs_human` reason; H3 T1; H4 feasible identical commitments **and execution fingerprint**; H5 current `updatedAt` | Locked disposition | 409 stale version; 422 missing/infeasible/stale/not approvable |
| Approvable reasons (H2) | `recommendation_ready`, `recommendation_requires_human`, `agent_unavailable`, `agent_escalated`, `auto_negotiation_disabled`, **only with a recommendation** | UI and command share predicate | Phase-2 `counter_evaluated_manual` is not approvable |
| Output token cap | Default 4000; pass the installed SDK's supported output-limit parameter in the callback. Token accounting semantics are verified for the selected provider, not inferred from a model name | Runner | Truncation -> invalid output; never use partial output |
| Attempt deadline | Default 20000 ms, includes preparation after claim and the one permitted retry; actual SDK request gets AbortSignal and remaining deadline | Runner | Abort, then `agent_unavailable/timeout`; late results fenced out |
| Attempt cap | Default 4 per case, 50 per tenant in rolling last 24 h (UTC instants); all **claimed** attempts count, including failed/crashed/unknown usage | Attempt records + claim-time usage rows | Cap prevents a new claim, records skipped reason, no provider call |
| Usage reservation | Exactly one matching ledger row per claimed `runId`, committed **before** a provider call; initially zero tokens with `usageKnown=false`; finalisation updates the same row | Installed ledger through isolated adapter | Unsupported transactional/update seam blocks implementation; do not silently write at finish only |
| Switch | `supplier_demo_auto_negotiation` default on; off blocks new LLM calls and automatic handoffs, not deterministic evaluation or explicit human risk approval | Feature toggles | Observable `auto_negotiation_disabled` or held-send reason |
| Proposal send switch | Existing proposal switch applies to both first and revised proposals, including human-authorised ones | Baseline toggle | `needs_human/auto_proposal_disabled_send`, pending message retained |
| Additional cost | Initial applied plan cost plus applied revision costs | Case | Undo restores only when concurrency guards allow |

### Capacity reservation algorithm (R10)

1. Build a local working snapshot of all relevant slots using the baseline's case-owned reservation rules. Do not mutate ORM entities.
2. Compute and reserve the current request's production need for **every** requested date before moving anything. Existing bookings by other cases remain occupied.
3. For each requested date in ascending order, cover its deficit by moving eligible allocations out. Stable order: normal priority, then high priority, then `orderNumber` and slot id. A move is indivisible unless the baseline explicitly supports splitting allocations.
4. A destination's usable free capacity is `grossFree(destination) - reservedRequestedProduction(destination)`, with the working map updated after each move. A later requested date must retain its own required production. Do not reserve again after moving.
5. Return commitments, feasibility, exact moves, cost = sum of shift hours times each configured shift rate, maximum shift, SLA status and high-priority flag. No fitting destination means infeasible. Alternatives use the same algorithm and final policy evaluation.
6. D1 regression: stock uses up the slot on the shipment date. Warehouse-reserved units on the original date are included in that day's load, and every requested date reserves its full quantity before moves. F5 remains unchanged: the buyer can only accept what the Supplier proposed.

### Attempt identity, locks and usage accounting (R1/R2/R7/R9)

- Each counter has an `evaluationId`, `agent.nextAttemptNo` (starts at 1), `activeRunId`, and an append-only bounded attempts array. Each claimed attempt has `(counterMessageId, attemptNo, runId, evaluationId)` and `leaseExpiresAt`.
- `counter_evaluated` carries `attemptNo` and `evaluationId`. The claim checks these identities and absence of an existing claim **before** creating a new attempt. A state-only `not_started` check is insufficient. Replayed older attempt events cannot claim a freshly reopened attempt.
- Claim lock order: transaction-scoped budget lock keyed by `(tenantId, agentId)` -> scoped case `PESSIMISTIC_WRITE` -> fresh scoped counter row. This serialises the daily count/reservation across different cases. Every other counter mutation locks case -> counter -> relevant slots sorted by id; it never acquires the budget lock after a case lock.
- In one claim transaction: enforce case/daily caps, persist `running` with a fresh runId/lease and usage event id, and reserve its usage row with zero/unknown tokens. A rollback creates neither a runnable claim nor a spent reservation. No model call until commit.
- Use the installed ledger and entity APIs only after confirming they accept the transactional entity manager and allow same-row finalisation. The app adapter isolates these imports. If they cannot implement these semantics without extra DDL, stop for an owner-approved storage amendment; an independently committed recorder call is not equivalent.
- Result finalisation re-locks case/counter and requires the same active attempt identity, `running`, the same evaluation and current case status. Otherwise it is late: it may finalise known usage for **its own** row, but it cannot update the active recommendation, case status, verdict or send anything.
- Each claim consumes one daily attempt even on crash. Finalisation updates that row, never appends a second row. Unknown or partial tokens are labelled unknown/partial, never described as free. The daily **attempt** limit counts rows, not the sum of tokens.
- A bounded 429/502/503 retry is a second physical provider request inside the same logical attempt, under the original deadline. Record its count and aggregate known usage; no SDK retry stacking. Reopen, by contrast, is a new logical attempt and consumes a new reservation.

### Recovery rules RCV1-RCV6 (R1/R2/R6/R13)

- **RCV1 - Lease.** A running attempt is stale at `startedAt + configuredTimeout + 30 s`. Store this deadline at claim; do not recompute it from changed env settings. Check staleness before a generic replay/no-op return.
- **RCV2 - Triggers.** Re-delivered counter/evaluation/recommendation events, a current-version Retry, startup recovery, and a scoped periodic sweep through the **already installed scheduler** invoke the same idempotent recovery command. Sweep interval <= 15 s. No new workflow engine. The scheduler integration is a Phase-3 deliverable and seam-verification gate.
- **RCV3 - Crashed claim.** Under lock, stale running -> attempt `failed/timeout`, zero/unknown ledger reservation retained/finalised, active run cleared, deterministic fallback if feasible, case `needs_human/agent_unavailable`, one attention event. Recovery never launches another provider call automatically.
- **RCV4 - Lost event.** Persisted evaluation with no claimed attempt can re-emit its exact scheduled `counter_evaluated` event. Persisted `dispatch.pending` plus an auto-eligible recommendation/no verdict can re-emit the same `recommendation_ready`. A new LLM run is not needed to recover delivery intent.
- **RCV5 - Explicit rerun.** Reopen may schedule a new attempt only from permitted needs-human reasons, with switch on, valid rules/turn and budget potentially available. Re-evaluate current slots, clear the active recommendation/dispatch, retain old attempts, set `not_started`, choose the next unused attempt number, and emit its new evaluation identity. The claim rechecks caps atomically. Otherwise supersede the counter and return to the last confirmed waiting state.
- **RCV6 - Bounds and failures.** While app+DB+scheduler are healthy: observed live failures settle within attempt deadline + 5 s; crashed claims settle by stored lease expiry + one sweep interval (normally timeout + 45 s). No wall-clock guarantee applies during infrastructure downtime. Recovery resumes on restart. Technical DB/queue errors propagate to framework retries; expected business conditions produce explicit terminal states, not retry exceptions.

### State machine delta (`SupplyCase.status`)

```text
proposal_queued | proposal_delivered
  ACCEPTANCE -> baseline reply/commitment/confirmation path
  REJECTION  -> baseline needs_human/rejection_received (no LLM)
  valid COUNTER -> counter_received
    evaluate_counter
      invalid/turn-limit -> needs_human/specific reason
      Phase 2 only       -> needs_human/counter_evaluated_manual, no agent event
      Phase 3+, switch off -> needs_human/auto_negotiation_disabled
      otherwise          -> persist evaluation + scheduled attempt -> counter_evaluated
    run_counter_agent
      claim -> running + lease + usage reservation
      failure/escalation -> needs_human/specific reason, fallback only when feasible
      Phases 3-4 valid recommendation -> needs_human/recommendation_ready
      Phase 5 gates fail -> needs_human/recommendation_requires_human
      Phase 5 gates pass -> persist dispatch.pending -> recommendation_ready
    send_revised_proposal(auto) OR human Approve
      locked recheck -> one verdict + one pending revision + turn increment
      case proposal_ready -> send handoff gates
        blocked -> needs_human/*_disabled_send, same pending message retained
        allowed -> baseline sending/queued/delivered
    Reject counter (recommendation optional)
      -> needs_human/recommendation_rejected OR counter_rejected; no e-mail
    stale running / lost event -> RCV1-RCV6
```

### Complete Retry / Reopen / Reject / Undo contract

| Current condition | Allowed recovery | Result and invariant |
|---|---|---|
| `counter_received`, evaluation missing | Retry or sweep | Re-emit `counter_received`; no invented evaluation |
| `counter_received`, evaluation complete, scheduled attempt not claimed | Retry or sweep | Re-emit same attempt-specific event; no duplicate claim |
| `counter_received`, running, lease active | Retry | 422 `agent_running`, show lease/retry-after; do not run again |
| `counter_received`, running, lease expired | Retry/redelivery/sweep | Recover to `needs_human/agent_unavailable`, not another LLM call |
| `counter_received`, auto recommendation persisted, event lost | Retry/sweep | Re-emit same recommendation id; disposition is idempotent |
| `counter_received`, inconsistent/missing active record | Recovery | `needs_human/negotiation_state_invalid`; never silently leave it waiting forever |
| `needs_human/agent_unavailable` or `auto_negotiation_disabled`, rerun allowed | Reopen | RCV5: fresh evaluation, new attempt identity, cleared recommendation, attempts retained |
| Same reasons, rerun disallowed | Reopen | Mark counter verdict `superseded`, clear dispatch, restore waiting state; response explains switch/cap/turn/config reason |
| `counter_evaluated_manual`, invalid/equal/turn-limit counter, escalation, recommendation ready/requires-human/stale/rejected, `counter_rejected`, `revision_undone`, `negotiation_state_invalid` | Reopen | Supersede counter, restore the latest proposal's actual waiting state; never fabricate delivery |
| Active counter in needs-human, recommendation present | Reject matching counter+recommendation | Verdict `rejected`; reason `recommendation_rejected`; no e-mail |
| Active counter in needs-human, recommendation absent | Reject matching counter | Verdict `rejected`; reason `counter_rejected`; no `no_recommendation` error |
| Pending revision held by switch | Retry after switch restored | Reuse same message and authorisation source; no new revision/turn/cost |
| Pending revision held, switch stays off | Undo pending revision, then Reopen | Explicit recovery; no automatic promotion from auto to human authority |
| Revision pending, no hub handoff | Undo | Lock and compare stored post-state, then restore recorded change; conflicting slots -> 409 `undo_conflict` |
| Revision sending/queued/delivered or uncertain handoff | Undo | Refuse; reconcile the existing send/link, never assume unsent |

Waiting state is derived from the latest proposal's persisted transport state (`proposal_queued` or `proposal_delivered`); existing failure states delegate to the baseline retry path. Every new negotiation needs-human reason has a defined current-version recovery. Unrelated baseline reasons retain their baseline table; this spec does not promise to reopen arbitrary foreign states.

**Monotonicity and notifications.** Lock and re-read scoped rows before every transition. Late events cannot regress a terminal/disposed case. Attention emits once per persisted transition, not once per delivery attempt. Retry/Reopen use the current `updatedAt` (409 when stale). The console exposes Retry for stalled `counter_received`, including after lease expiry, and explains held-send recovery.

**Phase-2 distinction.** It never emits `counter_evaluated`, never claims an attempt and never offers Approve. Phase 3 explicitly replaces that terminal tail and adds the switch branch. Turning off the runtime switch later is **not** equivalent to reinstalling Phase 2.

## Agent Contract

### Registration (`src/modules/supplier_demo/ai-agents.ts`)

Required semantics below must be mapped to the installed `AiAgentDefinition` in Phase 3. The snippet is a registration contract, not a claim that these field names were compiled in this editing pass.

```ts
defineAiAgent({
  id: 'supplier_demo.counter_negotiator',
  moduleId: 'supplier_demo',
  label: 'Supplier counter-proposal negotiator',
  description: 'Selects an existing deterministic option or escalates.',
  systemPrompt: COUNTER_NEGOTIATOR_PROMPT_V1,
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  requiredFeatures: ['supplier_demo.supply_cases.manage'],
  output: { schemaName: 'SupplierCounterDecision', schema: counterDecisionSchema },
  allowRuntimeOverride: false,
  allowRuntimeModelOverride: false,
})
```

Every call also sets **`enableTools: false`**. No agent-callable tools, `ai-tools.ts`, `defineAiTool`, tool-step env key or tools-enabled smoke mode is delivered. The supplied review reports that object mode does not run `untrustedInput` moderation; this spec does not claim moderation as a protection or add a moderation/OpenAI-key check.

### Runner (`lib/agent/runner.ts`, DI token `supplierDemoCounterAgentRunner`)

```text
runCounterAgent(container, authContext, caseId, attemptIdentity, input, config)
  establish deadline from the claimed attempt (do not reset on retry)
  check runtime overrides and configured provider/model policy
  call real runAiAgentObject(..., enableTools: false, sessionId: runId,
                            generateObject: prepared => callModel(prepared))

live callModel(prepared):
  capture resolved provider/model, effective system prompt, input/messages hashes
  persist prepared audit through an orchestration-owned short transaction, fenced by runId
  check switch/deadline again immediately before each physical provider request
  invoke installed SDK generateObject with prepared model/system/messages/schema
    + own abortSignal bound to remaining deadline
    + maxOutputTokens from validated config
    + maxRetries: 0 (one retry is managed by this runner, not by two layers)
  validate complete output; never use partial/truncated output

stub callModel(prepared):
  capture the same audit fields
  return scripted installed-SDK-shaped result or scripted failure
  obey the same deadline/cancellation interface
  never call the provider transport
```

- **One production/test seam (R3/R4/R5).** The real registry, auth gate, model factory and prompt composition run in both modes. Only the callback's provider call is replaced. Do not test a different tools-enabled production path.
- **Cancellation.** Start one runner-owned controller for the entire claimed attempt. Pass its AbortSignal to the actual SDK transport call. At deadline, abort and record timeout; an outer race at deadline + 2 s is only a liveness backstop. Handle late fulfilment/rejection to avoid unhandled promises, and fence it from business state. Clear timers/listeners on completion. Cancellation prevents continued client work; it is **not a promise of zero provider billing for work already accepted**.
- **Retries.** At most one retry on 429/502/503 with at least 5 s remaining. Use bounded backoff within the same deadline and the same output cap per physical request. No retry on schema failure, refusal, config failure or abort. The live adapter tests assert SDK automatic retries are disabled.
- **Prepared-audit persistence.** Before the provider call, an orchestration-owned audit writer briefly locks/fences the attempt and persists the prepared prompt/model/hash snapshot and request count. Release that transaction before network work. A crash after dispatch therefore retains the prepared audit; a crash before preparation correctly leaves effective fields null. Failure to persist this snapshot means no provider call.
- **Switch during an attempt.** Recheck the negotiation switch immediately before every physical request, including a transport retry. A claimed-but-not-dispatched attempt cancelled by the switch retains its usage reservation, has outcome `cancelled`, and ends `needs_human/auto_negotiation_disabled` with a fallback when feasible. The switch does not retroactively un-send a request already dispatched; any existing call is still bounded by its deadline and cannot lead to an automatic proposal while the switch is off.
- **Prepared options.** Preserve the actual model, messages, system prompt and schema assembled by the runtime. Do not replace them with env-only guesses. Set only the enforced timeout/output-limit/retry controls. Verify parameter names against the installed SDK; an unsupported required control is a blocking seam mismatch.
- **Effective identity.** Capture the configured provider/model separately from resolved model id/provider label and effective prompt hash. SDK provider labels may differ from an OpenRouter routing name; store both, do not mislabel one as the other. Never store credentials, raw request headers or a secret-bearing URL.
- **Errors.** Abort -> `timeout`; final 429 -> `rate_limited`; other network/5xx -> `provider_error`; refusal/content filter -> `refusal`; strict schema/O1-O4/truncation -> `invalid_output`; missing model/key/allowlist or override conflict -> `missing_config` with a safe sub-code. No raw response body in stored errors.

### Offline selftest isolation (R3)

The model factory resolves before the callback and requires a key according to the supplied review. Therefore:

1. Run model selftests in a **child process** with a controlled env. Always replace any inherited real `OPENROUTER_API_KEY` with an obviously dummy value, and set the actually supported provider base-URL override to a non-production/non-routable test target. Do not edit `.env`, and do not read or print the inherited value. A dummy test secret is not a live credential.
2. Install an HTTP(S)/fetch network-denial guard before importing/resolving the model. The local database connection is permitted; provider HTTP, SMTP and actual hub sending are not. Assert zero provider network calls and that the scripted callback was the only model-call seam. The guard, not the base URL alone, prevents accidental cost.
3. Force object mode and tools off in both registry and call. A tools-path attempt is a test failure, not a fallback.
4. The **missing-key negative scenario** runs in a separate child with the key deliberately absent and dummy injection disabled. Expect `missing_config` before the provider callback, and zero network calls. Do not accidentally repopulate the key in that negative test.
5. `--with-send` is a separately explicit real-mail mode and only sends to the allowlisted fixture partner. It is not part of the offline no-network model selftest and does not establish a live LLM pass. `demo:agent-smoke --live` is separate and owner-run.

### Input (`counterAgentInputSchema`, canonical JSON <= 8 KB)

```text
{
  promptVersion: "supplier-counter-v2",
  today: "YYYY-MM-DD",                 // UTC date
  case: {
    ref: "CASE", sku: "MAT-42",
    originalCommitment: [{quantity, date}],
    currentCommitment: [{quantity, date}],
    negotiationTurn, maxNegotiationTurns
  },
  counter: { requestedCommitments: [{quantity, date}] },
  policyLimits: {
    maxShiftHours: 4, maxIncrementalCost: 500, currency: "PLN",
    cumulativeCostSoFar
  },
  options: [{
    optionId: "requested" | "alt_within_policy" | "alt_best_effort",
    commitments: [{quantity, date}], feasible, infeasibleReason,
    policyDecision: "auto_approved" | "human_required",
    maxShiftHours, incrementalCost, slaProtected,
    highPriorityAllocationMoved, movedAllocationCount, deviationFromRequested
  }]
}
```

All object keys are fixed. Values are numbers, booleans, enums, ISO dates, generated references, a currency code or a validated SKU (`^[A-Z0-9._-]{1,40}$`). This is **structured**, not literally all numeric.

Never include e-mail addresses, correlation/envelope ids, order/customer identities, other cases, raw allocation records, per-order cost rates, subject, body or headers. The SDK context must not inject a conversation history or tenant prompt containing those values. A fresh run/session id prevents session-history reuse; Phase 3 verifies the prepared messages as well as the application input.

`inputHash = SHA-256(canonicalJson(input))`. Persist the canonical input. Pseudonymised operational data is still private business data; absence of names is not proof of anonymity or non-sensitivity.

### Output (`counterDecisionSchema`, strict)

```text
{
  decision: "accept_requested" | "propose_alternative" | "decline" | "escalate",
  optionId: "requested" | "alt_within_policy" | "alt_best_effort" | null,
  reasonCodes: [ReasonCode, ...],     // 1-4 unique codes
  rationale: string,                 // 1-1000 chars, English, inert plain text
  confidence: number                 // 0..1, informational only
}
```

No **executable** quantity/date/action fields exist. A rationale may contain ordinary numbers, but is never parsed into a plan. The chosen commitments and all business risk/cost values come only from deterministic evaluation. `decline` and `escalate` must both use `optionId: null`; decline only recommends that a person reject the counter-proposal. O1-O4 are mandatory; a reason code cannot override the computed policy verdict.

### Why toolless

C1-C6, T1, `planRequestedCommitment`, `buildCounterOptions` and policy evaluation run before the model call. The complete options are in the input, so lookup tools add no information. Removing them eliminates the reviewer-identified bypass of the callback and makes the recorded input sufficient to reconstruct the model request context (not to promise identical stochastic output).

### Effective prompt audit and override rules (R8)

The versioned prompt defines the Supplier role, option-id-only selection, policy meaning, preference for a feasible requested option, escalation, data-versus-instructions and the strict output shape. Changing it bumps `PROMPT_VERSION`.

- Fail offline/local preflight when any applicable prompt/runtime override row exists for this agent. Apply the same check at each live attempt so a later-created override cannot bypass preflight.
- Capture the **effective** system prompt/hash and resolved model/provider in the prepared callback. Store effective prompt text only after the fixed-source/no-private-context check, with a 16 KB bound; hash the effective messages too. The canonical input and versioned code remain the reconstruction inputs.
- Before the callback is reached, effective fields are null with an explicit audit state, not filled with env values and labelled effective. Missing-key/failed-resolution attempts still have their claim and usage reservation.
- Runtime override rejection/normalisation is a Phase-3 test. If the runtime can silently inject extra tenant/session context, stop rather than claim a complete audit.

### Principal

Resolve the configured Supplier mailbox actor via baseline `resolveMailboxActor`; scope tenant/organization from trusted context and resolve its features through the installed RBAC service. No role-name check or superadmin shortcut. Missing actor/required feature -> `agent_unavailable/principal_missing`, no provider call. Required feature remains `supplier_demo.supply_cases.manage`.

## Security, Privacy, and Prompt-Injection Rules

- **P1 - No raw mail context.** Subject, body, quoted text, headers and external free text never enter the input or prepared model messages. Test an adversarial marker in the mail body.
- **P2 - Strict payload.** Reject unknown counter payload keys; validate SKU, dates, quantities, origin, current proposal and scope before evaluation. Plain-text MIME is allowed **when it contains the structured envelope**; free-text-only acceptance/counter is never executable.
- **P3 - Model has no execution authority.** No tools or actionable plan fields. Recompute commitments and policy under locks; do not execute rationale or confidence.
- **P4 - Inert explanation.** Escaped plain text, clearly labelled untrusted, never parsed, used as a gate, or put into a business e-mail. Human mail is composed deterministically from approved facts.
- **P5 - Scope.** No cross-case/organization tools. Scope comes from trusted event/auth context, never the mail or model. Cross-organization access is 404.
- **P6 - Secrets.** Runtime may consume a secret from its configured environment. Neither the implementing assistant nor generated tooling prints, persists, inspects, commits or reports its value/length. Stored provider failures contain only safe codes/status, not headers/bodies. Reuse installed redaction. Offline child tests use dummy credentials only.
- **P7 - External data use.** The model id is an owner-selected configuration, **not a verified retention or pricing promise**. Do not claim that a prompt disables provider retention or that pseudonymised schedules/costs are non-sensitive. Q-203 requires owner acknowledgement of actual routing/provider terms before a live call containing business data. Synthetic fixture smoke is not permission to transmit live customer data.
- **P8 - Audit access.** User ids, optional operator notes, model rationale and operational facts can be sensitive even without names. Apply tenant-scoped access, safe rendering and the existing retention/security policy to the JSON record. Do not describe the whole record as PII-free by construction.

### Added `ai_assistant` surfaces and residual exposure (R14)

Phase 1 inventories the enabled package's **actual** routes, ACL feature ids, settings/overrides/usage surfaces, background jobs and optional dev MCP process. Record method/path/permission and whether the Supplier agent is reachable. The two reviewer-identified invocation surfaces are:

| Surface | Required verification | Disposition |
|---|---|---|
| Generic chat/dispatcher route (exact path from installed source) | Object-only registration actually rejects this agent in chat mode | Test denial, not merely the declaration flag |
| `POST /api/ai_assistant/ai/run-object` (reviewer-reported path) | A `manage` user may invoke an object agent with caller-supplied input outside our commands | Prefer a supported app policy/route restriction for this agent; do not edit installed package files |
| Prompt/model override and AI settings routes | Identify exact ACLs and all applicable override stores | Preflight and per-attempt override checks |
| Dev MCP child | Determine whether activation starts it and how to disable unused development exposure | Document the verified config; no guessed flag behaviour |

If the installed extension points cannot block the generic object route for this agent, **Q-206 is a live-rollout gate**: either restrict access at the application's supported boundary or explicitly accept a controlled-demo residual risk. Such a direct call has no app-domain mutation/mail access, but it can spend tokens and bypass this app runner's caps/timeout/input whitelist. Do not label that exposure accepted without owner acknowledgement. All cap/switch guarantees in this spec apply to the controlled Supplier command path; a globally exposed alternate route must not be hidden behind those guarantees.

### Switch and handoff boundary

- The negotiation switch stops new controlled LLM calls and automatic revised-proposal handoffs. Deterministic evaluation and a **new explicit human approval** may continue.
- The proposal send switch stops all new proposal handoffs, including human-authorised revisions. No post-queue bypass is permitted.
- Recheck switches under the same case/counter/message locking discipline immediately before the baseline `sending` claim/hub call. Record `authorisationSource` and the check time. If disabled: retain the pending message, persist a held dispatch and `needs_human` reason, emit attention once.
- After a hub has accepted a job, neither a database rollback nor a toggle is claimed to recall an e-mail. An uncertain handoff uses baseline link lookup/reconciliation; never blindly send another copy.
- Turning a switch on does not itself change an auto authorisation into a human one or create a new revision. Current-version Retry reuses the pending message and original source. Undo is the alternative before handoff.

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature |
|---|---|---|---|
| Trusted system subscriber | Record/evaluate counter; claim/run controlled attempt; request auto disposition | Trusted tenant/org + fresh scoped records | Baseline system command context |
| Recovery scheduler | Reconcile stale attempts and lost dispatch intent only; no arbitrary model input | Enumerate due records per tenant/org; same recovery command | Baseline trusted job context |
| Mailbox actor / agent principal | Execute the declared toolless object agent on canonical input | Trusted tenant/org and resolved ACL | `supplier_demo.supply_cases.manage` |
| Supplier operator | View cases/recommendations/attempts | Selected organization | `supplier_demo.supply_cases.view` |
| Supplier operator | Approve, reject active counter, Retry, Reopen, supported Undo | Selected organization, current version | `supplier_demo.supply_cases.manage` |
| CLI operator | Fixture selftests, simulator; explicit live/send modes separately | Configured fixture tenant/org | Shell plus existing injection/send guards |

Routes use `validateRouteMutationGuard`, trusted scope and the installed metadata/OpenAPI conventions. No new Supplier ACL feature or role-name check is introduced; activation may expose **existing AI-module** ACL features, which are inventoried above.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| LLM execution, registry, model factory and prepared object callback | Reuse/activate | installed `ai_assistant` | `runAiAgentObject`, `defineAiAgent`, `ai-agents.ts`; no tools discovery in this module | Verify exact exports and SDK cancellation seam |
| Token-usage reservation/finalisation/reporting | Reuse through app adapter | installed `ai_assistant` ledger | Transactional reservation and same-row update, verified against installed recorder/entities | Claim-time failed/crashed attempt accounting |
| Log redaction | Reuse | `ai_assistant` | `lib/log-redaction.ts` | Keeps secrets out of stored errors |
| Inbound, threading, send, delivery tracking | Reuse (unchanged) | `communication_channels` + reply/proposal spec machinery | `receive_inbound`, `supply_message.send`, `track_delivery`, `retry` | Verified |
| Counter evaluation, planner extension, gates, recommendation, verdict | App-own | `supplier_demo` | commands + app events | Supplier-private domain |
| Kill switch | Reuse | `feature_toggles` | new toggle `supplier_demo_auto_negotiation` | Canonical toggles |
| Attention notifications | Reuse | `notifications` | existing type, new reasons | Frozen type id |
| Recovery tick | Reuse existing scheduler | installed scheduler + app recovery command | Scoped periodic/startup recovery, due-state inspection | No new queue or process engine |
| Durable process engine | **Not used** | (`workflows`, `agent_orchestrator`) | — | Q2 decision; left disabled |

## Architecture and Data Flow

```text
real mailbox -> Communication Channels -> message.received
  receive_inbound (baseline validation + strict v2 counter)
    commit: scoped case counter_received; initialised negotiation_record
    after commit: counter_received(caseId, counterMessageId)

persistent evaluate-counter -> evaluate_counter
  case lock -> fresh counter -> read current scoped slots
  rules/turn/options/evaluationId persisted
  Phase 2: needs_human/counter_evaluated_manual; NO counter_evaluated event
  Phase 3+: disabled switch -> deterministic fallback + needs_human
            otherwise -> scheduledAttemptNo -> counter_evaluated(..., evaluationId, attemptNo)

persistent run-counter-agent -> run_counter_agent
  recover stale state BEFORE replay guard
  CLAIM TX: budget lock -> case lock -> fresh counter
    event identity, caps, config/principal checks
    attempt running + runId + lease + usage reservation committed together
  NO TX: real runAiAgentObject, tools off, runner-owned callback
    effective prompt/model capture; own AbortSignal/output cap; bounded retry
  COMPLETE TX: case lock -> fresh counter, fence same attempt/evaluation
    update existing usage row; persist terminal outcome/recommendation
    Phases 3-4 -> needs_human
    Phase 5 gates pass -> persist dispatch.pending -> recommendation_ready

persistent negotiation-auto-send OR guarded human Approve
  send_revised_proposal
    case lock FIRST -> fresh locked counter -> scoped slots sorted by id
    current recommendation/verdict/version; replan; G1-G9 or H1-H5
    atomic moves + case fields + verdict + ONE pending revision + turn increment
    persist dispatch revision_pending; after commit existing proposal_ready event

existing send-proposal-email -> supply_message.send
  fresh case/counter/message + handoff toggle check + baseline sending claim
    blocked -> same pending revision; needs_human/*_disabled_send + attention
    allowed -> existing hub threaded send/reconcile/track path
  sent/delivery_failed -> baseline transport states

Manufacturer ACCEPTANCE -> unchanged baseline feasibility/commitment/confirmation

existing scheduler tick/startup -> recover_counter_processing
  stale running -> failed/timeout + needs_human
  missing eval/agent/auto-send/proposal-ready event -> re-emit durable intent
  never create a second logical claim or revision; never auto-rerun a failed LLM
```

**Module boundary.** New logic stays in `supplier_demo`; dynamically import the AI runtime in the isolated runner/usage adapter. No installed file is edited. The installed scheduler is reused for recovery; if its public hook differs from the review assumptions, stop and record the seam mismatch.

**Lock freshness.** Do not trust an ORM identity-map object loaded before the transaction. Force scoped fresh reads with pessimistic locks using the installed ORM API. Lock the case even when the chosen option moves **zero** slots. All commands touching a counter use the case -> counter -> slots order; the claim alone additionally takes its budget lock first. Technical failures roll back and reach queue retries; business denials persist reasons.

**Persisted intent, not event wishful thinking.** Every next step is derivable from the stored evaluation/attempt/recommendation/dispatch/revision. An after-commit emit can be lost. Recovery can re-emit the same identity without generating a new intent. The sweep handles a revision committed before `proposal_ready` emission as well as the two reviewer-reported gaps.

**Delivery guarantee.** The app guarantees one local logical revision/authorisation/turn per disposition. Transport tests must show one visible e-mail for the supported retry/crash scenarios. Do not claim a general exactly-once SMTP guarantee from a `sending` marker alone: uncertain hub acceptance uses the baseline link lookup and requires reconciliation, not blind re-send.

**Compatibility.** New status/reasons/events/routes and a nullable JSON column are additive. Tightening COUNTER validation is **not** universally backward-compatible. `current_commitment` means latest proposed, not first proposal. First-proposal bytes and baseline acceptance/confirmation behaviour are separately regression-tested. New event identities are local Supplier data and are not sent as hidden business API messages.

## User Journeys

### Journey J-201 — Autonomous revision (stage, Level 5)

1. Preconditions: `demo:reset` → `demo:preflight` green (AI checks included). The baseline J-101 runs to `proposal_delivered` with `400 Wed / 100 Fri`. The operator has the console open.
2. The Manufacturer replies with a counter asking `400 Wed / 60 Thu / 40 Fri` (Manufacturer OM, or `mail:simulate-reply --scenario counter-within-policy`).
3. The hub ingests the message; deterministic options are persisted; the model selects `requested`; policy passes. The timeline shows received -> deterministic check -> agent analysed -> AUTO APPROVED -> revised proposal sent. Timings are measured against the <= 60 s real-mail gate, not fabricated fixture timestamps.
4. The Manufacturer inbox receives `Re: [SC-SO-441] Delivery update — MAT-42` with the revised split, in the same thread.
5. The Manufacturer accepts. The reply-spec path confirms and the case becomes `resolved`, with accepted `400 Wed / 60 Thu / 40 Fri`.

### Journey J-202 — Human authorises risk

1. The counter asks `450 Wed / 50 Fri`. Deterministic check: feasible only by moving the high-priority allocation#1 → `human_required`.
2. The agent recommends `accept_requested` with reason codes `requested_needs_human_approval`, `high_priority_order_affected`. Gate G5 fails, so the case goes to **Needs human** / "Recommendation requires approval", and a notification fires.
3. The console panel shows requested vs recommended, the check, the rationale (untrusted) and **Approve** / **Reject**.
4. **Approve** opens a confirm dialog (what will be sent, which order moves), then 202. The revised proposal goes out (turn 1/3) and the timeline shows "⚠ HUMAN REQUIRED → ✓ Approved by <user>".
5. The acceptance arrives and the case is `resolved`.

### Journey J-203 - Failures have recovery; partner communication is explicit

- **Live timeout/invalid output/rate limit.** Complete the claimed attempt and its usage row. Move to `needs_human/agent_unavailable`; show a deterministic requested fallback only when feasible. Human Approve remains bounded by H1-H5. No feasible fallback means Reject counter/Reopen, not a disabled dead end.
- **Crash after claim.** The child worker dies with a durable `running` lease and usage reservation. Redelivery/Retry/sweep recovers it after expiry. A late result from the old run cannot complete a new attempt or send a proposal.
- **Lost recommendation event.** `dispatch.pending` lets Retry/sweep emit the same recommendation event. Duplicate events still yield one revision.
- **Reopen after failure.** Under allowed switch/caps/turn, schedule a new fenced attempt. Otherwise supersede the counter and restore the actual prior waiting state. The API says which branch ran.
- **Switch off.** No controlled model call or automatic handoff. A pending revision is held with a visible reason; re-enable+Retry sends the same message, or Undo before handoff permits recovery. Human approval does not bypass the proposal transport switch.
- **Turn limit.** A counter after the maximum queued revisions reaches `negotiation_turn_limit_reached`; no model call or additional revision. **No automatic Supplier rejection e-mail is sent** under the fixed scope. Reopen prevents a local dead end but does not tell the Manufacturer: an operator must communicate that the latest proposal stands or decide another resolution. The partner may otherwise wait indefinitely. This is a disclosed coordination limitation, not a self-healed business outcome.
- **Reject without recommendation.** Reject the active counter by id; persist `counter_rejected`. Never return `no_recommendation` for that action. No partner e-mail is sent by this local rejection.
- **Stale approval/undo.** 409 stale case; 422 stale recommendation/risk plan; 409 undo conflict. Refetch and show current state. Never overwrite another case's newer capacity booking.
- **Invalid counter/rejection/free text.** No model call. Keep the baseline classification or explicit C-rule reason. Text/plain with a valid envelope is not the same as free-text-only mail.

### Journey J-204 — Before the Manufacturer OM supports v2

The simulator prints or injects every counter scenario (`mail:simulate-reply --scenario …` or `--type counter --request 450@2026-09-23,50@2026-09-25`), bound to the latest case and its latest proposal id, and prints the case and the scenario it used.

## UI and Interaction Contracts

Closest references:

- the existing console `src/modules/supplier_demo/components/SupplyCaseConsole.tsx` (`StepIndicator`, `Alert`, `useConfirmDialog`, `Tabs`, `JsonDisplay`);
- `node_modules/@open-mercato/core/src/modules/workflows/backend/instances/[id]/page.tsx` (detail + event history);
- for the recommendation layout only (not imported; enterprise and disabled), `node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/components/ProposalCard.tsx` + `DisposeDialog.tsx` (a proposal card with facts, rationale and approve/reject).

The draft identifies `.ai/guides/backend-ui.md`, `om-backend-ui-design` and `references/quality-states.md` as implementation guidance. The implementer verifies/loads the actual available repository guidance; this file-editing pass does not claim those resources were available or executed.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/supplier-demo/supply-cases/[id]` (changed) | Negotiation card: turn `n / max`; active recommendation panel with **Approve** / **Reject**; per-round entries in the timeline; runs detail | `GET /api/supplier_demo/supply-cases/{id}` (+ `negotiation`); `POST …/recommendation/approve`; `POST …/recommendation/reject`; existing Retry/Reopen/Undo | console + `ProposalCard` layout | `Card`, `SectionHeader`, `StatusBadge`, `Tag` (reason codes), `Table` primitive (≤ 3-option comparison), `ActivityFeed`, `Alert`, `Button`, `useConfirmDialog`, `useGuardedMutation`, `apiCall`, shared conflict UI, `LoadingMessage`, `ErrorMessage` | loading; counter evaluating / agent running (live, "Analysing…" with `aria-busy`); recommendation ready; requires human; agent unavailable (+ deterministic recommendation or none); kill switch off; turn limit reached; rejected; approved / auto-approved; stale 409/422; permission denied (no buttons); error + retry | REQ-207, REQ-208 |
| `/backend/supplier-demo/supply-cases` (changed) | New status `counter_received` badge + filter option; the "Proposed" column shows the latest proposal and `turn n` | existing list API | baseline list | existing `DataTable` | existing states + new status in light/dark | REQ-208 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Supplier operator | **Supply Recovery → Supply cases** (unchanged) → console | none | Notification "Recommendation requires approval" → console (1 click) → Approve (2) → confirm (3) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Negotiation card | No recommendation: "No feasible recommendation is available. Reject this counter or reopen to wait for a new reply." A running case shows Retry timing; a held revision explains re-enable+Retry or Undo. Phase-2 legacy rows offer Reopen only | Stack <=3 options below md; full-width wrapping actions | Summary -> permitted actions -> runs; focus-managed confirm dialogs; `aria-live="polite"` for transitions |

### `/backend/supplier-demo/supply-cases/[id]` — negotiation delta

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Negotiation                                          Turn 1 / 3   [Needs human ●]  │
│ Counter-proposal received 10:05:12 — requested 450 Wed / 50 Fri                    │
│ ┌ Options (deterministic) ──────────────────────────────────────────────────────┐  │
│ │ Option          Split              Feasible  Policy          Shift  Cost  SLA   │  │
│ │ ▶ Requested     450 Wed / 50 Fri   ✓         HUMAN REQUIRED  6 h   +180  ✓    │  │
│ │   Within policy 400 Wed / 100 Fri  ✓ (= current) — not offered                  │  │
│ └───────────────────────────────────────────────────────────────────────────────┘  │
│ Recommendation (agent · meta/muse-spark-1.3-contributor · 3.4 s · 1 912 tokens)    │
│ Decision: Accept requested split   [high-priority order affected] [needs approval] │
│ ▸ Model rationale (untrusted, English)                                            │
│ ⚠ Policy requires human approval: a high-priority order would be moved.           │
│                                        [Reject]  [Approve and send revised proposal]│
│ ▸ Agent runs (1)   attempt 1 · ok · prompt supplier-counter-v2 · input sha256 3f9…  │
└──────────────────────────────────────────────────────────────────────────────────┘
Timeline (additions, one group per round, between "Waiting for response" and the next reply):
│ ✓ 10:05:12 E-mail received — counter-proposal ✓ valid (turn 1)                     │
│ ✓ 10:05:12 Deterministic check — requested feasible, HUMAN REQUIRED (policy)        │
│ → 10:05:16 Agent analysed — accept requested (3.4 s)                               │
│ ⚠ 10:05:16 HUMAN REQUIRED — waiting for approval                                   │
│ ✓ 10:06:02 Approved by Anna K. → ✉ Revised proposal sent — 450 Wed / 50 Fri         │
```

- **Behavior:**
  - Approve sends `{ updatedAt, counterMessageId, recommendationId }`. Reject sends `{ updatedAt, counterMessageId, recommendationId?, reason? }`; recommendationId is required only when a current recommendation exists. No quantity/date inputs.
  - Approve goes through `useConfirmDialog`, which shows the split to be sent and the moved-order count, and warns when the policy verdict is `human_required`.
  - Reject confirms disposition of the active counter (not a nonexistent recommendation); optional operator reason <= 500 chars. It is stored as restricted audit text and never sent to the model.
  - 409 uses the shared conflict/refetch UI. 422 uses the safe localized code (`agent_running`, `recommendation_stale`, `already_disposed`, `no_recommendation`, `not_approvable`, `turn_limit_reached`); `no_recommendation` applies to Approve, not a valid reject-counter request.
  - Live refetch every 3 s while `counter_received`; the API provides lease/recovery timing and available actions. A held-send panel references the existing pending message instead of offering a second Approve.
  - Buttons are hidden without `manage` and disabled while a mutation is pending.
  - The rationale renders escaped plain text in a collapsed disclosure, labelled untrusted.
  - The runs disclosure shows attempts: outcome, latency, tokens, model, prompt version, the input hash prefix. It never shows the key or raw provider errors.
- **Why not `DataTable` for options:** the options are a fixed ≤ 3-row comparison inside a detail card, not a paginated or filterable list. The shared `Table` primitive is used. The list page keeps `DataTable`.
- **Localization:** namespace `supplier_demo.supplyCases.*`, adding:
  - `status.counter_received`;
  - `reason.*`: counter rules/equality, `counter_evaluated_manual`, `counter_rejected`, turn limit, `auto_negotiation_disabled`, `auto_negotiation_disabled_send`, `auto_proposal_disabled_send`, agent failures/escalation, recommendation states, `revision_undone`, and `negotiation_state_invalid`;
  - `agentFailure.{timeout, rate_limited, provider_error, invalid_output, refusal, missing_config, run_cap_reached, principal_missing}`;
  - `negotiation.decision.*`, `negotiation.reasonCode.*`, `negotiation.option.*`, `negotiation.gate.*`, `negotiation.timeline.*`, `negotiation.actions.*`, `negotiation.errors.*`.

  pl and en must have identical key sets. Codes are the source of truth, and localisation is UI-only (Q11).
- **Design system:** `StatusBadge` `counter_received` = info. Recommendation verdicts: auto_approved success, approved success, rejected neutral, human required warning, agent unavailable warning. Semantic tokens only; verify light and dark, and 375 px.

## Data Models

### Migrations (Q-010)

1. Apply shipped `ai_assistant` migrations unchanged. The supplied draft reports 11; Phase 1 records the actual installed migration list/checksums before execution.
2. One additive Supplier migration: `supplier_demo_supply_messages.negotiation_record jsonb null` (plus generated metadata/snapshot).

No new run table, slot version column or index is pre-approved. Existing `status` text and `negotiation_turn` are reused. The usage adapter must implement claim-time reservation/finalisation on the installed ledger using its existing transaction and entity fields. A seam requiring additional DDL is a stop-and-ask gate, not implicit permission for a second schema change.

### `SupplyMessage.negotiation_record` v1

Initialise the **complete** shape below for a valid inbound counter. Do not write an undocumented `{state:'received'}` object and later claim it matches a strict schema. Schema validation occurs on every command write.

```text
{
  version: 1,
  counterRule: null | { ok, failed: null | C1..C6 | T1 },
  evaluation: null | {
    id: uuid, evaluatedAt, turnAtEvaluation, maxTurns,
    options: [{ ...Option, executionFingerprint, movedAllocations }]
  },
  agent: {
    state: 'not_started' | 'running' | 'succeeded' | 'failed' | 'skipped',
    nextAttemptNo: 1, activeRunId: null | uuid,
    skipReason: null | string,
    attempts: [{
      attemptNo, runId: uuid, evaluationId, startedAt, leaseExpiresAt,
      finishedAt: null | timestamp, latencyMs: null | number,
      configuredProvider, configuredModel,
      effectiveProvider: null | string, effectiveModel: null | string,
      promptVersion, effectiveSystemPrompt: null | string,
      systemPromptHash: null | string, effectiveMessagesHash: null | string,
      inputHash, input,
      auditState: 'claimed' | 'prepared' | 'complete' | 'incomplete',
      usageEventId,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: null | number,
               known: false, partial: false },
      providerRequestCount: 0,
      finishReason: null | string,
      outcome: null | 'ok' | 'timeout' | 'rate_limited' | 'provider_error'
              | 'invalid_output' | 'refusal' | 'missing_config' | 'principal_missing' | 'cancelled',
      errorCode: null | string, httpStatus: null | number,
      output: null | CounterDecision
    }]
  },
  recommendation: null | {
    id: uuid, evaluationId, source: 'agent' | 'deterministic',
    optionId, commitments, executionFingerprint, decision, reasonCodes,
    gates: { G1..G9: 'pass' | 'fail' | 'n/a' }, autoEligible, createdAt
  },
  dispatch: {
    state: 'none' | 'pending' | 'revision_pending' | 'held' | 'handed_off',
    recommendationId: null | uuid, revisedProposalMessageId: null | uuid,
    source: null | 'auto' | 'human', dueAt: null | timestamp,
    heldReason: null | string, handoffCheckedAt: null | timestamp
  },
  verdict: null | {
    kind: 'auto_approved' | 'approved' | 'rejected' | 'superseded',
    by: 'rule:supplier_policy' | userId | 'system', at, reason,
    revisedProposalMessageId: null | uuid
  }
}
```

Null outcome/effective metadata is valid **while running or before model resolution**. A recovered crash has a terminal timeout with whatever audit information was actually persisted; do not invent tokens/model output/prompt fields that were never observed. Cap/switch/rule pre-claim skips have no attempt or usage reservation; claimed model-resolution failures do.

Defaults permit 4 attempts per case; configured upper bound is 10 across **all** counters in that case, not 4 per counter. Bound each input to 8 KB, each effective system prompt to 16 KB, each rationale to 1000 chars, options to 3, and attempts to the per-case cap. Apply the existing retention/access policy; the record is restricted operational audit data, not guaranteed anonymous data.

`movedAllocations` use internal stable allocation/slot identities needed for execution fingerprints; never include names/order numbers in the **model input**. The code may re-resolve permitted local domain identities under lock for command execution. Reopen retains completed attempts and replaces only the active evaluation/recommendation/dispatch context.

Outbound revised proposal rows reuse `in_reply_to_business_id` and the envelope's `payload.negotiationTurn`. Counter dispatch/verdict retain the revision id and source so Retry cannot change authorisation or increment a turn twice.

### `SupplyCase` and slots

- `status` adds `counter_received`; needs-human reasons are enumerated consistently in API/UI/tests.
- `current_commitment` is the **latest proposed** commitment. First proposal remains in its immutable outbound envelope; final accepted/cancelled data remains in baseline fields.
- `negotiation_turn` increments once per queued revision and is restored by a safe pre-handoff Undo. This interpretation is pending joint acknowledgement, Q-204.
- `additional_cost` is cumulative across applied plans.
- Slot mutations occur only in the locked disposition command. Store both pre-state and post-state fingerprints with the command audit. Undo locks the same rows and requires matching post-state before restoring; otherwise 409 `undo_conflict`.
- Whole-slot snapshots remain a residual cross-case risk if **other** writers bypass locking/fingerprint checks. This spec safeguards its new Undo; it does not claim to repair the baseline's separate undo implementation.

### Fixture and baseline invariants

The resettable fixture has Wednesday capacity 450 with existing `SO-442` quantity 300 plus high-priority `SO-443` quantity 50, shiftable 6 h at 30 PLN/h with SLA due at Friday (+2 days); Friday remains capacity 400 and a new Saturday (+3 days) slot has capacity 100 with no allocations. D1 means the initial replan moves only normal-priority `SO-442` to Friday, leaving `400 Wed / 100 Fri`, +120 PLN, auto-approved. `--so442-priority high` still leaves the case human-required. All dates use UTC date-only semantics.

Required counter evaluations after that initial replan: `400 Wed / 100 Sat` is feasible with zero moves and `auto_approved`; `450 Wed / 50 Fri` is feasible only by moving high-priority `SO-443` and is `human_required`; `500 Wed` is infeasible, with `450 Wed / 50 Fri` as `alt_best_effort` and the current `400 Wed / 100 Fri` excluded from alternatives. `decline` is exercised through the real object runtime and ends at `needs_human/agent_recommends_decline` with no recommendation and Reject available. F5 remains unchanged.

Also preserve a separate Level-3 fallback fixture: `300 Wed / 200 Fri`, acceptance `300 Wed`, cancellation `200 Fri`, confirmation and final resolution without this negotiation agent. The `400/100` confirmation regression is not renamed Level 3. No new physical WMS movement or Sales synchronisation is added by this spec; the meaning of 1000 seeded frames versus reserved/available stock remains a baseline fixture dependency, not inferred here.

## API, Command, and Error Contracts

| Command / route | Input and permission | Success / next step | Failure and concurrency |
|---|---|---|---|
| `supply_message.receive_inbound` (existing) | Trusted hub context, baseline validation | Valid counter initialises full record, sets counter_received, emits counter_received | Frozen acceptance/rejection rules unchanged; v2 strict counter is the explicit compatibility delta |
| `supply_case.evaluate_counter` | System; `{caseId, supplyMessageId}` | Persist evaluation; phase-specific terminal/event tail | Case/counter locks; replay reconstructs missing next-step intent rather than creating another evaluation |
| `supply_case.run_counter_agent` | System; `{caseId, supplyMessageId, evaluationId, attemptNo}` | Claim then complete fenced attempt; needs-human or persisted auto dispatch | Claim-time budget/usage reservation; stale recovery before no-op; no state-only guard |
| `supply_case.recover_counter_processing` (new) | Trusted scoped scheduler, or delegated Retry | Apply RCV1-RCV6; explicit result code | No model call; same locking/identity rules; technical faults retry |
| `supply_case.send_revised_proposal` (undoable) | System auto, or manage human; `{caseId, counterMessageId, recommendationId, source, updatedAt?}` | One verdict/pending revision/turn + existing proposal_ready event | Case FIRST, fresh counter, slots; G1-G9/H1-H5; 409 stale version; 422 disposed/missing/stale/infeasible/not approvable/turn limit |
| `supply_case.reject_recommendation` | manage; `{caseId, counterMessageId, recommendationId?, updatedAt, reason?}` | Reject active counter; reason recommendation_rejected or counter_rejected | When recommendation exists its id must match; when absent omission is valid. 409 stale, 422 disposed/not rejectable; **not** no_recommendation for this valid action |
| `supply_case.reopen` (existing, extended) | manage; existing version input | New attempt via RCV5 or counter superseded -> actual waiting state | Every listed negotiation reason has a target. No 422 not_rerunnable for those needs-human states; unrelated baseline state guards unchanged |
| `supply_case.retry` (existing, extended) | manage; existing version input | Counter processing recovery or retry same held revision after switches restored | 409 stale; 422 agent_running with retry timing or explicit switch block; no silent no-op |
| `supply_message.send` (existing, extended) | Existing system/manage path | Threaded revised proposal through frozen hub composer/send/link path | Check both relevant switches at handoff. Block -> pending retained + needs_human/auto_proposal_disabled_send or auto_negotiation_disabled_send |
| `POST .../{id}/recommendation/approve` | Auth/manage/mutation guard; `{updatedAt, counterMessageId, recommendationId}` | 202 `{status, negotiationTurn, supplyMessageId}` | 400/403/404/409/422; quantity edits forbidden |
| `POST .../{id}/recommendation/reject` | Auth/manage/mutation guard; `{updatedAt, counterMessageId, recommendationId?, reason?}` | 200 `{status, disposition: 'counter_rejected'}` | Same scope/version checks; optional reason <=500 chars |
| `GET /api/supplier_demo/supply-cases/{id}` | Auth/view | Existing detail plus negotiation/rounds/active recommendation/dispatch, safe attempt summaries, `availableActions`, recovery timing | 404 other org; no secrets/raw errors; incomplete audit fields labelled unavailable |

Approve/reject paths use `/api/supplier_demo/supply-cases/{id}` as their prefix. Use per-method metadata, installed `OpenApiRouteDoc`, shared API helpers and mutation guards. Routes pass `updatedAt` as Date; commands compare milliseconds. Current version is checked under lock. Two simultaneous human Approves produce exactly one successful disposition; the loser receives 409 stale version or 422 already disposed, depending on which valid guard reports first. Two identical system events are idempotent no-ops after the first disposition.

**Undo contract.** A revision must still be pending/enqueue_failed with no `sending` claim, hub link, delivery or uncertain handoff. Lock case/counter/slots, compare stored post-state, then restore pre-state/case costs/turn, remove the unsent revision and invalidate dispatch/recommendation as appropriate; case -> `needs_human/revision_undone`. Refuse with 409 `revision_already_sent` or `undo_conflict`. Never restore a whole slot over a newer booking.

### Shared contract addendum v2 (Supplier-side decision 2026-09-19; joint freeze with the Manufacturer owner = Q-201)

**Unchanged:** the two-layer rule (human body + exactly one `SupplyEnvelope` block), the top-level keys, the markers, `schemaVersion: 1`, `correlationId`, ACCEPTANCE, COMMITMENT_CONFIRMED and REJECTION.

```text
SUPPLY_COUNTER_PROPOSAL   (Manufacturer → Supplier)   — payload becomes STRICT
payload: { "sku": "MAT-42",
           "inReplyToMessageId": "MSG-<latest Supplier proposal messageId>",   // mandatory (V11)
           "requestedCommitments": [{"quantity": 450, "date": "YYYY-MM-DD"},
                                    {"quantity": 50,  "date": "YYYY-MM-DD"}] } // 1–5 tranches; Σ = Σ current proposal (C3)

SUPPLY_PROPOSAL, revised  (Supplier → Manufacturer)   — first proposal UNCHANGED (byte-identical, pinned)
subject: Re: [SC-<orderNumber>] Delivery update — <SKU>         (threaded reply to the counter)
payload: { "sku": "MAT-42",
           "commitments": [{"quantity": 450, "date": "YYYY-MM-DD"}, {"quantity": 50, "date": "YYYY-MM-DD"}],
           "inReplyToMessageId": "MSG-<counter messageId>",      // mandatory on a revision
           "negotiationTurn": 1 }                                 // 1…maxNegotiationTurns
human:   "Following your counter-proposal, we can commit to: 450 pcs on <weekday date>, 50 pcs on <weekday date>
          for order SO-441 (revision 1 of 3). Please confirm or reply with a counter-proposal."
         (alternative: "…we cannot deliver the requested split; we can commit to: …")
```

- **Validation.** The Zod proposal payload gains optional `inReplyToMessageId` + `negotiationTurn`, and they must appear **together**. Our composer emits them only for revisions. The COUNTER payload is `.strict()` with `requestedCommitments` `.min(1).max(5)`.
- **Manufacturer obligations (Q-201).** The Manufacturer:
  - sends `requestedCommitments`;
  - accepts the two optional proposal fields;
  - answers a revision with the existing `SUPPLY_ACCEPTANCE` (`inReplyToMessageId` = the revision id; accepted + cancelled per date = the revised split, F3) or with another counter.
- The simulator emits exactly this addendum. A counter without `requestedCommitments` is now `schema_invalid`.

## Events, Jobs, Notifications, and Cross-Module Flows

All events below are local to the Supplier OM and include trusted tenant/organization context using the baseline event wrapper. Business data between companies still travels **only by real e-mail**.

| Event / job | Producer -> consumer | Durable identity / state | Replay and recovery |
|---|---|---|---|
| `supplier_demo.supply_case.counter_received` `{caseId, supplyMessageId}` | receive_inbound -> evaluate-counter | Stored active counter, evaluation nullable | Re-evaluate only when absent; otherwise reconstruct next intent |
| `supplier_demo.supply_case.counter_evaluated` `{caseId, supplyMessageId, evaluationId, attemptNo}` | evaluate/reopen/recovery -> run-counter-agent | Scheduled attempt identity | Old event cannot claim a new attempt; stale run recovered before generic no-op |
| `supplier_demo.supply_case.recommendation_ready` `{caseId, supplyMessageId, recommendationId, evaluationId, autoEligible}` | run completion/recovery -> negotiation-auto-send | Persisted `dispatch.pending` and recommendation | Two deliveries -> one disposition; lost delivery -> same event re-emitted |
| Existing `supplier_demo.supply_case.proposal_ready` | revision disposition/recovery -> existing send subscriber | Stored pending revision id, dispatch source | No second revision/turn; handoff switches rechecked |
| Existing hub sent/delivery_failed events | Hub -> baseline tracker | Same linked revision message | Preserve monotonic tracker behaviour and reconciliation |
| Existing `supplier_demo.supply_case.attention_required` | Negotiation/recovery/send commands -> notification subscriber | Persisted transition reason/version | One attention per transition, not per replay |
| Scoped recovery sweep, existing scheduler | Startup/tick <=15 s -> recover_counter_processing | Expired leases, missing next-step dispatch, pending revision intents | No new engine/table; finite batches, trusted scope; technical failures retry |

Declare new events in `events.ts`, use persistent subscribers and emit after transaction commit. `deliverInline: false` remains the baseline rule. Persistence of an event emission is not assumed atomic with the domain transaction: recovery uses the domain's stored intent. Expected business denials return structured results; **technical infrastructure errors are not swallowed** as successful subscriber execution.

## Configuration (env; no production secrets in the spec)

| Key | Default | Bounds / meaning | Validation |
|---|---|---|---|
| `OM_AI_SUPPLIER_DEMO_PROVIDER` | required | `openrouter` requested by owner | Verify installed per-module resolution |
| `OM_AI_SUPPLIER_DEMO_MODEL` | required | `meta/muse-spark-1.3-contributor` requested by owner | Verify live availability and complete object-output support before live rollout; no automatic substitution |
| `OPENROUTER_API_KEY` | owner secret | Runtime environment only | Offline selftests replace it inside an isolated child; live preflight reports present/valid only |
| Installed provider/model allowlist env keys | unchanged | Must allow the configured provider/model | Verify exact names in installed factory; never bypass allowlist |
| `SUPPLIER_DEMO_AGENT_TIMEOUT_MS` | 20000 | 1000-60000 | One attempt deadline, not a new timeout for each retry |
| `SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_CASE` | 4 | 1-10 | Claimed attempts across every counter of one case |
| `SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_DAY` | 50 | 1-1000 | Claimed ledger reservations per tenant/agent over rolling 24 h |
| `SUPPLIER_DEMO_AGENT_MAX_OUTPUT_TOKENS` | 4000 | 500-32000 | Supported SDK output cap in the live callback |
| `SUPPLIER_DEMO_MAX_NEGOTIATION_TURNS` | 3 | 1-3 | Revised proposals, subject to joint Q-204 definition |

There are **no tool-step or enable-tools configuration keys**. The agent is always toolless. The existing feature-toggle service owns `supplier_demo_auto_negotiation` and the existing proposal transport switch; do not add competing env switches with the same meaning.

The recovery sweep interval is an app setting on the existing scheduler job (<=15 s); stale lease margin is 30 s persisted with each claim. Verify the scheduler's actual resolution, jobs and permissions. Unsupported scheduling resolution blocks the recovery guarantee rather than silently lengthening it.

`lib/agent/config.ts` is a bounded pure parser. Runtime bad config yields a structured failure, never a guessed model. Offline preflight checks local configuration, permissions, module/schema/toggles, override absence and scheduler integration without network. `demo:preflight --live` additionally checks provider/key/model/connectivity with the owner's credential and required data-use/exposure acknowledgements. Live failures cannot be hidden as an offline success.

## Integration Coverage

**Evidence status:** the tests below are required implementation work, not tests executed by this document edit. All real-path scenarios use the same commands/transactions/validators as production on an isolated resettable demo tenant. They explicitly assert values and row counts, not merely that an object exists.

The harness drives post-commit steps intentionally and records emitted identities. It can stop before a model call or hub handoff without changing the production domain algorithm. The default model path runs the real `runAiAgentObject` with the toolless callback stub in a child process, dummy credentials and a provider-network blocker. `--with-send` and `--live` are separate explicit modes. Do not stop real shared workers or reset a non-fixture tenant implicitly.

| Test | Kind / phase | Required assertions |
|---|---|---|
| **TEST-201** | Unit + offline preflight, P1 | Config defaults/bounds; secret-safe output; no credential value or length printed; override row -> FAIL; no network in offline mode |
| **TEST-202** | `loop-real`, P1 | Existing replanned baseline `400/100` acceptance/confirmation path through real command bus + encrypted DB + ingest; replay -> one confirmation intent; preserve baseline F1-F5 slot semantics. This is a reply-path regression on a Level-4 fixture, not the minimum Level-3 numerical story |
| **TEST-203** | Unit, P2 | Strict counter missing/unknown keys, too many tranches; revised proposal fields paired; first proposal byte snapshot unchanged; text/plain with envelope accepted vs free-text-only rejected |
| **TEST-204** | Unit, P2 | C1-C6/T1 exact failure codes and boundaries |
| **TEST-205** | Unit, P2 | D1 fixture: `400 Wed / 100 Sat` feasible, zero moves, auto; `450 Wed / 50 Fri` feasible with high-priority move, human; `500 Wed` infeasible with `alt_best_effort 450/50` and current proposal excluded; baseline initial `400/100` +120 unchanged |
| **TEST-206** | `counter-eval`, P2/P3 | Real inbound/evaluation/rules: Phase 2 ends counter_evaluated_manual and emits no counter_evaluated; after Phase 3 the normal evaluator emits an attempt-specific event and the switch-off tail is explicit. Rejection/free text/invalid/turn-limit -> zero model attempts. Final harness may stop after evaluation, but must not label switch-off as Phase 2 |
| **TEST-207** | Unit, P3 | Whitelisted canonical input <=8 KB; body adversarial marker, e-mails, correlation id and order names absent from both input and captured prepared messages; stable hash |
| **TEST-208** | Unit, P3/P5 | O1-O4, feasible-requested fallback only, all G/H gates; informational confidence cannot override policy; H4 detects changed move/cost/risk fingerprint despite unchanged quantities |
| **TEST-209** | `agent-stub`, P3 | Same real object runtime; tools off; dummy child key/no network; valid output, decline with shortage context and no recommendation, malformed/unknown option, deadline, bounded 429 retry; separate missing-key child invokes no callback. One usage reservation per claimed attempt. Toggle off tested **here**, no LLM, feasible fallback or no recommendation. Replay exact event -> one claim |
| **TEST-210** | `approve-reject`, P3 | Current-version human disposition, stale 409, one revision and cumulative cost, consistent thread refs; reject with/without recommendation; pre-handoff Undo; safe Reopen targets |
| **TEST-211** | `negotiation-e2e`, P5 | D1 auto `400 Wed / 100 Sat`, human `450 Wed / 50 Fri`, decline/no-recommendation Reject path, revised acceptance/confirmation; max revisions; gates matrix; replay recommendation_ready twice -> exactly one revision/turn; lose its emission -> recovery re-emits same identity |
| **TEST-212** | API, P3/P4 | view/manage/other-org 403/404; mutation guard; missing/bad counter or recommendation ids; exact OpenAPI bodies and allowed actions |
| **TEST-213** | UI, P4 | Keyboard, light/dark, 375px, permission hiding; no-recommendation Reject counter; stalled Retry; held-send recovery; rationale HTML displayed as inert text; current-version refetch |
| **TEST-214** | Unit + CLI, P2 | Simulator prints correct v2 contract per scenario, latest case/proposal id, bare flags; does not claim a real-mail roundtrip when only injecting |
| **TEST-215** | Unit, P4 | Per-round timeline and recovery/held-send/unknown-usage entries; stable keys/order; no raw i18n placeholders |
| **TEST-216** | Opt-in live smoke, P3/MA | Toolless canonical synthetic input through live callback, 3/3 complete validated objects <= configured deadline; actual token availability recorded; no case/slot/commitment mutation. A usage/audit record is permitted; do not promise no DB writes while also requiring usage accounting |
| **TEST-217** | Runner unit, P3 | Live callback forwards actual AbortSignal and output cap to a cancellable fake SDK transport; original deadline includes retry; SDK retries disabled; switch rechecked before a physical retry; prepared audit persisted before request; abort actually observed; late promise cannot mutate state. No real provider network |
| **TEST-218** | `crash-recovery`, P3/P5 | Spawn worker, commit claim+ledger, kill it before completion; restart/sweep or Retry after lease -> failed/timeout + needs_human + one ledger reservation. Replay old event and late old completion -> no new claim or state regression. Lost eval/recommendation/proposal-ready event recovered from durable intent |
| **TEST-219** | `reopen-recovery`, P3 | failed/skipped -> Reopen -> fresh attemptNo/evaluationId -> actual new stub call; old event cannot claim new attempt. Caps/switch/request infeasible -> Reject counter works; Reopen supersedes and waits; no not_rerunnable dead end for listed states |
| **TEST-220** | `concurrent-approve`, P3 | Two independent DB entity managers/concurrent approvals for same recommendation; test both moved-slot and zero-slot variants. Exactly one succeeds, one revision/turn/cost change; loser 409 or already_disposed. No identity-map stale read |
| **TEST-221** | `send-toggle`, P3/P5 | Disable proposal switch after pending revision created but before hub handoff -> explicit held reason/attention, zero handoff. Repeat for negotiation switch on auto source. Restore+Retry reuses same message; replay sends once. Human source may bypass only negotiation switch, never proposal switch |
| **TEST-222** | `usage-caps`, P3 | Failures and killed attempts consume daily cap. Two cases race for last tenant budget slot -> only one claim/provider call. Finalisation updates reservation instead of second row; unknown usage labelled; no model call if ledger transaction fails |
| **TEST-223** | Planner unit, P2 | Later requested slot reservation blocks an otherwise tempting move destination; choose a later free slot or infeasible. Verify all requested tranches remain producible, no negative capacity/double reservation |
| **TEST-224** | Unit + real-path, P1/P3 | Tenant prompt/model overrides fail preflight and per-attempt check; effective prepared prompt hash/provider/model differ from config when intentionally scripted; failed-before-resolution fields are null, not invented |
| **TEST-225** | Activation/security, P1/P3 | Inventory enabled routes/ACLs/MCP; chat rejects object agent; test generic object route restriction or record reproducible controlled-demo residual exposure and require Q-206 before live rollout |
| **TEST-226** | Date + Undo, P2/P3 | UTC date at tenant-midnight boundary; shared F4 compatibility check. Concurrent other-case booking -> new revision Undo returns undo_conflict, no overwritten allocation |
| **TEST-227** | `level3-fallback`, P1 and all later gates | `300 Wed/200 Fri` -> accepted300/cancelled200 -> confirmation -> resolved; negotiation adapter off/unavailable does not block baseline; no negotiation model calls or replanning requirement introduced |

**Blocked harness.** The supplied draft/review report pre-existing `agent_examples` typecheck errors. Capture the exact diagnostic baseline and checkout before accepting an exception. New/changed diagnostics or any `supplier_demo` diagnostic fail the gate. Real-path selftests remain required; unexecuted `__integration__` files are labelled **not run**, never passed. A unit/DB selftest is not evidence of SMTP delivery, live provider latency or a real Manufacturer integration.

## Implementation Phases

### Delivery mode: continuous; explicit evidence boundaries

Preserve the owner decision to implement sequentially with automated per-phase gates and consolidate human checks after Phase 5. This changes the original roadmap's real-mailbox integration cadence; see the conformance section. Do not claim roadmap Level 5 complete before joint real-mail tests.

For every phase:
1. Record current commit/lockfile and re-read applicable repository `AGENTS.md` and routed guides. These files were not executed/read by this document-editing pass. Use the repo's AI workflow/module-data/extensions guidance, and backend-UI guidance for Phase 4; keep the installed extension contracts unchanged.
2. Run `yarn generate`, `yarn lint`, `yarn test`, `npx tsc --noEmit` separately and save outputs/exit codes. Only an exact recorded pre-existing diagnostic allowlist may be reported as `LOCAL_GATE_PASS_WITH_BASELINE_BLOCKER`; it is not a clean whole-repo typecheck. No new Supplier or indirect regression is permitted. Run `yarn ds:check` in Phase 4+.
3. Run phase real-path selftests and `demo:preflight --offline` with no FAIL. Live checks are separate owner-run gates; an absent real key is not repaired by reading the owner's `.env`.
4. Add compile-checked integration tests even while execution is blocked. Never replace crash/concurrency tests with a pure-function assertion.

**Pre-approved DDL:** shipped AI migrations plus exactly one nullable `negotiation_record` JSON column and generated metadata. Any extra schema statement, unsupported usage-ledger transaction/update seam, missing scheduling hook, or unsafe required runtime control is a stop-and-ask condition. The script must not claim a migration succeeded before running it.

**Secret rule:** production runtime is allowed to read configured credentials; the implementing assistant never inspects/echoes them. Test subprocesses may set **dummy** credentials and a test endpoint only. Live tests are explicitly run by the owner. These rules are not contradictory.

### Phase 1 - Adapter foundation, exposure inventory and real-path harness

- **Dependencies:** baseline reply/proposal implementation and resettable test tenant.
- **Outcome:** installed adapter activation is understood, local config is checkable, and baseline business paths have real DB tests. No live model call is required.
- **Deliverables:**
  1. Verify exact object-runtime/declaration/SDK exports, object callback arguments, model-factory env resolution and override stores. Treat the review observations as expected facts to check: object mode does not record usage and does not run untrustedInput moderation; its tools path bypasses the object callback. Record any installed-version mismatch.
  2. Verify the ledger can reserve/finalise with the transactional entity manager, existing fields and run/session identity. Verify the existing scheduler's recovery hook and <=15 s resolution. Unsupported seams are blockers, not guesses.
  3. Inventory routes/ACLs/MCP and object/chat exposure, TEST-225; choose supported restriction or leave Q-206 explicitly blocking live rollout.
  4. Activate `ai_assistant`, record/apply shipped migrations unchanged. Pure config parser, idempotent toggle setup/reset for **existing** as well as new tenants.
  5. Offline preflight: module/schema/config/allowlists/principal/override absence/scheduler; no provider network. Define explicit live preflight output without exposing secrets.
  6. Real-path harness under `cli/selftest/`: scoped commandBus, installed ingest, encrypted fixture, emit recorder, reset teardown and no accidental live hub send. Child-process test env/network blocker. Add `loop-real` and `level3-fallback`.
- **Slices:** activation+inventory; config+preflight; harness+baseline regressions.
- **Tests:** TEST-201, TEST-202, TEST-225 local inventory, TEST-227; TEST-224 preflight part.
- **Exit:** required command outputs; reset twice; offline preflight; both baseline selftests. Runtime evidence prerequisites documented. REQ-201 local part and REQ-210 harness part only.
- **Deferred live evidence:** MA-201/MA-202, not falsely closed here.

### Phase 2 - Contract v2 and deterministic evaluation, no LLM

- **Dependencies:** Phase-1 local gate.
- **Outcome:** strict counter parsing, requested capacity calculation and auditable options. Every evaluated counter ends `needs_human/counter_evaluated_manual`; no agent event and no Approve action yet.
- **Deliverables:** the one JSON-column migration/schema; v2 composer/parser; pure reserved-capacity planner; option/fingerprint/gate functions; supplied fixture delta explicitly marked pending joint scenario agreement; receive/evaluate commands and event; Reopen for manual/invalid/turn-limit outcomes; simulator and `demo:case` display.
- **Phase switch:** `counter_evaluated` may be declared but is **not emitted** in this phase. Phase 3 deliberately replaces the manual terminal tail. No kill-switch branch is required before an LLM/automatic-send branch exists.
- **Tests:** TEST-203-206, TEST-214, TEST-223 and UTC part of TEST-226; all prior baseline tests.
- **Exit:** `counter-eval` with exact values/reasons/no downstream event; baseline proposal snapshot and Level-3 fallback unchanged.
- **Requirements:** REQ-202 Supplier side and REQ-203; only rule/turn-limit parts of REQ-205.

### Phase 3 - Toolless runner, durable recovery, human disposition and send

- **Dependencies:** Phase-2 gate and verified usage/scheduler/runtime seams.
- **Outcome:** a human-approved negotiation precursor works end to end. This is **not yet autonomous Level 5**.
- **Deliverables:**
  1. `ai-agents.ts` only, no tools file; `lib/agent/{config,prompt,input,output,runner,usage}.ts` (or equivalent small isolated adapters), DI runner seam. Force `enableTools:false`.
  2. Real runtime object callback with propagated abort/output cap, no stacked SDK retries, effective prompt/model audit, per-attempt override guard, child-process stub and missing-key negative variant.
  3. Claim-time ledger reservation and scoped budget lock, fenced attempt state, lease expiry; result finalisation. Reopen resets active state and schedules a fresh identity. Caps count failed/crashed claims.
  4. **Replace** Phase-2 tail: valid evaluation plus switch on emits attempt-specific `counter_evaluated`; switch off creates requested fallback if feasible and `auto_negotiation_disabled`, zero model calls. Test this now, not only in Phase 5.
  5. Recovery command + existing scheduler startup/tick, lost evaluation/attempt event recovery, current-version Retry for counter_received; explicit timing and notifications.
  6. Locked human revision command, reject-counter-without-recommendation, complete Reopen table, routes/OpenAPI/guards. Lock case before counter/slots, including zero-slot options.
  7. Generalised send with explicit switch check/held reasons/retry of same message. Safe pre-handoff Undo with post-state comparison; no blanket toggle bypass.
  8. Live smoke command with **no tools flag**; explicit owner invocation and usage accounting; no domain mutation.
- **Tests:** TEST-207-210, TEST-212, TEST-217-222, TEST-224-226 applicable parts. Include subprocess crash/restart, two concurrent approvals and no-recommendation recovery.
- **Exit:** `agent-stub`, `approve-reject`, `crash-recovery`, `reopen-recovery`, `concurrent-approve`, `send-toggle`, `usage-caps`, plus earlier scenarios. Confirm no real provider network in offline tests.
- **Requirements:** REQ-204/206 and REQ-207 API; REQ-205 manual-run/recovery/switch part. Auto-dispatch replay/recovery is not closed until Phase 5.

### Phase 4 - Console and complete recovery actions

- **Dependencies:** Phase-3 gate.
- **Outcome:** operator sees real recommendation/absence, audit state, lease, held message and permitted actions. UI is not a separate process engine.
- **Deliverables:** small negotiation/recommendation/runs components, read API and `availableActions`, timeline, list status, shared mutation helpers, pl/en parity; explicit Reject counter when no recommendation; Retry for stalled processing; held-send guidance.
- **Tests:** TEST-213 and TEST-215 plus all earlier tests; design-system check, permission and responsive/light/dark/keyboard states.
- **Exit:** automated state/component tests, design-system/i18n gates. Browser checks remain MA-210.
- **Requirements:** REQ-208 and REQ-207 UI, pending manual UI evidence.

### Phase 5 - Autonomous Level 5 and dispatch recovery

- **Dependencies:** Phase-4 gate. Code/simulator work may proceed before the joint contract is acknowledged; real Manufacturer rollout may not.
- **Outcome:** G1-G9-approved options are revised without human intervention; other cases preserve the safe manual path.
- **Deliverables:** persist `dispatch.pending` before recommendation event; auto-send subscriber through the same locked command; recovery of lost recommendation/proposal-ready events; handoff switches and original authorisation source; per-round auto timeline; complete E2E tests and turn-limit messaging limitation.
- **Tests:** TEST-211 plus replay/lost-event extension of TEST-218 and auto-source TEST-221; full `--scenario all`.
- **Exit:** automated gates plus review of Q-201/Q-204 integration prerequisites. Completion of REQ-209 requires MA-207 and MA-211; no simulator-only success is labelled a real autonomous supply-chain demo.

### Final Manual Acceptance Run (owner; after Phase 5)

Preconditions: baseline mailbox/scheduler/thread-token runbook complete; owner sets the real model credentials; live preflight passes required capability/access/privacy checks; Q-201/Q-204 resolved and Q-203/Q-206 resolved before applicable live use. Q-205's D1 fixture amendment is implemented locally. No credentials are copied into this document or outputs.

| ID | Real-path check | Evidence required |
|---|---|---|
| **MA-201** | Live preflight | Key presence/validity and model capability verified without exposing value; enabled routes/override/scheduler checks recorded |
| **MA-202** | Toolless synthetic live smoke | 3/3 complete validated outputs within configured deadline; actual resolved model/prompt and known usage recorded; no domain mutation |
| **MA-203** | Deterministic evaluation with runtime switch off | Exact options visible, zero model calls, `auto_negotiation_disabled`. Do not call this Phase-2 behaviour; Phase-2 manual reason is covered at its own gate |
| **MA-204** | Human-risk `450/50` fixture | 3/3 human recommendation -> Approve -> threaded revision <=60 s excluding human think time -> acceptance/confirmation. This is a Supplier risk extension, not the canonical autonomous roadmap example |
| **MA-205** | Disposition/recovery | Reject with and without recommendation; Reopen allowed/disallowed rerun branches; stale second-tab conflict; clear route back to waiting |
| **MA-206** | LLM failure/recovery | Owner disables credential/network; failure reason, feasible deterministic fallback; separate case verifies restored-config Reopen actually calls a new attempt |
| **MA-207** | Autonomous agreed fixture | 3/3 counter -> threaded revised proposal <=60 s with zero clicks -> acceptance -> confirmation -> resolved; record actual e-mail count |
| **MA-208** | Kill switch and turn boundary | No new calls/auto handoffs when off; pending revision visibly held; restore+Retry same message; max-revision counter produces attention and disclosed partner-wait condition |
| **MA-209** | Adversarial mail | Prepared input/messages contain none of the body marker; behaviour driven only by validated envelope and computed facts |
| **MA-210** | UI | Keyboard, light/dark, 375 px, view-only permissions, no-recommendation actions, live status/recovery and escaped rationale |
| **MA-211** | Joint Manufacturer OM rehearsal | Acknowledged payload/turn/scenario contract; real counter -> revision -> acceptance -> confirmation, 3/3; private contexts remain separate |
| **MA-212** | Audit/accounting reconciliation | Every claimed attempt, including failed/crashed, has one ledger reservation; no double finalisation; effective fields/nulls and unknown tokens displayed honestly |
| **MA-213** | Level-3 fallback rehearsal | Baseline `300/200` full Manufacturer analysis/Caseload/approval/real changes and Supplier confirmation, 3/3 without negotiation; five-minute demo limit preserved |

A database test, injection simulator or live model smoke alone proves none of MA-211/MA-213. Final demo acceptance retains the roadmap's 3/3 level gates and 5/5 final rehearsals; delivery automation and business-level acceptance are separate labels.

## Hard lessons for the implementer (carried in from the previous delivery)

1. **Genuine gates.** Selftests assert explicit values on the real DB path (commands through `commandBus`, the encrypted fixture, inbound through `communication_channels.message.ingest_inbound`). "A status exists" or a pure function alone is not evidence. The LLM is stubbed only at the provider-call seam.
2. **No ambient transaction in persistent subscribers.** `ctx.transactionalEm` is undefined there, and pessimistic locks fail with "An open transaction is required". Wrap mutations in `em.transactional`; emit events after commit (`persistent: true`, `deliverInline: false`). **Never hold a transaction or lock across the LLM call.**
3. **Optimistic versions.** Routes pass a `Date`. Commands accept `Date` instances and compare `getTime()`; never `String(Date)`.
4. **Monotonic transitions.** Replayed event deliveries never create a second logical attempt/revision. Attempt identities fence old events after Reopen. Check stale recovery before a generic replay/no-op guard.
5. **Explicit, fail-closed validation.** Invalid or untrusted rows never reserve a dedupe id; untrusted mail stores no body and is capped (unchanged). New: invalid counters and the LLM never meet.
6. **Explicit reopen/undo tables.** Every negotiation needs-human reason has a recovery target. Undo refuses after handoff or newer slot changes; store both before/after fingerprints and message ids. Reject is permitted even when no recommendation exists.
7. **CLI hygiene.** Bare flags must parse. Correlation ids change after every `demo:reset` (`SC-SO-441-<n>`); tools default to the latest case and print what they did.
8. **UI.** Detail pages set `page.meta` `navHidden`. i18n templates never render raw `{placeholders}` for rounds that have not happened. OpenAPI uses the `OpenApiRouteDoc` shape. Every status, reason, decision, reason code and failure code has pl + en.
9. **Readable code.** No minification. New code follows the surrounding style and the linter; no new line over 140 characters. Selftest code lives in `cli/selftest/*.ts`, not in `cli.ts`. Existing long lines are not reformatted unless edited.
10. **Earlier lessons still apply:**
    - the query engine returns snake_case (prefer entity reads);
    - encrypted fields need `findWithDecryption` with scope;
    - encryption maps, toggles and role features in `setup.ts` only reach **new** tenants, so ensure them from `demo:reset` and check them in `demo:preflight`;
    - assign entity ids in code when they are referenced in the same transaction;
     - expected business conditions are structured results; technical DB/queue failures must reach the retry mechanism rather than be swallowed;
    - the hub send only enqueues (delivery = `communication_channels.message.sent`);
    - never compare jsonb as strings.
11. **Environment.** Set `OM_THREAD_TOKEN_SECRET` so the hub threads replies. The `resend` notification errors are unrelated noise.
12. **Shared-contract changes are joint.** Addendum v2 is the only permitted change. Anything else is a stop (earlier precedent: `cancelledQuantity` → `cancelledCommitments`).
13. **Secrets.** Runtime reads configured credentials; the implementing assistant never inspects or echoes their values. Offline test children always use dummy credentials and deny provider network. Missing-key negative tests explicitly omit that dummy. Owner-run live checks are separate.

## Requirement Traceability

| Requirement | Main contracts / surfaces | Phase | Tests / manual evidence |
|---|---|---|---|
| REQ-201 | Adapter, config, route inventory, preflight, toolless smoke | 1 + 3 | TEST-201, TEST-216, TEST-225; MA-201, MA-202 |
| REQ-202 | Strict counter and paired revision fields; first-proposal snapshot | 2 | TEST-203, TEST-214; Q-201, MA-211 |
| REQ-203 | C1-C6/T1, requested-capacity reservation, options/fingerprints | 2 | TEST-204, TEST-205, TEST-206, TEST-223, TEST-226 |
| REQ-204 | Toolless object runtime, safe input/output, enforced callback controls | 3 | TEST-207, TEST-208, TEST-209, TEST-217, TEST-224; MA-202, MA-209 |
| REQ-205 | Attempt fencing, claim-time ledger, RCV1-RCV6, switches, disposition recovery | 2 + 3; auto-dispatch part 5 | TEST-206, TEST-209, TEST-218, TEST-219, TEST-221, TEST-222; TEST-211 in Phase 5; MA-205, MA-206, MA-208 |
| REQ-206 | Prepared prompt/model audit, usage reservation/finalisation | 3 | TEST-209, TEST-218, TEST-222, TEST-224; MA-212 |
| REQ-207 | Case/counter/slot locks, H1-H5, reject counter, guarded Undo | 3 + 4 | TEST-208, TEST-210, TEST-212, TEST-213, TEST-220, TEST-226; MA-204, MA-205 |
| REQ-208 | Console/available actions/timeline, restricted rationale/audit, i18n | 4 | TEST-213, TEST-215; MA-210 |
| REQ-209 | G1-G9, durable dispatch, autonomous revision, agreed turns/fixture | 5 | TEST-211, TEST-218, TEST-221; Q-201, Q-204; MA-207, MA-211 |
| REQ-210 | Real-path harness/simulator/live separation/baseline regression | 1-5 | TEST-202, TEST-214, TEST-216, TEST-227 and all phase scenarios; MA-213 |

### Extension surfaces

| Surface | Reference / seam to verify in repository | Phase | Evidence |
|---|---|---|---|
| AI module activation | `src/modules.ts`, shipped migration registry | 1 | TEST-201, TEST-225 |
| Feature toggles | Existing `setup.ts` and reset paths | 1 + 3 | TEST-209, TEST-221 |
| Nullable negotiation record | Existing module migration/entity conventions | 2 | TEST-206 |
| Agent declaration | Installed `AiAgentDefinition` and `ai-agents.ts` discovery; no tools contribution | 3 | TEST-209, TEST-216 |
| DI callback and usage adapters | Existing `di.ts`; installed object callback/SDK/recorder/entities | 3 | TEST-217, TEST-222, TEST-224 |
| Counter events/subscribers | Existing persistent subscriber/event patterns | 2 + 3 + 5 | TEST-206, TEST-209, TEST-211 |
| Recovery job | Existing scheduler's supported app job registration/startup seam | 3 | TEST-218, TEST-219 |
| Undoable disposition | Existing commands and command-log snapshots | 3 | TEST-210, TEST-220, TEST-226 |
| Approve/reject/retry routes | Installed custom guarded-route/OpenAPI conventions | 3 | TEST-212 |
| Console delta | Existing SupplyCaseConsole and backend-ui references listed above | 4 | TEST-213, TEST-215 |
| CLI selftests/smoke/simulator | Existing CLI registration, small `cli/selftest/` files | 1-5 | TEST-202, TEST-214, TEST-216, TEST-227 |

Reference paths are implementation targets to verify, not evidence this editing pass inspected the repository. No reference-table row claims that an unavailable guide/skill or code sample was executed.

## Rollout, Migration, and Rollback

- **Activation order:** verify checkout/seams/exposure -> apply shipped AI migrations -> offline preflight and baseline regressions -> one additive Supplier migration -> subsequent code phases. Owner supplies real provider credentials only for explicit live checks.
- **Contract rollout:** local strict-v2 simulation may proceed before Q-201. Joint live negotiation waits for Manufacturer acknowledgement plus agreement on the turn definition and changed fixture. First-proposal/acceptance/confirmation contract remains unchanged; incompatible counters are explicitly classified, never parsed permissively to force a demo.
- **Exposure/data gates:** resolve Q-203 before sending business context to the selected provider; resolve Q-206 before exposing the registered agent to uncontrolled direct calls. Do not infer consent from module installation.
- **Safe rollback:** disable automatic negotiation; allow in-flight requests to abort/expire and run recovery; reconcile pending/uncertain sends. Undo only genuinely unsent revisions with unchanged slot post-state. Supersede/drain active counters before removing consumers. Keep baseline inbound/acceptance/confirmation working; do not remove the recovery consumer while its rows still need it.
- **Removing the adapter:** existing baseline business flow stays usable. A negotiation attempt requiring the missing adapter ends `agent_unavailable/missing_config`; no silent substitute model or live fallback.
- **DDL rollback:** the JSON column is additive; dropping it would destroy audit history and is not part of normal rollback. Never edit shipped migrations.
- **Observability:** structured logs use case/counter/run/attempt/evaluation ids, safe outcome codes and timing; never credentials, raw provider payloads or full model input. Authorized `demo:case`/console views show bounded audit records with unknown fields labelled.

## Risks and Tradeoffs

| Risk / limitation | Mitigation / required evidence | Residual boundary |
|---|---|---|
| Actual provider/model availability, capability or latency differs | Required model id retained; live preflight and synthetic smoke; deadline/fallback | This revision makes no current pricing, reasoning-tier or capability assertion |
| Provider retention/data-use terms | Minimise/pseudonymise, review actual terms/routing, Q-203 | Private schedules/costs remain business-sensitive; a prompt is not a retention control |
| Running claim or post-commit event lost | Fenced leases, durable dispatch, scheduler/startup recovery, TEST-218 | Recovery requires app/DB/scheduler availability; no downtime SLA fiction |
| Daily budget undercounts crashes or races | Claim-time reservation with tenant budget lock; failed claims counted; TEST-222 | Unknown provider token usage remains unknown; caps bound attempts, not exact bill amount |
| Alternate generic AI route bypasses app controls | Surface inventory, supported restriction or explicit Q-206 exposure decision; TEST-225 | Direct object calls otherwise bypass app-only caps/timeout/whitelist |
| Switch changes after planning but before send | Recheck at handoff, visible held reason, same-message Retry; TEST-221 | A handed-off/accepted e-mail cannot be recalled by a local toggle |
| Duplicate approvals/recommendation events | Fresh case lock even with zero slots; event/attempt fences; TEST-220 and TEST-211 | SMTP-wide exactly-once delivery is not promised; uncertain handoff is reconciled |
| Whole-slot snapshot Undo conflicts | Post-state comparison under locks, refuse undo_conflict; TEST-226 | Other legacy writers/undo paths may not follow these guards; baseline issue remains disclosed |
| Capacity move consumes a later requested tranche | Reserve every requested date before moves; TEST-223 | Planner remains a deterministic hackathon planner, not a general optimiser |
| No feasible recommendation | Reject-counter without recommendation; Reopen safe fallback; TEST-219 | A manual business resolution may still be needed |
| Turn limit or local rejection leaves Manufacturer waiting | Visible reason, explicit manual coordination in J-203; Q-204 turn agreement | No automatic Supplier rejection e-mail in fixed scope |
| D1 Level-5 fixture | Independent initial-plan regression and the three-case counter matrix | Initial `400 Wed / 100 Fri` is auto-approved at +120 PLN; `450 Wed / 50 Fri` is feasible but human-required because SO-443 moves; `500 Wed` gets `450 Wed / 50 Fri` as best effort |
| Supplier-local approval and app-owned workflow | Mark architectural/scenario exception; preserve native Manufacturer approval requirements | Do not claim a native Agent Orchestrator/Caseload implementation on Supplier |
| Only simulator tests completed | Separate database/stub/live mailbox/joint evidence statuses | No whole-chain Level-5 sign-off until MA-211 |
| Whole-repo harness/typecheck blocker | Exact pre-existing diagnostic baseline and explicit exception; no new diagnostics | Unrun integration/browser/live tests remain pending |
| Other orders stay moved after a later revision no longer needs it | Preserve documented simplification and show audit | Suboptimal capacity use, not a silent extra replan |

## Acceptance Criteria

- [ ] **AC-201** - Offline preflight/selftests need no real provider key; owner-run live preflight/smoke prove the requested model/configuration. No credential values/lengths leak. All runtime/exposure/data gates are recorded honestly.
- [ ] **AC-202** - Strict v2 counter validates agreed fields; revision includes paired parent/turn fields; first-proposal snapshot is unchanged. Manufacturer acknowledgement precedes joint live use.
- [ ] **AC-203** - Deterministic fixture options and C1-C6/T1 outcomes are exact; later requested capacity is protected; UTC dates agree with the baseline feasibility helper. Invalid/rejected/free-text-only messages produce zero negotiation model calls.
- [ ] **AC-204** - Agent is toolless in declaration and invocation; one provider-callback seam in production/selftest; no raw mail/customer identifiers in input or prepared messages; output selects existing options only. Live callback propagates abort/output cap and disables stacked SDK retries.
- [ ] **AC-205** - Live failures settle by deadline+5 s; stale claims recover by lease+sweep while infrastructure is available. Killed-process and lost-event tests pass. Reopen actually schedules a new fenced attempt when allowed; otherwise it supersedes/waits. No-recommendation Reject works. Replayed events never create duplicate logical claims/revisions. Disabled handoff is visible, not a silent hold.
- [ ] **AC-206** - One usage row is reserved atomically at **claim**, including failed/crashed attempts in the daily limit; completion updates it, never appends another. Concurrent last-budget claims are serialized. Effective model/prompt audit is captured when available; pre-resolution fields stay null/unknown rather than falsified.
- [ ] **AC-207** - Competing approvals with independent entity managers yield one revision/turn/cost mutation, including zero-slot variants. Fresh case/counter/slot locks and H1-H5 apply. Reject active counter without recommendation succeeds. Safe Undo refuses after handoff or newer slot state. Accepted revised commitment resolves through baseline confirmation.
- [ ] **AC-208** - Console exposes correct actions for recommendation, no recommendation, running/stale, held-send, turn-limit and terminal states, with pl/en parity, safe rationale/audit, permissions and required keyboard/light/dark/responsive states.
- [ ] **AC-209** - The jointly agreed within-policy counter is handled autonomously, real threaded revision <=60 s and full acceptance/confirmation 3/3. G1-G9 matrix and duplicate/lost recommendation events pass. Turn counting and actual e-mail count match the joint contract, not a misleading three-mail claim.
- [ ] **AC-210** - All real-path selftests, including crash/rerun/concurrency/usage/toggles/undo and separate Level-3 `300/200` fallback, pass. Required live and joint manual evidence is recorded separately; an unrun integration test is never labelled passed.
- [ ] Every listed changed UI/API surface follows the verified repository conventions and required states. The canonical installed reference is identified during implementation, not claimed reviewed solely from this document.
- [ ] Any permitted whole-repo diagnostic/harness exception is pinned to recorded baseline evidence. No new Supplier or indirect regression is accepted. The final app test suite, mailbox test and joint rehearsal are not asserted by this document revision.

## Re-Review Resolution Matrix

**Status for every row: corrected in this specification; implementation/evidence pending.** Reviewer numbering is retained.

| Finding | Specification resolution | Required proof |
|---|---|---|
| **R1 Critical** - Stale running/lost recommendation strands case | Lease/recovery checked before no-op; Retry from counter_received; existing-scheduler sweep/startup; durable dispatch intent | TEST-218, TEST-211; RCV1-RCV6 |
| **R2 Critical** - Reopen cannot rerun failed/skipped | Reset active state, retain history, new attemptNo/evaluationId, event fencing; claim guard not state-only | TEST-219 |
| **R3 Critical** - Stub needs key / tools bypass | Child env always overrides real key with dummy; missing-key test separate; tools off everywhere; provider-network guard | TEST-209, TEST-217 |
| **R4 High** - Runtime does not enforce caps/deadline | Runner-owned callback forwards AbortSignal/output cap; single deadline/retry; late-result fencing | TEST-217 |
| **R5 High** - Remove redundant tools | Toolless declaration/call; all tool files/flags/smoke variants removed from deliverables and traceability | TEST-209, TEST-216 |
| **R6 High** - No recommendation dead end | Reject targets active counter; Reopen falls back to actual waiting state when rerun disallowed | TEST-210, TEST-219 |
| **R7 High** - Concurrent approves duplicate send | Case lock first, fresh counter, slots sorted; zero-slot path also locked | TEST-220 |
| **R8 High** - Audit wrong prompt/model | Effective prepared prompt/hash/model/provider, null before resolution; preflight+runtime override rejection | TEST-224 |
| **R9 Medium** - Daily cap misses failures | Usage reservation at claim, atomic with attempt, same-row finalisation, tenant budget lock | TEST-222, TEST-218 |
| **R10 Medium** - Moves steal later requested capacity | Reserve all requested production before destination selection | TEST-223 |
| **R11 Medium** - Pending revision silently held | Handoff recheck and needs_human/*_disabled_send; source-preserving same-message Retry | TEST-221 |
| **R12 Medium** - Phase-2 ambiguity | Own counter_evaluated_manual reason, no agent event/no Approve; explicit Phase-3 replacement | TEST-206 |
| **R13 Medium** - Switch tested too late | Branch delivered and tested in Phase 3 agent-stub; auto event replay tested in Phase 5 | TEST-209, TEST-211 |
| **R14 Medium** - Extra module surfaces | Route/ACL/MCP inventory; object-only chat denial; generic-object restriction or explicit live-gating exposure decision | TEST-225, Q-206 |
| **L1 Low** - Timezone mismatch | UTC date-only definition; shared baseline F4 compatibility gate | TEST-226 |
| **L2 Low** - Undo overwrites other case | Guard new Undo with post-state fingerprint; disclose remaining baseline writer risk | TEST-226 |
| **L3 Low** - Turn limit leaves peer waiting | Explicit J-203/manual coordination limitation; do not label local Reopen a business resolution | Q-204, MA-208 |
| **L4 Low** - Object-mode usage treated as question | Record reviewer observation as expected fact; require explicit app ledger writes | Phase 1 seam check, TEST-222 |
| **L5 Low** - Irrelevant object moderation check | Remove moderation/API-key check; use strict context/output controls instead | Agent Contract, TEST-207 |

## Roadmap Conformance and Explicit Deviations

Sources: final roadmap sections 1, 10-16, 18-27, 30, 37-39; minimum sections 10-18, 24, 27-29. The earlier playbook's shared dashboard is superseded by the final roadmap.

| Topic | Assessment against the supplied docs | Treatment in this spec |
|---|---|---|
| Two independent firms/private context/real e-mail | Aligned with final roadmap sections 1/7/20 | No shared business DB/backend, no hidden inter-company API; local recovery events only |
| Calculation, policy, controlled execution | Aligned in responsibility: deterministic planning, policy and commands | Model selects option id; no quantities/actions from free text; confidence informational |
| Native workflow/orchestrator | **Explicit implementation deviation** from minimum sections 17-18 (`INVOKE_AGENT`, `WAIT_FOR_SIGNAL`) and original platform plan | Preserve Q-002: app commands/subscribers+ai_assistant, not native workflows/orchestrator. Do not advertise this as native Supplier Orchestrator/Caseload reuse |
| Level 3 fallback | Required by both final docs | Separate 300/200 no-negotiation regression and MA-213; no extra model dependency. Existing 400/100 regression is not substituted for it |
| Level 4 | Initial numerical story retained | Regression 300/200 -> 400/100, +120 PLN; no changes to original planner behaviour |
| Level 5 fixture | **Owner decision D1**: the initial proposal is `400 Wed / 100 Fri` at +120 PLN; the counter matrix separately covers human-required `450 Wed / 50 Fri` and best-effort `450 Wed / 50 Fri` for an infeasible `500 Wed` request | The fixture amendment is implemented and covered by unit and real-path selftests; this remains a Supplier-local scenario, not a claim of exact roadmap fixture identity |
| Level 5 completion | Autonomous negotiation required | Manual Phases 3-4 are precursors, not completed Level 5; only Phase 5 + joint real-mail evidence qualifies |
| Turns and e-mail count | **Interpretation not fully frozen**: roadmap says maxNegotiationTurns=3; earlier playbook example counts three e-mails | Here turn means revised proposal. One cycle with explicit acceptance/confirmation is initial + counter + revision + acceptance + confirmation = 5 mails; three cycles can be 9. Q-204 must freeze interpretation. Never claim three total mails for this extended loop |
| Human approval | Roadmap main Level-6 show has one Manufacturer Caseload decision; Supplier policy still allows exception escalation | Supplier-console approval is an exception/manual test path, not a replacement for Manufacturer Caseload or the main Level-6 boundary |
| Supplier C / Level 6 | Out of scope for this Supplier delta | Do not claim Level-6 completion from this spec; Manufacturer still owns alternative supply/approval and final secured-customer outcome |
| Gates/rehearsal cadence | Owner's continuous delivery defers manual checks; original roadmap uses frequent integration checkpoints | Preserve owner delivery mode but label local/stub evidence separately. Joint 3/3 and final 5/5/<=4:45 rehearsal obligations remain |
| Stock / Sales | No new physical inventory or Sales effects in this delta | Commitment/slot mutation is real local domain state, but does not establish full WMS/Sales synchronisation. Verify baseline meanings of stock, reservation and availability |

**Conformance conclusion:** the business separation and safety responsibilities are aligned; this is **not an exact 1:1 implementation of every original platform and demo choice**. Q-002 is an existing owner-authorised implementation exception. Q-201/Q-204 still gate the joint contract/scenario; native Manufacturer approval and a working independent Level-3 fallback remain required, not waived.

## Final Compliance Report

| Check | Document-review status | Runtime / implementation status |
|---|---|---|
| Supplied architectural findings R1-R14/L1-L5 addressed | Corrections and tests mapped above | Not implemented or executed by this editing pass |
| State/API/record/events/UI/testing descriptions | Reconciled in this revision; automated document checks supplied separately | Must be checked against installed source and then tested |
| Toolless single callback with enforceable controls | Required consistently; obsolete tools deliverables removed | Actual SDK cancellation/output-limit forwarding remains TEST-217 |
| Durable recovery, claims, usage and concurrency | Explicit algorithms/locks/identities and acceptance tests | Transactional ledger/scheduler seams require verification |
| Native reuse vs app-owned extension | Dependencies and exceptions identified | No unavailable guide, AGENTS.md or repository source was falsely marked read |
| Roadmap match | Principles aligned; explicit deviations/gates recorded | Joint agreement and real-mail evidence pending |

**Verdict:** `Revised specification - ready for owner/reviewer re-review, not an implementation PASS`. Owner approval is still required at gate 7. Q-201/Q-204 gate joint live negotiation; Q-203/Q-206 gate applicable live data/exposure. Q-205's fixture amendment is resolved locally. A missing installed seam is a blocker even after document approval.

## Implementation Status

Target repository file: `.ai/specs/2026-09-19-supplier-ai-reply-orchestrator.md`.

Implementation is being continued in the current working tree under the continuous delivery mode above. Phases 1-5 have local automated evidence; no live mailbox, provider call, joint contract check or repository branch/commit has been created.

| Phase | Implementation state | Dependency | Blocking local evidence |
|---|---|---|---|
| 1 - Adapter foundation + harness | Complete (local) | Baseline specs/code available to implementer | Live MA-201/MA-202 and Q-206 remain owner-gated |
| 2 - Contract + deterministic evaluation | Complete (local) | Phase 1 local gate | counter-eval, reserved-capacity/unit/contract regressions passed; live/joint contract remains owner-gated |
| 3 - Runner + recovery + human disposition | Complete (local) | Phase 2 local gate | usage reservation/finalisation is app-owned in `SupplyMessage.negotiation_record.agent.attempts`; no new schema or `ai_assistant` change |
| 4 - Console | Complete (local) | Phase 3 local gate | Components/timeline/i18n/design-system checks passed; browser/manual evidence remains owner-gated |
| 5 - Autonomy + durable dispatch | Complete (local) | Phase 4 local gate | auto replay, idempotent disposition and held handoff passed locally; joint acceptance separately gated |

### Phase 1 progress

- [x] activation + exposure inventory: `src/modules.ts`, `src/modules/supplier_demo/index.ts`, `src/modules/supplier_demo/lib/agent/exposure.ts`, and `demo:ai-exposure` record the installed `ai_assistant` activation, chat/object/MCP surfaces, and Q-206 live gate (TEST-225 local inventory) — `yarn generate`, `yarn test --runInBand`, and `yarn lint` passed; `yarn typecheck` reported only the pre-existing `agent_examples` baseline diagnostics.
- [x] config + preflight: bounded config, idempotent toggle setup/reset, tenant-scoped AI schema/override/allowlist inspection and secret-safe offline output are implemented; preflight with dummy non-secret values passed config, modules, scheduler, schema, scope, allowlist and blocked-network checks (agent registration remains phase-3 work).
- [x] real-path harness: `src/modules/supplier_demo/cli/selftest/real-path.ts` is wired to `demo:selftest` with `loop-real` and `level3-fallback`; both passed after two reset runs, and `demo:selftest --scenario all` passed. No real mailbox or LLM call was run.
- [x] Phase 1 automated gate: `yarn generate`, `yarn lint`, `yarn test --runInBand`, and `yarn typecheck` executed; typecheck contains only the recorded pre-existing `src/modules/agent_examples/**` diagnostics. Offline preflight passed with dummy provider/model values and blocked provider network.

### Phase 2 progress

- [x] strict v2 envelope/parser and paired revision metadata: proposal snapshot remains unchanged; counter payloads reject unknown fields and malformed commitment lists; contract tests pass.
- [x] deterministic C1-C6/T1 validation, reserved-capacity planning, policy options and execution fingerprints are implemented with unit coverage.
- [x] transactional `receive_inbound`/`evaluate_counter` path persists the JSON negotiation record, sets `needs_human/counter_evaluated_manual`, emits no negotiation agent event, and is idempotent under replay.
- [x] Phase 2 automated gate: `yarn generate`, `yarn lint`, `yarn test --runInBand`, and `yarn typecheck` executed; `demo:preflight --offline`, two `demo:reset` runs, `demo:selftest --scenario counter-eval`, `loop-real`, `level3-fallback`, and `all` passed. Typecheck remains limited to the recorded pre-existing `agent_examples` baseline diagnostics; no Supplier diagnostic was introduced.
- [x] D1/D2 continuation: the reset fixture now restores Wednesday capacity 450 with SO-442 plus high-priority SO-443, unchanged Friday capacity and a free Saturday 100 slot; unit and real-path checks cover `400 Wed / 100 Sat` auto approval, `450 Wed / 50 Fri` human-required SO-443 movement, infeasible `500 Wed` with best effort `450/50`, and decline with no recommendation plus human Reject. `yarn test --runInBand`, `yarn generate`, `yarn lint`, `npx tsc --noEmit` (only the recorded `agent_examples` diagnostics), `demo:reset`, and `demo:selftest --scenario all` passed.
- [x] Phase 3 seam decision: per owner direction, claim-time reservation, daily/case caps, failed/crashed accounting and stale-run recovery live in `SupplyMessage.negotiation_record.agent.attempts`, protected by the locked `SupplyCase` row plus `pg_advisory_xact_lock('supplier_demo.counter_negotiator:' + tenantId)`. `ai_token_usage_events` remains a post-finalisation, one-row-per-run report keyed idempotently by `sessionId = runId`.
- [x] Phase 3 implementation seams: toolless agent declaration, bounded runner, claim/finalise/recovery path, missing-config terminal outcome, locked human approve/reject, reopen fencing, usage-report backfill, held-send switch check, and scheduler recovery command are implemented locally.
- [x] Phase 3/4 local surface work: approve/reject routes, detail negotiation projection, `availableActions`, pl/en reason coverage, and the autonomous dispatch/recovery seam are generated and design-system checked.
- [x] Phase 3 automated exit evidence: named `agent-stub`, `approve-reject`, `crash-recovery`, `reopen-recovery`, `concurrent-approve`, `send-toggle`, and `usage-caps` scenarios each passed through the real local database path after reset; no provider/mailbox call was made. `concurrent-approve` proved a single revision plus 409 fencing, and `send-toggle` proved the pending revision/attention held path with override restoration.
- [x] Additional local evidence: `yarn generate`, `yarn lint`, `yarn test --runInBand`, `yarn ds:check`, `demo:reset`, `demo:selftest --scenario counter-eval`, `demo:selftest --scenario all`, `demo:selftest --scenario concurrent-approve`, and `demo:selftest --scenario send-toggle` passed with dummy configuration; production compilation passed and the final checker reported only the pre-existing `src/modules/agent_examples/**` baseline diagnostics.
- [x] Phase 5 local send guard: `demo:selftest --scenario proposal-send-toggle` passed with the proposal switch disabled, proving a pending revision is retained with `needs_human/auto_proposal_disabled_send`; the command also recomputes and fences a stale execution fingerprint before approval. Autonomous replay/lost-event evidence is covered by `auto-recovery` below.
- [x] Phase 5 local autonomous/recovery evidence: `demo:selftest --scenario auto-recovery` passed with an auto-eligible stub recommendation, one recovered recommendation event, one `auto_approved` revision, and a second sweep returning zero recovery; the proposal switch prevented any handoff. No live provider/mailbox or joint acceptance was run.

## Open Questions

| ID | Decision / question | Owner | Status / gate |
|---|---|---|---|
| Q-001 | One spec; autonomy last | Supplier owner | Preserved from supplied owner decisions |
| Q-002 | Installed ai_assistant adapter, app-owned orchestration | Supplier owner | Preserved; explicitly documented deviation from native workflow/orchestrator plan |
| Q-003 | Valid counters + local deterministic context only; no raw mail/rejections to model | Supplier owner | Preserved |
| Q-004 | OpenRouter requested model; 20 s deadline; 4 attempts/case; default 3 revisions | Supplier owner | Preserved. Obsolete example tool-step limit removed because reviewer requires a toolless call |
| Q-005 | Deterministic feasibility/policy and G1-G9, no confidence authorisation | Supplier owner | Preserved; handoff switch recheck is mandatory |
| Q-006 | requestedCommitments -> revised SUPPLY_PROPOSAL; mandatory parent id | Both owners | Supplier choice preserved; joint acknowledgement Q-201 pending |
| Q-007 | Minimal pseudonymised structured context | Supplier owner | Preserved, with sensitivity/retention claims corrected |
| Q-008 | Fail to explicit needs_human; no guessing/silent send | Supplier owner | Preserved and made recoverable |
| Q-009 | Approve/Reject, no quantity editing, Supplier console | Supplier owner | Preserved; Reject may target the counter with no recommendation |
| Q-010 | Reuse installed ledger; shipped migrations + one JSON column | Supplier owner | Preserved conditionally on verified atomic reservation/finalisation seam; extra DDL requires separate approval |
| Q-011 | Codes are truth; English inert rationale; pl/en UI | Supplier owner | Preserved |
| **Q-201** | Acknowledge strict COUNTER/revised PROPOSAL contract v2 and compatibility boundary | Manufacturer owner + Supplier owner | **Pending; blocks joint live negotiation/MA-211**, not isolated local simulation |
| **Q-202** | Keep deterministic requested fallback when feasible after failure/off/escalation | Supplier owner | Pending; supplied draft default keep retained. Removing it does not remove Reject/Reopen recovery |
| **Q-203** | Accept actual provider/routing data-use terms for intended context | Supplier owner | **Pending before live business data**; no claim model name implies retention guarantee |
| **Q-204** | Jointly define turn as revised proposals, default max3, and truthful actual mail count | Both owners | **Pending; blocks joint Level-5 sign-off**. Different definition requires explicit contract/counter/test amendment |
| **Q-205** | Fixture amendment: adopt D1's `450 Wed` slot with SO-442 plus high-priority SO-443, unchanged Friday, and new Saturday capacity; keep initial `400 Wed / 100 Fri` auto-approved and cover `450/50` and `500 Wed` in the counter matrix | Supplier owner | **Resolved 2026-09-19**; exact roadmap fixture identity is not claimed |
| **Q-206** | Restrict generic object route or explicitly accept controlled-demo bypass exposure | Supplier owner | **Pending before live rollout** if supported restriction cannot be verified; inventory alone is not approval |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Original draft recorded owner Q1-Q11, option-id-only model output, private structured context, app-owned orchestration, JSON audit storage and a changed negotiation fixture. Historical repository/provider verification claims belong to that draft's author, not this editing pass |
| 2026-09-19 | Interrupted revision had partially introduced toolless calls, abort callback, case locking, recovery and prompt audit, but old requirements/tests/API/phase descriptions still contradicted those edits |
| 2026-09-19 | Consolidated supplied architectural re-review R1-R14 and L1-L5 across requirements, rules, state machine, schemas, APIs, events, tests, phases and acceptance criteria. Added fenced durable recovery, real rerun identity, isolated stub env, enforced callback deadline/output limits, claim-time usage reservation, concurrency-safe disposition, held-send switch semantics, protected later capacity, effective prompt/model audit and route-exposure gate |
| 2026-09-19 | Removed tools files/flags/smoke variants and unsupported pricing/retention assertions; clarified nullable in-flight audit fields, technical retry errors, safe Undo and UTC date-only policy. Preserved owner decisions and isolated baseline acceptance/confirmation regressions |
| 2026-09-19 | Added explicit roadmap conformance matrix: app-owned versus native orchestration, changed Level-5 fixture, revision-based turn count/e-mail count, Supplier exception approval versus Manufacturer main-demo Caseload, and separate Level-3 fallback. Marked implementation and live evidence pending rather than unconditionally Ready for implementation |
| 2026-09-19 | Code review of the full implementation (Phases 1-5) with fixes applied. The recovery sweep no longer calls the model: it only settles expired leases, back-fills usage and re-emits overdue events for the case's current undecided counter (before, it re-ran the LLM every minute on failed, rejected and superseded counters, even with the switch off, and a claim could pull a moved-on case back to needs_human). Approve now requires an undecided, current counter in an approvable state, re-checks the negotiation switch (G7) and G9 on the automatic path, settles business failures to needs_human instead of throwing in the subscriber, applies the plan's slot moves and cumulative cost, and pins the recommendation id; Reject refuses an already approved counter. The evaluator no longer offers the current proposal as an "alternative" (it now computes the greedy closest split within policy / best effort), uses the declared shift window, never moves a non-shiftable allocation and evaluates the policy on cumulative cost. The model input is pseudonymised (no order numbers, slot ids or fingerprints); the output gains the enum reason codes, rationale, informational confidence and the O2 decision/option check, and escalation falls back to the deterministic requested split. The case stays counter_received while the agent runs (no false attention); agent results are fenced on the active run and case status; the per-case cap counts all counters and the daily cap is a rolling 24 h. Reopen never dead-ends (re-run only when possible, otherwise supersede and wait on the latest proposal's real transport state; held sends go through Retry), Retry recovers counter_received and held revisions, revised proposals are threaded as replies to the counter, and the missing pl/en reasons were added. `demo:selftest --scenario all` now runs every real-path scenario, with explicit 450/50 expectations. Known gaps at that review: `send_revised_proposal` Undo was not implemented and simulator counter scenarios were not implemented; the D1/D2 continuation below resolves the fixture delta and adds the real/unit matrix. |
| 2026-09-19 | Live-test fix. Every real model call failed with `AgentPolicyError`: the runner passed a per-call `loop` override while the agent forbids runtime loop overrides, so the runtime rejected the call before OpenRouter. The per-call `loop` is removed (the agent definition keeps maxSteps 1), with a regression test. The selftest stub now goes through the real `runAiAgentObject` and replaces only the provider call (its old stub replaced the whole runtime, which is why the bug was not caught); without a key it uses a process-local placeholder and an unreachable base URL. Added the spec's owner-run `demo:agent-smoke --live [--runs 3]` (TEST-216/MA-202): 3/3 OK on `meta/muse-spark-1.3-contributor`, 5.5-11.5 s, about 640/560-880 tokens. Failed attempts now record `errorCode` = `<outcome>:<error name>` and `httpStatus`, and the runner logs a sanitised message. Operational notes: run `demo:selftest` with `yarn dev` stopped, otherwise the dev workers consume the selftest events (live LLM calls, real e-mails); `OM_HUB_POLL_SCHEDULER_TICK_SECONDS` must be at least 60 because the installed scheduler rejects shorter intervals |
| 2026-09-19 | Owner decisions D1/D2 continuation: stock uses the shipment-date slot for every requested unit while F5 stays unchanged; the fixture now uses Wednesday 450 with `SO-442` plus high-priority `SO-443` 50, unchanged Friday, and a new Saturday 100 slot; prompt `supplier-counter-v2` carries numeric shortage context, supports `decline` with `optionId: null`, and real/unit tests cover the D1 three-case evaluation matrix plus the no-recommendation human Reject path |
