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

- [ ] 2.1 Declare the `react-is` peer on `@open-mercato/manufacturing` so the published-package gate passes
- [ ] 2.2 Hoist the `Page`/`PageBody` shell into the two BOM `page.tsx` route files
- [ ] 2.3 Pin `browserslist` above the advisory range through the root `resolutions` block
- [ ] 2.4 Run the validation gate on the changed surface and push
