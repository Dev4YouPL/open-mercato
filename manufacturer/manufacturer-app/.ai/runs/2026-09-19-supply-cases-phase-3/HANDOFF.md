# Phase 3 implementation handoff

**From:** new sol / FINAL REVIEW + FIX  
**To:** next Phase 3 implementation agent  
**Status:** BLOCKED  
**Date:** 2026-09-19 — implementation pass closed

## Final implementation status

Full Phase 3 is **not done**. P3-01 has a reviewed offer-validation/CAS core and P3-03 has a
reviewed pure deterministic builder, but its durable final-analysis/plan persistence is missing.
P3-02 has only the command/event persistence seam. P3-04, P3-05, P3-06 and P3-07 remain blocked or
incomplete because Phase 2 has not passed its exit gate.

## Completed slices and files

- P3-01: `data/types.ts`, `data/errors.ts`, `data/repositories.ts`, `data/json/store.ts`,
  `lib/resolution/offer.ts`, `commands/record-alternative-offer.ts`.
- P3-03: `lib/resolution/plans.ts`, `lib/resolution/stockPolicy.ts`, final-facts and plan schemas
  in `data/types.ts`.
- Redacted event: `events.ts`, `supply_cases.alternative_offer.received`.
- Focused coverage: `__tests__/phase3-resolution.test.ts`.

The repository CAS is scoped and serialized by the existing JSON collection lock. Same source
message plus same hash returns `already_recorded` even when the caller has an old version; a
different offer raises `offer_conflict`; a first write with a stale version raises the existing
version conflict. No production order, production plan, stock, supplier commitment or outbound
transport record is mutated by these slices.

## Explicit blockers and unfinished work

1. `workflows.ts` still has the Phase 1-shaped `START -> WAIT_FOR_SIGNAL(await-reply) -> END`
   graph (with only a timeout addition). It does not durably deliver the Phase 2 RFQ and wait for
   the current Supplier 2 offer. Do not wire Phase 3 final agent, proposal binding, disposition or
   plan sends until this Phase 2 exit gate is green.
2. Full typecheck is blocked by the pre-existing app-level OpenAPI error in
   `src/modules/supply_cases/api/[id]/decision/route.ts`: `OpenApiMethodDoc` rejects its `body`
   property. This agent did not alter that file.
3. `yarn generate` completed via static fallback because another parallel app-level file imports
   missing `../../lib/resolution/confirmationJoin` from `store.ts`. This is not a reason to add an
   invented confirmation implementation in Phase 3.
4. P3-02 still needs the unique-invalid-offer audit link, current-RFQ/supersession proof and
   same-workflow signal/read-through after Phase 2 is complete.
5. P3-04/P3-05/P3-06/P3-07 need final agent/Caseload event subscribers, disposition re-authorization,
   replay-safe plan-specific sends, detail read model/UI/i18n and the self-contained E2E/browser gate.

## Validation

- `yarn jest src/modules/supply_cases/__tests__/phase3-resolution.test.ts --runInBand` — passed,
  4 tests.
- `yarn jest src/modules/supply_cases/__tests__ --runInBand` — passed, 24 suites / 286 tests.
- Focused ESLint over all files changed by this implementation — passed.
- `yarn generate` — completed with the documented static OpenAPI fallback; not a clean generation
  gate because of the unrelated missing `confirmationJoin` import.
- `yarn typecheck` — failed only at the documented existing `OpenApiMethodDoc.body` diagnostic after
  the new Phase 3 diagnostics were fixed.
- `yarn db:migrate` — not run. No core/enterprise file was changed.

## Reviewer instructions

Review the pure contracts and CAS first. Treat the Phase 2 dependency as a hard gate. If Phase 2
becomes green, continue from P3-02 and update this file plus `STATE.md` after every slice. Do not
claim Phase 3 `READY_FOR_REVIEW` until the full P3-07 exit gate and the two-organization/replay/
non-mutation evidence pass.

## Pass closure verdict

**BLOCKED — handoff complete.** The implementation pass did not claim full Phase 3. It delivered the
safe app-level P3-01/P3-03 contracts and tests, recorded the P3-02 command/event seam, and stopped
before workflow/Caseload/send/UI wiring because the Phase 2 durable RFQ graph is not green. No
Phase 2 work was folded into this pass. The exact validation results above are final for this handoff.

## Original spec-writer delivery

- Expanded the parent Phase 3 section into a complete implementation contract.
- Added the ordered implementation/review plan in `PLAN.md`.
- Recorded the inspected contracts, decisions, dependencies and validation state in `STATE.md`.
- At that earlier handoff point, no runtime-code changes had been made and no domain mutations were
  executed.

## Binding decisions

1. Scope is app-only under `manufacturer-app/src/modules/supply_cases`. Do not modify core or
   enterprise packages.
2. A Supplier 2 offer is accepted only from the current, non-superseded RFQ reply chain and only
   after strict quantity/date/amount/currency validation. Quantity must equal the outstanding RFQ;
   currency must equal the case currency because Phase 3 has no FX service.
