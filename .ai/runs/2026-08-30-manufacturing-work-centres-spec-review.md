# Execution Plan: Manufacturing Work Centres Specification Review

## Goal

Publish the implementation-readiness corrections and independent re-review for
the Manufacturing Work Centres specification.

## Scope

- Update only the Work Centres specification and this execution record.
- Preserve PR #6 (`feat/manufacturing-p1-0a-bootstrap-p1-4a-bom-authoring`
  → `develop`) as the open P1.0a/P1.4a prerequisite; do not implement
  Manufacturing.
- Open a documentation PR to `Dev4YouPL/open-mercato` against `develop`.

## Non-goals

- No package, runtime-module, API, database, generated-file, or dependency
  implementation changes.
- No branch rebase or attempt to satisfy P1.0a in this documentation PR.

## Implementation Plan

### Phase 1: Review corrections

1. Record the implementation-readiness corrections in the Work Centres spec.
2. Re-review the amended spec independently and record the conditional verdict.

### Phase 2: Publication

1. Validate the documentation diff and commit it with this execution record.
2. Push the branch and open a ready-for-review documentation PR with the
   required labels and review summary.

## Risks

PR #6 is the open P1.0a/P1.4a implementation prerequisite and is deliberately
not an ancestor of the current design branch. This PR documents that gate; it
does not bypass it.

Source doc: `.ai/specs/2026-08-19-manufacturing-work-centres.md`

## Progress

PR: #3 (link: https://github.com/Dev4YouPL/open-mercato/pull/3)

> Convention: `- [ ]` pending, `- [x]` done. Append ` â€” <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Review corrections

- [x] 1.1 Record the implementation-readiness corrections in the Work Centres spec. — cd91f433a
- [x] 1.2 Re-review the amended spec independently and record the conditional verdict. — cd91f433a
- [x] 1.3 Re-verify and apply the PR #6 implementation-base audit corrections while preserving design-only scope. — PENDING_COMMIT

### Phase 2: Publication

- [x] 2.1 Validate the documentation diff and commit it with this execution record. — cd91f433a
- [x] 2.2 Push the branch and open a ready-for-review documentation PR with the required labels and review summary. — c729ff2cb
- [x] 2.3 Validate, commit, and push the PR #6 audit-correction pass. — PENDING_COMMIT
