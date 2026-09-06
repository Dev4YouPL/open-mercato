# Execution plan — turn PR #6's red CI green (adopted from PR #6)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-01 because PR #6 carried no execution plan.
**PR:** #6 · **Branch:** `feat/manufacturing-p1-0a-bootstrap-p1-4a-bom-authoring` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make the three failing required checks on PR #6 (`lint`, `ds-lint`, `audit`) pass, without changing the
behaviour the PR already shipped and already had QA'd, so the Manufacturing implementation base can merge.

## Scope

- `packages/manufacturing/package.json` — the peer declaration the published-package gate demands.
- The two BOM backend `page.tsx` route files and the client components that currently own their page shell.
- The root `resolutions` block — the repository's established channel for security-driven transitive bumps.

## Non-goals

- The `react-is` root cause recorded in `scripts/package-peer-deps-allowlist.json`'s `followUp` note
  (declaring `react-is` in `@open-mercato/ui`'s `dependencies`, which would retire eleven allowlist
  entries at once). That is a shared-package dependency change with a blast radius well beyond this PR
  and belongs in its own change.
- The 227 warn-level DS findings this branch inherits from `develop`. Only the two error-level findings
  introduced here are in scope.
- Any change to the Manufacturing feature surface, its migrations, or its API contracts.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is "fix the red CI", nothing wider | The user's own instruction on this resume: *"CI nie przeszło. Sprawdź co nie przeszło i to popraw"* | high |
| `lint` fails on one unmet peer: `@open-mercato/manufacturing` → `@open-mercato/ui` → `react-is` | `yarn packages:check-peer-deps` output, run `33552100540` job `100003776292` | high |
| The correct remedy is to declare the peer, not to append to the allowlist | `scripts/package-peer-deps-allowlist.json` note: *"New violations must be fixed, not appended"*, and the gate's own error text | high |
| `ds-lint` fails on exactly two error-level `om-ds/require-page-wrapper` findings, both new in this PR | Job `100003776630`; the `ds-lint-report` bot comment reads `229 findings (+2 vs develop)` | high |
| The rule needs literal `<Page>`/`<PageBody>` JSX inside `page.tsx`; the wrappers currently live one level down in the client components | `packages/eslint-plugin-ds/rules/require-page-wrapper.js` — it is a per-file AST rule and cannot follow into a child component | high |
| `audit` fails on two `browserslist <=4.28.6` advisories that are **pre-existing on `develop`**, not introduced here | Job `100003850946`; `git show origin/develop:yarn.lock` also resolves `browserslist@4.28.2`, and the PR's `yarn.lock` diff touches no browserslist line | high |
| Pinning through the root `resolutions` block is this repo's established remedy for exactly this shape of advisory | The 60+ existing security pins in the root `package.json` `resolutions` | high |
| Everything else on the run is green or legitimately skipped | `gh pr checks 6` — `test`, `merge-coverage`, `ephemeral-integration` and `documents-multi-instance` are `skipping`, the rest pass | high |

## Assumptions

- **`browserslist` 4.28.8 is patched.** The advisories cap at `<=4.28.6` and 4.28.7/4.28.8 are published;
  pinning the newest patch in the same minor is the most reversible choice. If the advisory is later
  widened, the pin is one line to change.
- **The DS wrapper move is presentation-neutral.** `Page` and `PageBody` are plain `space-y-*` divs, so
  hoisting them into `page.tsx` while preserving each container's spacing class keeps the rendered output
  identical to what the 2026-08-31 QA walkthrough approved.
- **Declaring `react-is` as a peer of `manufacturing` is enough.** It mirrors how `@open-mercato/ui`
  itself declares the peer and how `react`/`react-dom` are already declared on this package.

## Risks

- The DS change touches UI that already passed a real-browser QA pass; the spacing classes are preserved
  deliberately for that reason, but the pages should be re-checked before merge.
- The `browserslist` pin is a lockfile-wide resolution: it affects every consumer of the transitive
  dependency, so the full build must be re-run rather than trusted.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 P1.0a package bootstrap, P1.4a BOM draft authoring, supporting platform work and Wave 0 documentation — 33 commits — 05cb248ba

### Phase 2: Turn the red required checks green

- [x] 2.1 Declare the `react-is` peer on `@open-mercato/manufacturing` so the published-package gate passes — 44e3fc230
- [x] 2.2 Hoist the `Page`/`PageBody` shell into the two BOM `page.tsx` route files — 44e3fc230
- [x] 2.3 Pin `browserslist` above the advisory range through the root `resolutions` block — 44e3fc230
- [x] 2.4 Run the validation gate on the changed surface and push — see Phase 3