3. Offer acceptance is a scoped atomic compare-and-set. Identical replay is a no-op; a competing
   offer never overwrites evidence and becomes `OFFER_CONFLICT`.
4. The three `ResolutionPlan` objects are constructed and hashed by deterministic app code. The
   agent may explain/rank only and must echo exact persisted IDs/hashes/actions.
5. The final agent uses canonical `kind: 'proposal'` and `INVOKE_AGENT` with
   `onResult: { alwaysAsk: true }`.
6. `agent_orchestrator.proposal.disposed` is the authoritative selected-option bridge. The workflow
   resume signal lacks `selectedOptionId`; do not infer a selection from rank/order.
7. The disposing actor needs enterprise dispose permission and `supply_cases.decisions.apply`.
   Re-check the app feature before side effects.
8. An `edited` disposition cannot be applied safely with the present disposed-event payload. It
   moves the case to `NEEDS_ATTENTION` and sends nothing. Rejected/unauthorized/stale outcomes also
   send nothing.
9. `resolution.request_confirmation` persists an immutable pending plan before calling the existing
   outbound seam. Replays and partial retries send only missing logical effects.
10. Phase 3 does not mutate production plans, production orders, stock allocations or supplier
    commitments. Those mutations remain behind the Phase 4 confirmation join.
11. The JSON backend remains local/demo storage and is not encrypted. Use synthetic data. Real ORM
    encryption/migrations are a separate production-readiness gate; do not add home-grown crypto.

## Explicit dependency / current blocker to end-to-end execution

The specification itself is ready, but the current runtime cannot pass the Phase 3 end-to-end gate
until Phase 2 is completed. At review time, `src/modules/supply_cases/workflows.ts` still contains
only `START -> WAIT_FOR_SIGNAL(await-reply) -> END`; it does not yet durably send the Supplier 2 RFQ
and park on the alternative-offer wait. Implement Phase 3 against the completed Phase 2 graph. Do
not hide Phase 2 work inside a Phase 3 completion claim.

This is a prerequisite, not an unresolved Phase 3 design question. Pure offer, plan, agent and
command slices may be implemented before it is green, but wiring and exit-gate claims must wait.

## Existing contracts to reuse

- `InboundMessageRepository.appendIfAbsent`, body sanitization, candidate-list assembly,
  reply-chain resolution and `supply_cases.inbound.apply_triage`.
- `SupplyCase` fields already reserved for `alternativeOffer`, `finalAnalysis`, `resolutionPlans`,
  `selectedResolutionPlanId` and `pendingResolutionPlan`.
- `sendSupplierMessage`, `OutboundCorrelation`, technical phases
  `ALTERNATIVE_SUPPLY_REQUEST`/`SUPPLY_ACCEPTANCE`, and
  `communication_channels.message.sent` delivery evidence.
- Installed `INVOKE_AGENT`/proposal envelope, Caseload disposal endpoint and proposal created/disposed
  events. Reuse; do not copy their implementation into the app.
- Existing ACL IDs: `supply_cases.view`, `supply_cases.messages.view`, `supply_cases.manage`,
  `supply_cases.decisions.apply`.
- Existing detail API/page and five module locale files.

## Validation performed by this agent

- Read the parent specification in full plus Phase 2/UI specs and current implementation contracts.
- Checked the installed workflow `INVOKE_AGENT`, proposal/Caseload event and optimistic-lock
  contracts used by the design.
- Documentation-only diff/whitespace/linkage checks are recorded in `STATE.md` after finalization.
- No build, unit, integration or browser tests were run because this handoff changes documentation
  only and the role explicitly forbids implementation/domain mutation.

## Open questions

No Phase 3 design question is left for the implementer to guess. If an installed upstream contract
has changed since this handoff, stop and record the mismatch as `BLOCKED`; do not change core or
enterprise to make the spec fit.

## Next action

Start with P3-01 in `PLAN.md`, update `STATE.md` after each slice, and preserve this handoff history
when writing the implementation handoff for the first reviewer.

## First reviewer handoff (2026-09-19)

### Status

**BLOCKED — do not claim full Phase 3 or `READY_FOR_FINAL_REVIEW`.** P3-01/P3-03 safe slices have
been reviewed, fixed and revalidated. Phase 2 and the remaining Phase 3 runtime/UI/E2E slices are
still required.

### Review fixes delivered

- Made the offer hash independent of evidence timestamps/order and bound it to normalized
  decision-relevant facts.
- Replaced recency-based RFQ selection with exact current reply-chain correlation and supersession
  rejection.
- Added SKU/status/scope/recipient/triage-state validation and deterministic evidence timestamps.
- Suppressed duplicate `alternative_offer.received` emission on idempotent replay.
- Hardened repository CAS with runtime Zod parsing and added concurrent/scoped regression proof.
- Completed deterministic plan evidence for accepted/cancelled/declined commitments, actual stock
  remaining, canonical source binding and missing-recipient fail-closed behavior.
