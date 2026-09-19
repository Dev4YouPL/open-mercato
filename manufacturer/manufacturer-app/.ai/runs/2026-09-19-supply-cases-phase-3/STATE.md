# Phase 3 orchestration state

**Status:** BLOCKED  
**Role:** new sol / FINAL REVIEW + FIX  
**Updated:** 2026-09-19 — final review closed

## Completed objective

Implemented the safe, dependency-independent Phase 3 offer and deterministic-plan slices under the
app-owned `supply_cases` module. Full Phase 3 is not claimed complete because the Phase 2 durable RFQ
graph is still missing.

## Implementation checkpoint

### Slice status

- **P3-01 — PARTIAL/IMPLEMENTED:** typed `AlternativeOfferSnapshot`, strict offer validation,
  canonical SHA-256 hash, new bounded failure reasons, and JSON-store scoped CAS with idempotent
  same-message/same-hash replay and competing-offer conflict.
- **P3-02 — PARTIAL/NOT E2E:** added the app command `supply_cases.offer.record_alternative` and
  redacted `supply_cases.alternative_offer.received` event. It only consumes already-linked inbound
  evidence and does not bypass the existing triage/thread gate; audit-linking invalid unique replies
  and workflow signal/read-through remain blocked until the Phase 2 graph exists.
- **P3-03 — PARTIAL/IMPLEMENTED PURE BUILDER:** added deterministic final facts and exactly three
  plan builders (`ACCEPT_DELAY`, `USE_STOCK`, `USE_ALTERNATIVE`), canonical plan hashes, actual
  Supplier 2 offer price, feasibility reasons, confirmation sets and outbound effect snapshots.
  The demo stock cost is isolated in `lib/resolution/stockPolicy.ts`. Durable final-analysis/plan
  persistence, stale-plan invalidation and the consuming workflow/agent path are not implemented.
- **P3-04 — BLOCKED:** final `INVOKE_AGENT`, proposal binding and forced Caseload wait are not wired;
  doing so against the current workflow would hide Phase 2 work.
- **P3-05 — BLOCKED:** disposition bridge and plan-specific sends are not wired; no outbound side
  effects were introduced by this implementation.
- **P3-06 — BLOCKED:** final comparison UI/API read-through is not completed; existing reserved fields
  remain untouched beyond the typed schemas.
- **P3-07 — BLOCKED:** the Phase 3 exit gate cannot run until the Phase 2 exit gate is green.

## Confirmed so far

- Phase 3 remains app-owned under `manufacturer-app/src/modules/supply_cases`; no `packages/core` or enterprise changes are allowed.
- The current backend is the scoped local JSON repository; production ORM entities and encryption maps remain deferred. Phase 3 must preserve that boundary and cannot claim production-grade encrypted JSON storage.
- The existing inbound path already provides scoped RFC `Message-ID` claim, sanitization, closed-set triage, thread evidence, and one durable workflow instance per case.
- Phase 2 is still in progress. Its deterministic impact/advisor/decision/RFQ seams exist, but `workflows.ts` still contains only `START -> await-reply -> END`; the Phase 2 exit gate is therefore an explicit dependency of Phase 3 implementation.
- Installed `INVOKE_AGENT` supports `onResult: { alwaysAsk: true }`, creates a Caseload proposal, and resumes a parked workflow through `agent_orchestrator.proposal.ready`.
- `agent_orchestrator.proposal.disposed` carries `selectedOptionId`, while the human-path `proposal.ready` signal carries the disposition and proposal payload but not the selected option ID. Phase 3 therefore needs an app-owned, persistent disposed-event bridge; it must not modify enterprise code or infer the selected plan from ranking.

## Files and contracts analyzed

