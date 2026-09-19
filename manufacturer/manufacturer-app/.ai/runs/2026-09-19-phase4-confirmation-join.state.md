# Run state — Phase 4 confirmation join

**Started:** 2026-09-19
**Spec:** [`.ai/specs/2026-09-19-supply-cases-phase-4-confirmation-join.md`](../specs/2026-09-19-supply-cases-phase-4-confirmation-join.md)
**Owner of this run:** the outbound/workflow agent (T-10b, outbound seam). UI (`T-11`) and Phase 2 are owned by OTHER agents — do not edit their files.

This file is the handover record for the run. It is updated at each stage boundary and
records what actually happened, including what failed. It is not a plan; the plan is the
spec.

## Pipeline

| Stage | Model | Status | Artifact |
|---|---|---|---|
| 1. Spec authored | opus (main) | DONE | `.ai/specs/2026-09-19-supply-cases-phase-4-confirmation-join.md` |
| 2. Spec review | opus (subagent) | DONE — verdict NOT READY | 18 findings; 4 blockers; spec rewritten as v2 |
| 3. State file | — | DONE | this file |
| 4. Implementation | sonnet (subagent) | DONE | 7 new files, 7 modified |
| 5. Implementation review | opus (subagent) | DONE — SHIP WITH FIXES | 1 blocker + 5 major; all applied |
| 6. Validation gates | main | DONE — all green | see Final gate results |

## Scope boundary for every stage

**In scope (Phase 4 only):** confirmation intake branch, `SupplyConfirmation` store
collection, plan contract parsing, single-confirmation validation, the confirmation join,
`resolution.record_confirmation`, `resolution.apply_confirmed`, the two workflow steps, two
events, i18n for the new strings, and TEST-010–014 + 017–020.

**Explicitly out of scope — do not touch:**

- `src/modules/supply_cases/data/read-model.ts`, `api/`, `backend/`, `components/` — owned by the UI agent.
- Phase 2 surfaces: impact service, `initial_impact_advisor`, `sourcing.*` commands.
- Phase 3 surfaces: `final_resolution_advisor`, `resolution.apply_decision`, acceptance sending.
- ORM entities / migrations (T-03a–c stay deferred). Never run `yarn db:migrate`.
- `lib/outbound/**` — already built and covered; Phase 4 sends nothing.
- **`workflows.ts` — frozen for this run.** See "Workflow deferral" below.

## Workflow deferral (decision taken after spec review)

The spec's `await-confirmations` step would rewrite the existing `reply-to-end` transition,
and Phase 2 is concurrently re-pointing `await-reply` at the Supplier 2 offer wait. Neither
spec owns the merged step order, so building the step now guarantees a conflict on a file
another agent is rewriting.

Phase 4 does not need it: `apply_confirmed` is dispatched by the `record_confirmation`
command, and the workflow was only ever an observer of a durable fact. So this run ships the
whole confirmation join WITHOUT touching `workflows.ts`, and the step plus the
`confirmations_complete` signal become a follow-up once the merged step order is agreed.
Nothing in TEST-010–014G depends on the workflow.

## Standing constraints

- JSON store stays the backend. Do not replace it with the ORM.
- Tenant + organization scope is fail-closed everywhere; missing scope never means "all".
- Side effects post-commit, one emission site per event.
- No hard-coded user-facing strings; five locales (`en, pl, de, es, ko`).
- `yarn generate` after any discovery-file change (events, workflows, commands, cli, subscribers).

## Assumptions carried by this run

- **A-1..A-4** from the spec: Phase 3 does not exist, so `pendingResolutionPlan` is built
  from fixtures in tests. The join is a function of plan + confirmations, so this does not
  weaken the oracles.
- Phase 2 rewires the same workflow. Phase 4 adds steps and must not renumber or re-mean
  existing ones. `__tests__/inbound-workflow-engine.db.test.ts` (TEST-002A) encodes today's
  workflow shape and must be UPDATED, never deleted, when the definition changes.

## Log

- **2026-09-19** — Spec drafted. Two questions deliberately left for the reviewer: whether
  `needsAttentionReasonSchema` needs a new `COVERAGE_SHORTFALL` value (a contract surface
  change, so it needs explicit approval), and whether the Phase 2 workflow rewiring forces
  an ordering constraint between the two phases.