- Added stock and primary commitment facts to `finalFactsHash` and enforced action-plan ID equality.

### Validation evidence

- Focused Phase 3 Jest: 1 suite / 6 tests passed.
- All supply_cases Jest: 26 suites / 323 tests passed.
- Focused ESLint: passed.
- `yarn generate`: passed, unchanged outputs, no fallback.
- Focused `git diff --check`: passed (CRLF warning only).
- `yarn typecheck`: failed only on current parallel/incomplete work:
  - `src/modules/supply_cases/__tests__/resolution-commands.test.ts:8` — non-exported
    `ExtractedCommitment` (Phase 4 slice),
  - `src/modules/supply_cases/workflows.ts:83` and `:92` — unsupported `condition` property
    (incomplete Phase 2 workflow graph).

### Mandatory next action

Complete Phase 2 first. Then connect P3-02 to the same durable workflow and implement P3-04 through
P3-06 before running P3-07. The final reviewer should recheck tenant isolation, proposal actor
authorization, exact plan/hash binding, one-decision CAS, replay/partial-send behavior, event
redaction, five-locale UI and byte-for-byte non-mutation evidence. Do not repair this by changing
core/enterprise or by treating parallel Phase 4 code as Phase 3 completion.

## Final reviewer closure (new sol, 2026-09-19)

### Handoff verdict

**BLOCKED — final review closed.** Full Phase 3 is not done. The safe current deliverable is limited
to the scoped offer CAS/validation core, its command/event seam, and the deterministic pure plan
builder. The durable inbound resume, final analysis persistence, final propose-only agent, Caseload
binding/disposition, decision/send path, UI/i18n completion and exit-gate evidence are still
missing. P3-03 must be read as `PARTIAL/IMPLEMENTED PURE BUILDER`, not as a completed runtime slice.

### Final-review fixes

- Canonical offer hashing now remains stable when same-date commitments arrive in another order.
- Resolution-plan construction now rejects a changed offer that reuses the persisted hash, requires
  exact persisted snapshot equality, and rechecks the offer quantities against the current shortage.
- Alternative-plan coverage now counts only on-time Supplier 2 commitments; late commitments make
  the displayed coverage/shortage non-green instead of falsely reporting full on-time coverage.
- Regression coverage was added for all three defects in the existing Phase 3 focused suite.

Changed by this final pass:

- `src/modules/supply_cases/lib/resolution/offer.ts`
- `src/modules/supply_cases/lib/resolution/plans.ts`
- `src/modules/supply_cases/__tests__/phase3-resolution.test.ts`
- this `HANDOFF.md` and `STATE.md`

The pass did not edit `workflows.ts`, `commands/sourcing.ts`, Phase 4 files, `packages/core`, or
`packages/enterprise`; unrelated dirty changes remain untouched.

### Focused evidence

- `yarn jest src/modules/supply_cases/__tests__/phase3-resolution.test.ts --runInBand` — PASS,
  1 suite / 8 tests.
- Focused ESLint over the two resolution modules, the record-offer command and the Phase 3 test —
  PASS with no diagnostics.
- Local runner was used; no Compose `app` service is running.
- No migration, full gate, browser suite, generate, typecheck, Phase 2 probe or Phase 4 probe was run
  in this pass, as explicitly required by the final-review scope restriction.

### Exact continuation order

1. Complete Phase 2 separately and prove its exit gate.
2. Complete P3-02 same-workflow resume/read-through and invalid-offer audit linking.
3. Persist P3-03 final facts and exactly three plans with scoped CAS and stale/tamper rejection.
4. Implement P3-04/P3-05/P3-06 without core/enterprise edits or fake contracts.
5. Run P3-07 only after those paths exist; keep the state `BLOCKED` until the complete exit gate,
   two-scope isolation, replay/race checks, browser evidence and prohibited-state non-mutation all
   pass.

## Phase 3/Phase 4 adapter handoff audit (2026-09-19)

**Status: BLOCKED.** The required Phase 1/2 closure artifacts are absent from the repository:
`manufacturer-app/.ai/runs/2026-09-19-phase1-phase2-closure/STATE.md` and `HANDOFF.md`. The Phase
1/2 exit gates cannot therefore be confirmed, and this handoff must not authorize adapter or
`COVERAGE_SHORTFALL` implementation.

When the evidence is restored, resume with the pure adapter contract: preserve Supplier 1/Supplier
2 roles, map `COMMIT` and `CANCEL` explicitly, map `stock.allocated` as absolute internal stock
allocation, reject fabricated commitments, bind the output to the exact `planHash` snapshot, and
return `unreadable_plan` versus `invalid_plan` fail-closed. The decided attention reason is the
additive `COVERAGE_SHORTFALL` value for valid complete confirmations that still leave coverage
below the required quantity.