- `AGENTS.md`
- `manufacturer-app/AGENTS.md`
- `manufacturer-app/.ai/IMPLEMENTATION_STATUS.md`
- `manufacturer-app/.ai/specs/2026-09-18-supplier-email-agent-workflow.md` (complete)
- `manufacturer-app/.ai/specs/2026-09-19-supply-cases-phase-2-initial-impact.md`
- `manufacturer-app/.ai/specs/2026-09-18-supply-cases-ui.md`
- `manufacturer-app/.ai/specs/SPEC-000-template.md`
- `manufacturer-app/.ai/guides/{spec-delivery,contracts,ai-workflows,backend-ui,testing-debugging}.md`
- `manufacturer-app/.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`
- repo-local skills and required references for spec writing, workflow design/durability, typed agents, data integrity/encryption, backend UI, and integration tests
- `manufacturer-app/src/modules/supply_cases/{workflows.ts,events.ts,ai-agents.ts,acl.ts,di.ts}`
- `manufacturer-app/src/modules/supply_cases/data/{types.ts,repositories.ts,inbound-signal.ts,initial-impact.ts,read-model.ts}`
- `manufacturer-app/src/modules/supply_cases/data/json/store.ts`
- `manufacturer-app/src/modules/supply_cases/commands/{inbound-triage.ts,initial-impact.ts,sourcing.ts}`
- `manufacturer-app/src/modules/supply_cases/lib/inbound/{candidateList.ts,resolveThread.ts}`
- `manufacturer-app/src/modules/supply_cases/lib/triage/{applyTriage.ts,applyTriageOutcome.ts}`
- `manufacturer-app/src/modules/supply_cases/lib/outbound/{sendSupplierMessage.ts,ports.ts,correlationKey.ts}`
- `manufacturer-app/src/modules/supply_cases/lib/sourcing/alternativeRequest.ts`
- `manufacturer-app/src/modules/supply_cases/subscribers/inbound-message-accepted.ts`
- existing API, read model, detail UI, and Playwright integration files under `src/modules/supply_cases`
- installed workflow `INVOKE_AGENT`, workflow-safe command, proposal envelope, Caseload dispose, optimistic-lock, and proposal event/resume contracts under `manufacturer-app/node_modules/@open-mercato/{core,enterprise}`

## Changes made

- Replaced the short Phase 3 outline in
  `.ai/specs/2026-09-18-supplier-email-agent-workflow.md` with binding contracts for offer
  correlation/claim, sanitization, triage, strict validation, atomic persistence, workflow resume,
  deterministic recomputation and plans, final agent/Caseload disposition, plan-specific sends,
  UI, ACL, i18n, failures, concurrency, tests and the exit gate.
- Added a 2026-09-19 changelog entry to the parent specification.
- Added `PLAN.md` with seven ordered implementation slices and the two-reviewer handoff sequence.
- Added `HANDOFF.md` with binding decisions, existing contracts, dependencies and next action.

## Runtime changes made by implementation agent

- `src/modules/supply_cases/data/types.ts`: strict offer, final-facts and resolution-plan schemas;
  `OFFER_INVALID`, `OFFER_CONFLICT` and `DECISION_UNAUTHORIZED` reasons.
- `src/modules/supply_cases/data/errors.ts`: bounded `offer_conflict` store error.
- `src/modules/supply_cases/data/repositories.ts` and `data/json/store.ts`: scoped
  `recordAlternativeOfferIfAbsent` CAS contract and serialized implementation.
- `src/modules/supply_cases/lib/resolution/offer.ts`: validation and canonical hashing.
- `src/modules/supply_cases/lib/resolution/plans.ts`: deterministic three-plan construction.
- `src/modules/supply_cases/lib/resolution/stockPolicy.ts`: named synthetic stock-cost policy.
- `src/modules/supply_cases/commands/record-alternative-offer.ts`: command-only valid-offer record
  path with non-green handling for invalid/conflicting evidence.
- `src/modules/supply_cases/events.ts`: redacted alternative-offer event contract.
- `src/modules/supply_cases/__tests__/phase3-resolution.test.ts`: focused pure validation/hash/plan
  coverage.

## Decisions

