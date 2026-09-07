# Manufacturing P1.6 Work Centres implementation

Source doc: .ai/specs/2026-08-19-manufacturing-work-centres.md
Status: complete
Engine: om-auto-create-pr (steps: 19, --loop: no)

## Goal
Implement scoped Work Centre CRUD and aggregate-owned optional resource membership exactly as specified, with concurrency, undo/redo, provider isolation, UI and executable evidence.

## Scope and implementation plan
The Progress phases below are the implementation plan. Existing customers/resources CRUD and Manufacturing BOM patterns are references. No scheduling, routing links, snapshots, Site, resource master, or planner behavior is introduced.

## Base and explicit maintainer direction
Repository: Dev4YouPL/open-mercato
PR base: feat/manufacturing-p1-0a-bootstrap-p1-4a-bom-authoring
Implementation head: codex/manufacturing-p1-6-work-centres
Starting revision: 7cae0b5b78e8e2480eeddd1503b20dc62f932685
P1.6 implementation is intentionally based on the current branch while prerequisite PR #6 remains pending acceptance by explicit maintainer direction.
This run-specific user override supersedes the configured develop base and prerequisite acceptance gate. It does not waive implementation tests, review, or QA. No develop or pipeline configuration changes are authorized or needed.

## Risks
- Concurrency and undo/redo require real PostgreSQL evidence, not only mocked tests.
- Optional resources must fail closed without cross-module ORM imports.
- The source specification is an untracked user-authored revision in the invoking checkout; a verbatim local copy is used for implementation and is excluded from this implementation PR, preserving the separate design PR #3.
- Existing user activation and generated-icon edits remain in the primary checkout.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: Readiness
- [x] 0.1 Verify inherited package, activation, generated registries and explicitly waived acceptance gate. — d80b19486
- [x] 0.2 Verify dependencies and standalone package resolution. — d80b19486
- [x] 0.3 Verify generated resources entity ID, RBAC and exact query projection. — d80b19486
- [x] 0.4 Verify absence of cross-module ORM relationships. — d80b19486

### Phase 1: Data model
- [x] 1.1 Add parent and membership entities, constants and parity tests. — 2f6f3a8f4
- [x] 1.2 Add code uniqueness, scoped membership indexes and parent FK. — d80b19486
- [x] 1.3 Generate and review intended migration and snapshot. — d80b19486

### Phase 2: Commands and API
- [x] 2.1 Add validators and deterministic membership normalization. — 2f6f3a8f4
- [x] 2.2 Add transactional commands, scoped optional resolver, undo/redo and audit tests. — 2f6f3a8f4
- [x] 2.3 Add CRUD route, OpenAPI, indexer, events and batched projections. — 2f6f3a8f4
- [x] 2.4 Add ACL/setup grants, translations and optimistic locking. — 2f6f3a8f4

### Phase 3: Provider and handoff reads
- [x] 3.1 Verify optional provider outcomes, authorization and wildcard handling. — d80b19486
- [x] 3.2 Verify active scoped read contract and absence of planner/WMS effects. — d80b19486

### Phase 4: User interface
- [x] 4.1 Add list/create/detail pages, extension hosts and stable row actions. — ae888a5af
- [x] 4.2 Add paged resource selector and selected-ID hydration with stale-response protection. — ae888a5af
- [x] 4.3 Add keyboard, guarded retry, conflicts and required UI integration coverage. — ae888a5af

### Phase 5: Verification and delivery
- [x] 5.1 Verify stable read-model contract without implementing snapshots. — d80b19486
- [x] 5.2 Run ordered full validation plus lint, package profiles and named integration/UI suites. — fb94736c8
- [x] 5.3 Record every P1.12 evidence category, independent review, QA screenshots and final PR status. — f3354bfd2

## Verification evidence

Runner: local (no compose `app` container was running).

Ordered gate: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
`yarn build:app` — all green. Additionally `yarn lint` (0 errors) and
`yarn check:client-boundaries` (exit 0). `@open-mercato/manufacturing`: 263
unit tests in 32 suites.

Two pre-existing failures reproduce unchanged at the base commit 7cae0b5b7 and
are unrelated to this change: `@open-mercato/queue`
"continuous workers re-arm filesystem wake-ups" and `@open-mercato/shared`
"warnOnEncryptedLikeFilter skips the encryption lookup entirely in production".

Integration and browser QA ran against a real Next production server on an
isolated PostgreSQL database (never the developer database), with manufacturing
activated through a temporary, uncommitted manifest edit that was reverted; the
committed manifest keeps the module opt-in and `activation-parity` enforces it.

| Profile | Modules | Result |
|---|---|---|
| full | catalog, manufacturing, resources, planner | 58 passed, 1 skipped, 0 failed |
| no-resources | catalog, manufacturing, planner | 46 passed, 12 skipped, 0 failed; BOOT 5/5 |
| no-planner | catalog, manufacturing | BOOT 5/5; `/api/resources/resources` 404 while work centres serve 200 |
| manufacturing-off | committed default | activation-parity + discovery tests, `yarn build:app` green, no work centre routes |

`yarn generate` with the module activated emits
`manufacturing:manufacturing_work_center` and
`manufacturing:manufacturing_work_center_resource`, matching the local
constants, plus the API route and all three backend routes.

Defects found by executing the suites, then fixed:
- the activity filter applied `is_active IS NULL` to every unfiltered list read
  (`parseBooleanToken` returns null, not undefined), so the list returned nothing;
- membership was blanked in all-organizations mode;
- a second consecutive save conflicted with the user's own first save;
- the "resources module unavailable" form state was unreachable.

Deliberate deviations recorded for the maintainer:
- `reversalVersion` derives an undo/redo version as `recorded + 1ms` so redo can
  prove the exact post-undo state. It is strictly increasing but not wall-clock,
  so a reversal does not advance `updated_at` past the present. Watermark-based
  consumers would not observe it. Alternative designs lose redo's predictability.
- The OpenAPI document does not yet carry the stable-error envelope: the shared
  CRUD OpenAPI factory has no error-schema seam, and adding one touches
  `packages/shared`. Left for a follow-up rather than widened unilaterally.