- **2026-09-19** — Spec review dispatched (opus subagent).
- **2026-09-19** — Review returned NOT READY with 4 blockers, all verified against the code
  before acting on them:
  1. `internalStockQuantity` is coverage already counted by `calculatePlanCoverage`, not a
     free balance. The v1 subtraction would have made the green gate unreachable for
     `USE_STOCK`. v2 SETS it to the plan's absolute allocation, which also removes the need
     for a stock snapshot and is idempotent by construction.
  2. The plan contract could not represent the parent spec's own options (Supplier 1 has TWO
     deliveries in `ACCEPT_DELAY`, and a COMMIT plus a CANCEL in the others). v2 makes the
     relation role → list and compares confirmations as a SET.
  3. No matching key exists between a plan commitment and a `ProductionPlan.supplierCommitments`
     row (`supplierCommitmentSchema` has no id or role), so a merge could fabricate coverage.
     v2 specifies a full REPLACE of the roles the plan names, leaving other suppliers' rows alone.
  4. The workflow engine does NOT implement `signalConfig.timeout` — `step-handler` parses it,
     logs it and never reads it back; there is no sweeper anywhere in the engine. TEST-012 was
     unimplementable as written. v2 makes the timeout app-owned (pure deadline function +
     `expire_confirmations` command), with scheduler plumbing out of scope.
  Also fixed: the join race (evaluation now happens INSIDE `JsonCollection.mutate`, which
  returns `{records, result}`), the advisory optimistic lock (new `updateIfUnchanged` that
  compares inside the mutator), the tautological two-part green gate (stated once), the
  scalar confirmed quantity/date (now the full extracted commitment list), and a test-ID
  collision with the parent spec (TEST-015–018 were already taken; renumbered into
  TEST-010–014G).
  Corrected the reviewer on one point: `supply_cases.manage` DOES exist (`acl.ts:14`).
  Left open for the project owner: whether to add `COVERAGE_SHORTFALL` to
  `needsAttentionReasonSchema`. Until approved, the implementation uses `ANALYSIS_FAILED`
  and leaves a TODO pointing at the spec section.
- **2026-09-19** — Implementation dispatched (sonnet subagent), `workflows.ts` frozen.

## Gate results (re-run by the coordinator, not taken from the implementer's report)

- `npx jest --config jest.config.cjs --runInBand src/modules/supply_cases` — **exit 0**, 26 suites / 323 tests.
- `npx eslint src/modules/supply_cases src/modules.ts` — **exit 0**, no output.
- `npx tsc --noEmit` — **exit 1**, exactly 2 errors, BOTH in `src/modules/supply_cases/workflows.ts` (83,7) and (92,7):
  `'condition' does not exist in type 'TransitionInput<...>'`. This is the FROZEN file, rewritten
  by the Phase 2 agent while this run was in flight; `defineWorkflow`'s transition type does not
  accept a `condition` property. **Not ours, not fixed by us, and it currently breaks the shared
  typecheck gate — the Phase 2 owner has to resolve it.**
- Freeze compliance verified: `COVERAGE_SHORTFALL` absent from `needsAttentionReasonSchema`;
  nothing created or modified under `data/read-model.ts`, `api/`, `backend/`, `components/`.

## Integration gap to resolve before Phase 3 meets Phase 4

Phase 3 landed concurrently and writes `pendingResolutionPlan` in a DIFFERENT shape than the
confirmation join parses. Verified field by field in `data/types.ts`:

| Phase 3 `resolutionPlanSchema` | Phase 4 `ConfirmationPlanContract` |
|---|---|
| `supplier1Commitments` + `supplier2Commitments` (role implicit in the field name) | `supplierCommitments: Array<{role, …, intent}>` |
| `stock: { allocated, remaining }` | `internalStockAllocation: number` |
| `additionalCost: { amount, currency, basis }` | `additionalCost: number \| null` |
| `requiredConfirmations` | `requiredConfirmations` — **already aligned** |
| `planHash` | `planHash` — **already aligned** |

The two fields the join actually keys on (`planHash`, `requiredConfirmations`) already match, so the
adapter is mechanical rather than a redesign. It is NOT written: it needs the Phase 3 owner to
confirm that `stock.allocated` means "absolute quantity this plan consumes" (which is what
`internalStockAllocation` requires) and whether `resolutionCommitmentSchema` carries a
COMMIT/CANCEL intent. Until then `record_confirmation` cannot parse a real plan, and Phase 4 is
proven only against its own fixtures — exactly as the Assumption Register (A-4) allows.