- Scope is strictly app-level; no core/enterprise changes.
- The Phase 2 exit gate is a hard prerequisite for end-to-end wiring.
- Strict offer quantity equality and same-currency validation are required; no prorating or FX.
- Offers and decisions use scoped atomic compare-and-set plus canonical hashes.
- Three plans are deterministic and immutable; the agent only explains/ranks exact plans.
- Final review is forced through Caseload; `proposal.disposed` supplies the selected option.
- Edited/unauthorized/stale decisions are non-green and side-effect free.
- Pending plan persistence precedes replay-safe plan-specific sends; delivery evidence gates status.
- Phase 3 never mutates production/order/stock/commitment data.
- JSON remains synthetic demo/test storage, not production encrypted persistence.

## Dependencies and blocked execution

The specification was `READY_FOR_IMPLEMENTATION`; the current implementation handoff is `BLOCKED`.
Full Phase 3 execution is dependency-blocked until
Phase 2 passes its exit gate; the current `workflows.ts` has not yet implemented that durable graph.
Production deployment is separately blocked on the deferred ORM/migration/encryption adapter. These
dependencies do not leave an ambiguous Phase 3 contract and must not be silently absorbed into an
app-only Phase 3 completion claim.

## Open questions

None. A mismatch discovered later in an installed upstream contract must be reported as `BLOCKED`
rather than repaired by modifying core or enterprise.

## Tests and validation

- `yarn jest src/modules/supply_cases/__tests__/phase3-resolution.test.ts --runInBand` passed:
  1 suite, 4 tests.
- `yarn jest src/modules/supply_cases/__tests__ --runInBand` passed: 24 suites, 286 tests.
- Focused ESLint passed for all Phase 3 files changed by this agent.
- `yarn typecheck` reaches an existing parallel app error in
  `src/modules/supply_cases/api/[id]/decision/route.ts`: `OpenApiMethodDoc` rejects the existing
  `body` property. The new Phase 3 files no longer produce type errors in that run.
- `yarn generate` completed using its static OpenAPI fallback because another parallel app-level
  file imports missing `../../lib/resolution/confirmationJoin` from `store.ts`. It refreshed generated
  artifacts, but this agent did not edit generated files or repair the unrelated Phase 4 slice.
- No database migration was run. No `packages/core` or `packages/enterprise` files were changed by
  this implementation slice.
- `git diff --check` passed for the touched app/run paths; the only output was existing CRLF-to-LF
  warnings, with no whitespace error.
- The run state and handoff now record `BLOCKED`, the completed safe slices, validation evidence and
  the explicit Phase 2 dependency.

## Next action

The implementation checkpoint is complete. The next agent must complete and verify Phase 2 before
wiring P3-02 signal/read-through, P3-04 final agent/Caseload, P3-05 disposition/send, P3-06 UI and
the P3-07 exit gate. Keep the existing typecheck/OpenAPI blockers visible; do not repair them by
changing core/enterprise or by introducing a fake confirmation layer.

## Final pass closure

This luna-high implementation pass is closed with **BLOCKED** status. No Phase 2 code was added or
changed as part of the Phase 3 implementation. The next reviewer may review and retain the P3-01/P3-03
work, but must not advance the run to `READY_FOR_REVIEW` until the Phase 2 exit gate and the remaining
Phase 3 slices are actually complete.

## First review + fix checkpoint (sol-medium, 2026-09-19)

### Verdict

**BLOCKED.** The reviewed P3-01/P3-03 safe slices are materially stronger and their focused/full
module tests are green, but Phase 3 cannot advance to `READY_FOR_FINAL_REVIEW`. The Phase 2 exit gate
is still not green, P3-02 is not connected to the durable workflow, P3-04 through P3-07 are absent,
and the app-wide typecheck has current errors outside the reviewed safe slices.

### Findings fixed

1. `offerHash` included `recordedAt` and evidence identifiers, so retrying the same decision facts at
   a later time could produce a different hash and be treated as a competing offer. The hash now
   covers normalized decision facts only; replay timestamp and commitment ordering are tested.
