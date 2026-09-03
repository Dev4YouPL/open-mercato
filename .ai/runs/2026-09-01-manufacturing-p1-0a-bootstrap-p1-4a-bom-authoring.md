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