### Phase 3: Turn the `test` check green (2026-09-03 resume)

Phase 2 turned `lint`, `ds-lint` and `audit` green, which let the `test` job run for the first time on
this fork. It then failed on its own. Diagnosis and remedies:

| Finding | Evidence | Remedy |
|---|---|---|
| The job died mid-`Checking types` after 49 min rather than failing a step | Every step from `Checking types` on reports `conclusion: null`, and GitHub stored **no log** for job `100026532274` — the run archive contains every other job and not this one | 3.5 |
| The typecheck ran 31 tsc tasks at turbo.json's repo-wide concurrency of 32, each entitled to the job's 5 GB heap, on a 4-vCPU/16 GB GitHub-hosted runner | `yarn turbo run typecheck --filter=[origin/develop]... --dry` selects 31 tasks; the job sets `NODE_OPTIONS=--max-old-space-size=5120` | 3.5 |
| The `Test` step called turbo directly, bypassing both guards the root `test` script exists to apply (`--max-old-space-size=1024`, `--concurrency=2`) | `package.json` `"test"` vs the workflow's `yarn turbo run test --filter=…` | 3.5 |
| `@open-mercato/manufacturing` was published at 0.6.7 while the monorepo is at 0.7.0 | `scripts/__tests__/check-version-alignment.test.mjs` — runs in CI's `Test scripts` step | 3.1 |
| The module's two ACL features carry no English titles in the auth catalog | `packages/core/src/modules/auth/__tests__/acl-feature-catalog.i18n.test.ts` — a repo-wide guard, so it runs unfiltered | 3.2 |
| `manufacturing-module-discovery.test.ts` asserts `apis: [{`, a shape the registry generator never emits (it always breaks the line after `[`) | The test's own failure output, and every `apis: [` in a real generated registry | 3.3 |
| The staff timesheet totals test is date-dependent: it queries the whole screen for the text `2`, which also matches the day-of-month heading in any week containing the 2nd | `page.durationEntry.test.tsx:227`; `page.tsx:887` renders `<div className="text-xs">{date.getDate()}</div>`. Inherited from `develop`, unrelated to this PR, but red today and therefore blocking | 3.4 |

Verified as **Windows-only** and left alone: `likeFilterWarning` (jest's win32 `process.env` proxy ignores
`defineProperty`), `queue/local.strategy` (EPERM on `mkdir`/`rename`), `attachments/localDriver` (drive-letter
paths), `warranty_claims/quantity` (`toLocaleString` under a pl-PL host), `create-mercato-app`
design-system-inventory (`execFileSync('npm', …)` cannot spawn `npm.cmd`), `open-mercato-docs`
notification-registry (`relative()` yields `packages\enterprise`), and 17 `test:scripts` cases of the same
kind. None of them can fail on the Linux runner.

- [x] 3.1 Align `@open-mercato/manufacturing` with the monorepo version — 5a5e9dcb6
- [x] 3.2 Add the two `manufacturing.bom.*` ACL feature titles across the five auth locales — 5a5e9dcb6
- [x] 3.3 Assert the API surface against the shape the generator actually emits — 31f2b433c
- [x] 3.4 Scope the timesheet totals assertion to the totals cells — 032d398d8
- [x] 3.5 Bound the `test` job's turbo concurrency and heap, and cap its wall time — 935f9c0fb
- [x] 3.6 Run the validation gate on the changed surface and push

### Phase 4: Re-pin `fast-uri` above its new advisory range

The run on `b280f78d6` turned `audit` red on four `fast-uri` advisories (`GHSA-5jgf-p345-68v8`,
`GHSA-f65p-4m7j-42xc`, `GHSA-fph4-wmhf-6fwf`, `GHSA-jqff-g426-hqxp`), all fixed in 3.1.6. This is
advisory drift, not a regression: the root `resolutions` block already pinned `fast-uri` to **3.1.5**,
and the advisories that cover it were published after the previous run's `audit` passed on the same pin.
`3.1.7` is unusable — `.yarnrc.yml` sets `npmMinimalAgeGate: 5d` and it was published one day ago — so
3.1.6 is both the fixed version and the newest one the supply-chain gate admits. `ajv@8.18.0` is the only
requester and asks for `^3.0.1`, which 3.1.6 satisfies without forcing a major.

- [x] 4.1 Move the root `fast-uri` resolution from 3.1.5 to 3.1.6 and refresh the lockfile
- [x] 4.2 Re-run `check:resolutions`, `audit-ci --severity high`, `install --immutable`, `check:dep-versions` and the peer-dependency guard

### Phase 5: Address the REQUEST_CHANGES review (2026-09-03 resume)