2. `record-alternative-offer` selected the newest case RFQ without proving the inbound message
   replied to it. It now resolves `In-Reply-To`/`References`, rejects superseded anchors, requires
   the exact case/phase/Supplier 2 lane, and does not infer a correlation from recency.
3. Offer validation omitted SKU, waiting status, correlation scope and correlation recipient checks.
   These now fail closed; the command also requires an auto-applied existing-case offer with one
   candidate, non-null SKU/price, and the matching intent.
4. Idempotent `already_recorded` replay emitted `supply_cases.alternative_offer.received` again. The
   event now emits only after the first successful CAS write.
5. Resolution plans used a hard-coded stock capacity of `200`, omitted cancelled Supplier 1 and
   declined Supplier 2 commitments, silently substituted `.invalid` recipient addresses, and did
   not bind the source plan/offer to the case canonical snapshot. The builder now reuses the existing
   deterministic impact calculation, validates the persisted offer and production-plan snapshot,
   records accepted/cancelled/declined commitments, uses actual stock, and fails closed on missing
   recipients.
6. `finalFactsHash` omitted stock and primary commitment dates/quantities. Those decision facts are
   now included. `ResolutionPlan.action.planId` is also schema-bound to the enclosing plan ID.
7. Repository CAS trusted the TypeScript offer type at runtime. It now Zod-parses the offer before
   entering the write and retains scoped not-found behavior, one-winner serialization, idempotent
   same-source/same-hash replay and explicit competing-offer conflict.

### Files changed by this review

- `src/modules/supply_cases/data/{types.ts,fixtures.ts}`
- `src/modules/supply_cases/data/json/store.ts`
- `src/modules/supply_cases/lib/resolution/{offer.ts,plans.ts}`
- `src/modules/supply_cases/commands/record-alternative-offer.ts`
- `src/modules/supply_cases/__tests__/phase3-resolution.test.ts`
- this run's `STATE.md` and `HANDOFF.md`

No reviewer change was made under `packages/core` or `packages/enterprise`; unrelated dirty-worktree
changes, including existing package changes and Phase 4 work, were preserved.

### Validation observed by this review

- `yarn jest src/modules/supply_cases/__tests__/phase3-resolution.test.ts --runInBand` — passed,
  1 suite / 6 tests, including canonical hash stability, current-RFQ supersession, scoped CAS,
  concurrent one-winner conflict and non-mutation plan assertions.
- `yarn jest src/modules/supply_cases/__tests__ --runInBand` — passed, 26 suites / 323 tests.
- Focused ESLint for every runtime/test file changed by this review — passed.
- `yarn generate` — passed cleanly; generated outputs were unchanged and OpenAPI generation did not
  use the prior static fallback.
- Focused `git diff --check` — passed; only the existing CRLF normalization warning was printed.
- `yarn typecheck` — failed on three current diagnostics outside the reviewed Phase 3 safe slices:
  `__tests__/resolution-commands.test.ts` imports non-exported `ExtractedCommitment`, and
  `workflows.ts` has two unsupported `condition` properties. These belong to parallel Phase 4 and
  incomplete Phase 2 work respectively and were not silently repaired in this review.
- No database migration, provider/live mailbox run, Playwright run or production mutation was made.

### Remaining blockers / next action

1. Complete and verify the Phase 2 durable RFQ graph and remove its `workflows.ts` type errors.
2. Finish P3-02: call the offer command from the accepted inbound path, implement uniquely-correlated
   invalid-offer audit linking, persist/signal the same workflow instance and prove early-offer
   read-through/restart idempotency.
3. Implement P3-04/P3-05/P3-06: propose-only final advisor validation, forced Caseload proposal,
   persistent created/disposed bridges with dual authorization, immutable decision CAS, replay-safe
   plan sends, delivery evidence, read model/UI and five-locale coverage.