## Implementation review outcome (opus) and the fixes applied

Verdict SHIP WITH FIXES. The reviewer verified the four blocker areas empirically (it wrote
throwaway probe tests and deleted them), and confirmed all four were implemented correctly:
absolute stock assignment, per-role `COMMIT`-only comparison, a true REPLACE of the named
roles' commitment rows, and join evaluation genuinely inside `JsonCollection.mutate`.

**One real blocker, fixed by the coordinator:**

- `validateConfirmation` compared MULTISETS as SETS. A plan with two identical `COMMIT` rows
  (`250 Wed` twice — a split `ACCEPT_DELAY`) was "matched" by a supplier confirming only ONE of
  them; apply then marked BOTH rows `CONFIRMED` and the green gate passed on 250 units nobody
  promised. Same class of defect the REPLACE rule exists to close, arriving through the
  validation door. Now `multisetsEqual`, with a regression test the coordinator independently
  falsified (reverting to set comparison turns it red).

**Three further production fixes:**

- A crash between the closing confirmation and its apply wedged the case permanently: the
  replay returned `already_recorded` and dispatched nothing, and `expire_confirmations` refused
  because the join was already `COMPLETE`. That broke REQ-P4-007, which demands resumability,
  not merely non-duplication. A replay now re-evaluates the stored set and resumes.
- An UNREADABLE plan shape flipped a healthy waiting case into `NEEDS_ATTENTION`. With Phase 3
  landing a different plan shape, the first real confirmation would have damaged the case
  rather than being ignored. Now only a SELF-CONTRADICTORY plan parks the case
  (`invalid_plan`); an unrecognised shape returns `unreadable_plan` and writes nothing.
- A redundant concurrent resume threw `VersionConflictError` out of the command instead of
  returning a benign result. Now `already_applied`.

**Test suite hardened** (the reviewer showed it would have stayed green against broken code in
the places that matter): recording event bus with exact emission counts, a stock assertion that
no longer compares `0 === 0`, the first test of REPLACE semantics, a real concurrent race in
TEST-014D, plus coverage for both new recovery paths. Every one was verified by deliberately
breaking production code and observing red.

## Final gate results (run by the coordinator)

- `npx jest --config jest.config.cjs --runInBand src/modules/supply_cases` — **exit 0**, 26 suites / 332 tests.
- `npx tsc --noEmit` — **exit 0**. (The two `workflows.ts` errors reported mid-run were the Phase 2 agent's and they fixed them.)
- `npx eslint src/modules/supply_cases src/modules.ts` — **exit 0**.
- `yarn generate` — **exit 0**, generated outputs unchanged.

## Status: Phase 4 complete against its own contract, NOT yet wired to Phase 3

Still open, and each needs a decision by someone other than this run:

1. **The Phase 3 plan adapter** (see "Integration gap" above). Until it exists, a real
   Phase-3-authored plan returns `unreadable_plan` and is inert — no longer destructive, but the
   join cannot run on real data.
2. **`COVERAGE_SHORTFALL`** — still not added; `ANALYSIS_FAILED` carries a TODO. Needs the
   project owner's approval because it is a contract surface.
3. **The `await-confirmations` workflow step** — deferred with `workflows.ts` frozen. Needs the
   merged step order to be agreed with Phase 2 first.

## Phase 3/Phase 4 adapter run (2026-09-19)

**Status: BLOCKED before implementation.** The required Phase 1/2 closure artifacts now exist, but
their authoritative verdict remains `IN_PROGRESS`: live provider, real RFQ/delivery, and the
remaining Phase 1 browser-matrix evidence are still missing. No Phase 1/2 exit-gate completion can
be accepted from the available historical notes.

The contract decision is recorded for resumption: add `COVERAGE_SHORTFALL` without removing or
narrowing existing enum values; use it only for complete, valid confirmations with insufficient
coverage, never `ANALYSIS_FAILED`. The adapter remains unimplemented and must stay pure,
non-mutating, role-preserving, explicit about `COMMIT`/`CANCEL`, and fail-closed for unreadable or
internally invalid plans.