A review against base `a0154ac41` raised 27 findings. Each was re-verified against the head before being
accepted; three were rejected with evidence and are answered in a PR comment rather than "fixed".

| Finding | Verdict | Evidence | Step |
|---|---|---|---|
| #1 mutation guards drop `modifiedPayload` and run `afterSuccess` before the command | Accepted | `runBomMutationGuards` ignores the runner's `modifiedPayload` and loops `afterSuccessCallbacks` inside itself, before `commandBus.execute`; `input.resourceId` is `null` on create so the callback never fires there. `packages/core/src/modules/staff/api/guards.ts` splits the two halves, and the spec's "Custom routes" paragraph requires the same | 5.3 |
| #2 delete-undo always no-ops on an empty scope | **Rejected** | `command-bus.ts` `persistLog` resolves `metadata.tenantId ?? ctx.auth?.tenantId` before writing, so the `null`s never reach storage | — |
| #3 undo is not semantic | Accepted | Only `reorder` compares the recorded after-state; the other six restore or delete unconditionally | 5.4 |
| #4 undo does not revalidate the graph | Partly accepted | The graph advisory lock *is* taken (`withBomTransaction` → `acquireBomGraphLock`), but no restore path re-runs cycle validation | 5.4 |
| #5 custom fields are not atomic with the aggregate | **Rejected** | The 2026-08-31 spec changelog adopts the out-of-transaction data-engine write deliberately. The undo *ordering* was still wrong and is corrected under 5.4 | 5.4 (partial) |
| #6 one bad product breaks the whole product page | Accepted | `resolveMany` is `Promise.all` over a `resolve` that throws `uom.conversion_not_found`; the outer catch then drops offers/categories/tags/pricing for every row | 5.1 |
| #7 `/api/catalog/prices` can now 500 | Accepted | `QuantityNormalizationError` is not a `CrudHttpError` and no caller catches it; the pre-change code returned the raw quantity on all five failure paths | 5.1 |
| #8 unrelated edits recompute a historical Sales snapshot | **Rejected** | `normalizeLineUom` recomputed on every upsert before this branch too; only the rounding *source* changed | — |
| #9 public UoM errors moved 400 → 422 | Accepted | `uom.conversion_not_found` / `uom.invalid_factor` were `CrudHttpError(400)` | 5.2 |
| #10 declared events are never emitted | Accepted | `emitManufacturingEvent` has exactly one occurrence in the repo — its own definition | 5.5 |
| #11 `unresolvedProduceCount` counts resolved children | Accepted | Both call sites count `supply_mode='produce'` without consulting target resolution | 5.6 |
| #12 a bad BOM-list cursor returns an empty 200 | Accepted | `listActiveDrafts` returns an empty page where `listLines` in the same file returns `staleCursor` | 5.6 |
| #13 listing is N+1 | Accepted | Two counts per row, and a target resolution per line including `stock` lines | 5.6 |
| #14 OpenAPI carries no schemas | Accepted | `OpenApiRouteDoc` supports `requestBody`/`schema`; the BOM routes use neither | 5.7 |
| #15–#22, #24 missing tests | Accepted at unit/route level | The spec's own changelog already records the gap | 5.8 |
| #23 exact-decimal matrix | Accepted (narrow) | 4 cases for 9 exported functions | 5.8 |
| #25–#27 PR size and unrelated commits | Acknowledged, not acted on | Splitting 33 landed commits would rewrite the reviewed history four stacked PRs depend on | — |

- [x] 5.1 Restore per-product and per-request tolerance in the two Catalog normalization callers — 8aa11eb79
- [x] 5.2 Keep the pre-existing 400 status for the two public Sales UoM error codes — 8aa11eb79
- [x] 5.3 Apply guard `modifiedPayload` and move `afterSuccess` after commit across all seven BOM routes — be6d58e38
- [x] 5.4 Make every BOM undo semantic: compare recorded state, revalidate the graph, order custom fields last — be6d58e38
- [x] 5.5 Emit the seven declared Manufacturing events after commit, undo and redo — be6d58e38
- [x] 5.6 Count only unresolved produce lines, reject stale BOM-list cursors, batch the list queries — be6d58e38
- [x] 5.7 Document request and response schemas on the BOM routes — be6d58e38
- [x] 5.8 Add the executable coverage for everything above — 0b5df69b7
- [x] 5.9 Run the validation gate and push