4. Resolve the independent Phase 4 typecheck diagnostic without folding Phase 4 into this phase.
5. Run P3-07 integration/Playwright/non-mutation/exit-gate evidence only after the dependencies above
   are green. The next agent must keep status `BLOCKED` until that evidence exists.

## Final review + fix checkpoint (new sol, 2026-09-19)

### Final verdict

**BLOCKED.** This review does not claim Phase 3 complete or ready for review/merge. P3-01 has a
validated, scoped atomic offer-record core; P3-02 remains only a command/event seam; P3-03 has a
reviewed pure deterministic builder but no durable final-analysis persistence; P3-04 through P3-07
remain absent or dependency-blocked. No Phase 2 or Phase 4 runtime file was modified by this pass.

### Independent findings fixed

1. Canonical offer hashing sorted commitments only by date. Reordering two commitments for the same
   date could therefore change `offerHash`. Canonicalization now sorts by date and quantity, and the
   regression uses same-date commitments in reverse order.
2. `buildResolutionPlans` trusted a caller-supplied offer object when it carried the persisted
   `offerHash`. A caller could alter price or commitments while reusing that hash and obtain plans
   not grounded in the persisted evidence. The builder now Zod-parses both snapshots, recomputes the
   canonical decision hash, requires exact persisted-snapshot equality and rechecks quantity totals
   against the current shortage.
3. `USE_ALTERNATIVE` counted the full offered quantity as on-time coverage even when some
   commitments were after the required date. Coverage now includes only commitments on or before
   the required date; feasibility and shortage use that same quantity.
4. Earlier state called P3-03 an implemented pure slice without clearly separating its builder from
   the missing persistence/invalidation/call-site work. The slice status now says
   `PARTIAL/IMPLEMENTED PURE BUILDER` and names the missing contracts explicitly.

### Files changed by the final reviewer

- `src/modules/supply_cases/lib/resolution/offer.ts`
- `src/modules/supply_cases/lib/resolution/plans.ts`
- `src/modules/supply_cases/__tests__/phase3-resolution.test.ts`
- `.ai/runs/2026-09-19-supply-cases-phase-3/{STATE,HANDOFF}.md`

No final-review edit was made to `workflows.ts`, `commands/sourcing.ts`, any Phase 4 file,
`packages/core`, or `packages/enterprise`. All unrelated dirty changes were preserved.

### Focused validation run by the final reviewer

- `yarn jest src/modules/supply_cases/__tests__/phase3-resolution.test.ts --runInBand` — passed,
  1 suite / 8 tests.
- `yarn eslint src/modules/supply_cases/lib/resolution/offer.ts src/modules/supply_cases/lib/resolution/plans.ts src/modules/supply_cases/commands/record-alternative-offer.ts src/modules/supply_cases/__tests__/phase3-resolution.test.ts` — passed with no diagnostics.
- Runner: local, because the workspace has no running Compose `app` service.
- `yarn db:migrate` was not run. Per the user's stop instruction, no full-suite, generate,
  typecheck, build, Playwright, Phase 2 or Phase 4 probe was run in this pass. Earlier validation
  entries above remain historical evidence, not claims made by this final review.

### Explicit next steps to unblock Phase 3

1. Outside this review, complete and independently verify the Phase 2 exit gate.
2. Finish P3-02 against that completed graph: accepted-inbound invocation, invalid-current-RFQ audit
   link, same-instance signal/read-through and restart/replay evidence.
3. Add the missing P3-03 durable final-analysis/plan CAS and stale/tampered persistence checks.
4. Implement P3-04 through P3-06 exactly as specified: propose-only final advisor, forced Caseload
   disposition, dual authorization, immutable selected-plan CAS, replay-safe sends, delivery gate,
   scoped read model/UI and five-locale coverage.
5. Only then run P3-07, including two-scope isolation, races/replays, browser coverage and
   byte-for-byte proof that production/order/stock/commitment state remains unchanged.