Gate on `5fe4cd437` (local runner, Windows host): `build:packages` ✅, `generate` ✅, `build:packages` ✅,
`i18n:check-sync` ✅, `i18n:check-usage` ✅ (advisory-only, 3828 pre-existing unused keys), `typecheck` ✅
28/28, `test` ✅ for every package this resume touched — `@open-mercato/manufacturing` 17 suites / 110 tests,
`@open-mercato/core` 11854 passed, `@open-mercato/shared` 2169 passed, `@open-mercato/cli` 1815 passed,
`@open-mercato/ui` 1942 passed — and `build:app` ✅.

The nine remaining failures are the Windows-only set already recorded under Phase 3, re-confirmed by name on
this run: `attachments/localDriver` (4), `warranty_claims/quantity` (2), `likeFilterWarning` (1),
`queue/local.strategy` (1-2, flaky EPERM), plus the `create-mercato-app` and `open-mercato-docs` cases. None
of them imports a file this phase changed.

### Phase 5 addendum: self-review of the resume diff

A code review of `7959aa8bb..HEAD` — the resume own output, not the PR as a whole — raised five issues,
all fixed in `668a09e6b`:

| Finding | Why it mattered |
|---|---|
| Sales normalisation `catch` relabelled any thrown value | A dropped connection reached the client as a 422 UoM validation error carrying a Postgres SQLSTATE as its `error` |
| Create-undo skipped its state guard when the draft was missing | A soft-deleted draft disabled the comparison, so the family was soft-deleted unguarded in exactly the drift case the guard exists for |
| `loadDirectLineSummaries` hydrated every produce occurrence | Traded an N+1 for a large managed-entity load on the path the O(V+E) benchmark targets, and polluted the identity map before `em.map` |
| The list route documented one of two 400 bodies | A generated client parsing `validation_error` would fail on the cursor rejection |
| `emptyDirectLineSummary` was an exported mutable singleton | A caller mutating the fallback would corrupt every later lookup in the process |

A sixth suspicion — that the grouped-count Kysely form deviated from the repo idiom and might not compile —
was checked against a real query compiler and disproved, so nothing was changed for it. `repository.sql.test.ts`
now compiles both read queries through Kysely `DummyDriver` and asserts the emitted SQL and bound
parameters, closing the gap where a malformed query would pass every mocked suite.

- [x] 5.10 Review the resume diff and fix what the review found — 668a09e6b

Gate re-run on `668a09e6b`: `build:packages` ✅ 28/28, `typecheck` ✅, `test` ✅ (`@open-mercato/manufacturing`
18 suites / 116 tests, `@open-mercato/core` 11854 passed with the same six Windows-only failures),
`build:app` ✅. `generate` and the two i18n checks were not re-run: the review fixes touched no module
discovery surface, no route file set and no locale file.

### Phase 6: Refine the BOM list and authoring workspace (2026-09-03 resume)

The user supplied four visual references and an explicit UI refinement brief. The screenshots are treated
as visual examples only; the requested outcomes below define the scope. Existing API and persistence
contracts remain unchanged, including the internal `revisionLabel` field name.

- [x] 6.1 Add the standard BOM search control, keep Filters and Perspectives on the right, and integrate visible pagination into the list card — e6883ce52
- [x] 6.2 Recompose the create/edit form as a framed workspace with one basic-data section and optional custom fields on the right — e6883ce52
- [x] 6.3 Rename the user-facing revision-label copy to Notes across all locales and enlarge the BOM-line dialog — e6883ce52
- [x] 6.4 Add regression coverage, run the validation gate, complete the DS review, and push — validation recorded below

Phase 6 gate (local runner, Windows host): `build:packages` ✅ 28/28 on both configured passes,
`generate` ✅, `i18n:check-sync` ✅, `i18n:check-usage` ✅ (advisory-only, 3830 unused keys),
`typecheck` ✅ 28/28, `build:app` ✅, `lint:ds` ✅ with 0 errors (227 pre-existing warnings), and
`ds:tokens:check` ✅. After the review autofix, the Manufacturing suite passed 19/19 suites and 126/126 tests,
including 10/10 focused BOM-list cases. The PR's Manufacturing Jest pattern was made platform-neutral, so the
root `yarn test` now discovers and passes the complete Manufacturing suite in this Windows linked worktree. The
root command still exits non-zero on the pre-existing Windows path-separator assertion in
`open-mercato-docs#test` (`record_locks` and `security` enterprise grouping); 33 of 35 tasks completed before
that failure, including Manufacturing. The scoped code/DS review found and fixed one pagination reachability
issue: search no longer collapses the keyset pager to a single page. The PR-wide review still carries
the previously reported integration-level asks for live PostgreSQL concurrency/atomicity coverage, Playwright
authoring coverage, and the graph benchmark; Phase 6 does not claim those older PR-wide gaps are closed.
