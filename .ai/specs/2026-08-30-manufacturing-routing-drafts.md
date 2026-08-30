# Manufacturing Routing Families and Initial Draft (P1.5a)

## TLDR

P1.5a adds a reusable routing family and atomically creates its first editable draft revision. It establishes stable family/revision identities, revision-root optimistic concurrency, and reversible aggregate CRUD without adding operations, release, scheduling, BOM linkage, search, cache, or stock behavior.

It is independently deployable from P1.5b/P1.5c only after the P1.0a `manufacturing` package/module and [CrudForm Mutation Resource Override](2026-08-30-crudform-mutation-resource.md) are delivered at compatible versions.

This P1.5a/P1.5b split refines the roadmap's earlier aggregate statement that P1.6 precedes P1.5: P1.6 gates P1.5b operation authoring and Work Centre references, not this product-neutral family/initial-revision foundation. P1.5a neither stores nor resolves a Work Centre.

## Problem Statement

Manufacturing needs a stable process-definition identity before operation authoring and release exist. A family remains reusable while each editable or released definition has a distinct revision. Concurrent header and future child edits must conflict against the same revision-root token.

## Proposed Solution

Introduce one aggregate containing a stable family and exactly one initial draft revision. Creation persists both rows in one command transaction. Update and delete target family fields but lock and version the supplied active draft, keeping audit history family-rooted and mutation guards revision-rooted.

Using family `updated_at` as the token is rejected because later operation writes belong to the revision. Independent revision CRUD is rejected because later revision allocation and release belong to P1.7.

## Scope

In scope:

- Aggregate CRUD for a routing family with required `code` and `name`, optional `description`, and its initial draft.
- Revision `1` with `status='draft'`.
- Scoped ACL, revision-root optimistic locking, audit undo/redo, i18n, OpenAPI, typed events, and integration tests.
- Backend list, create, detail, edit, and delete flows.

Out of scope:

- Operations and Work Centre references; see [P1.5b](2026-08-30-manufacturing-routing-operations.md).
- Reordering; see [P1.5c](2026-08-30-manufacturing-routing-operation-reordering.md).
- Release, later revisions, BOM/product/site linkage, scheduling, orders, stock, global search, cache, custom fields, import/export, and bulk operations.

## Architecture

The capability belongs to the P1.0a `manufacturing` module and introduces one aggregate:

```text
Routing family (stable audit/navigation identity)
  └── Active draft revision 1 (mutation and optimistic-lock root)
```

`routingId` always identifies the family; `routingRevisionId` always identifies a revision. Later lifecycle work must preserve these public meanings.

Creation writes both rows atomically. Update/delete lock the scoped family followed by the supplied active draft, verify the relationship, enforce the expected revision version through the DI-overridable command guard, and mutate in one transaction. Routes never persist directly.

Every effective update, delete, undo, or redo atomically advances revision `updated_at`, even when only family fields change. A semantic no-op does not write, emit, audit, or advance the token. Restores never copy historical timestamps.

List and detail are custom read routes because they return a family joined to its active-draft summary and use an opaque keyset cursor rather than the standard CRUD paging shape. Aggregate mutations are custom because they span both rows. Custom writes use per-method metadata, the complete mutation-guard registry plus legacy bridge, Zod revalidation after transformed payloads, trusted scope overwrite, CommandBus, post-commit callbacks, canonical CRUD side effects, and typed events. No route registers a query index in P1.5a.

Identity mapping:

| Concern | Resource |
|---|---|
| Form record | `manufacturing.routing` / `routingId` |
| Version history and audit operation | `manufacturing.routing` / `routingId` |
| Mutation/Enterprise lock root | `manufacturing.routing_revision` / `routingRevisionId` |

Create passes `mutationResource={{ resourceKind: 'manufacturing.routing_revision' }}` without an ID. Edit/delete include `routingRevisionId`. Detail responses expose the active revision token as top-level `updatedAt`, and `CrudForm` derives the header from that `initialValues.updatedAt`. Family freshness is exposed separately as `familyUpdatedAt` and is never used as an optimistic-lock token.

## Data Model

Every row contains `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, and `deleted_at`. Every read, lock, restore, and write is tenant/organization scoped.

### `ManufacturingRouting`

Table `manufacturing_routings`:

- `code`: trimmed display string, 1–120 characters.
- `code_normalized`: system-owned lowercase value; never accepted from clients.
- `name`: trimmed string, 1–240 characters.
- `description`: nullable trimmed plain text, maximum 4,000 characters; empty becomes `null`.

Family `updated_at` is list/audit freshness, not the interactive version. Constraints/indexes:

- unique `(tenant_id, organization_id, id)` parent key;
- partial unique `(tenant_id, organization_id, code_normalized)` where `deleted_at IS NULL`;
- keyset list `(tenant_id, organization_id, updated_at DESC, id DESC)` where live.
- keyset code list `(tenant_id, organization_id, code_normalized ASC, id ASC)` where live.

### `ManufacturingRoutingRevision`

Table `manufacturing_routing_revisions`:

- `routing_id`: scoped composite FK to the family;
- immutable positive integer `revision_number`;
- `status`, constrained to `draft` in P1.5a;
- `updated_at` as the aggregate version.

Constraints/indexes:

- unique `(tenant_id, organization_id, id)`;
- non-partial unique `(tenant_id, organization_id, routing_id, revision_number)`, including deleted rows;
- partial unique `(tenant_id, organization_id, routing_id)` where `status='draft' AND deleted_at IS NULL`;
- lookup `(tenant_id, organization_id, routing_id, status, deleted_at)`.

P1.5a creates only revision `1`. Detail deterministically selects the database-guaranteed live draft. `activeDraft: null` is reserved for later lifecycle/transitional readability; P1.5a never leaves it after a successful non-delete command.

Soft deletion is root-gated rather than cascading. Children added by later capabilities remain stored with their existing deletion state but are unreadable and unwriteable because every child path must first resolve a live family and revision. Undo of the parent delete exposes the same retained children again. Later child specs must preserve this rule; physical retention/purge is separate lifecycle scope. This keeps P1.5a independent from future child tables and keeps delete evidence bounded.

## Validation and Data Protection

Inputs use Zod-derived schemas; IDs are UUIDs, unknown fields are rejected, scope comes only from trusted context, and normalization repeats after guard transformation.

`name` and `description` may hold confidential/personal text. `packages/manufacturing/src/modules/manufacturing/encryption.ts` adds them to `defaultEncryptionMaps: ModuleEncryptionMap[]`; reads use `findWithDecryption`/`findOneWithDecryption`. No hand-rolled crypto is allowed. Events/logs exclude both fields. `code` and `code_normalized` stay plaintext business identifiers for deterministic uniqueness.

Only the bounded returned page is decrypted. P1.5a sorts by `updatedAt`, `code`, or `id`; encrypted fields are not filtered/sorted. Description is escaped plain text.

## ACL and API Contracts

Additive features:

- `manufacturing.routing.view` for list/detail;
- `manufacturing.routing.manage` for writes and current-permission undo/redo.

`setup.ts` applies the intended default-role grants. Every route exports `openApi` and per-method `metadata` with `requireAuth` and `requireFeatures`.

| Method | Path | Feature | Request | Success |
|---|---|---|---|---|
| `GET` | `/api/manufacturing/routings` | `view` | `limit?: 1..100`, opaque `cursor?`, `sort?: familyUpdatedAt_desc\|code_asc` | `RoutingListDto` |
| `POST` | `/api/manufacturing/routings` | `manage` | `RoutingCreateInput` | `201 RoutingDetailDto` |
| `PUT` | `/api/manufacturing/routings` | `manage` | `RoutingUpdateInput` | `200 RoutingMutationResult` |
| `DELETE` | `/api/manufacturing/routings` | `manage` | `RoutingDeleteInput` | `200 RoutingDeleteResult` |
| `GET` | `/api/manufacturing/routings/:routingId` | `view` | UUID path | `200 RoutingDetailDto` |

```ts
type RoutingCreateInput = { code: string; name: string; description?: string | null }
type RoutingUpdateInput = RoutingCreateInput & { id: string; routingRevisionId: string }
type RoutingDeleteInput = { id: string; routingRevisionId: string }
type ActiveDraftDto = {
  routingRevisionId: string
  revisionNumber: number
  status: 'draft'
  updatedAt: string
}
type RoutingSummaryDto = {
  id: string
  code: string
  name: string
  description: string | null
  familyUpdatedAt: string
  activeDraft: ActiveDraftDto | null
}
type RoutingListDto = { items: RoutingSummaryDto[]; nextCursor: string | null }
type RoutingDetailDto = RoutingSummaryDto & {
  // Alias of activeDraft.updatedAt for CrudForm optimistic-lock derivation.
  // It is null exactly when activeDraft is null; no mutation UI is rendered then.
  updatedAt: string | null
}
type RoutingMutationResult = { item: RoutingDetailDto; changed: boolean }
type RoutingDeletedDto = {
  id: string
  routingRevisionId: string
  updatedAt: string
  deletedAt: string
}
type RoutingDeleteResult = { item: RoutingDeletedDto; changed: true }
```

The cursor binds sort, last value/ID, tenant, and organization; reuse across scope/sort is rejected. `familyUpdatedAt_desc` keys from family `updated_at`; `code_asc` keys from `code_normalized`. Default limit is 50, maximum 100. Family plus draft summaries use a bounded query count independent of page size.

Update/delete enforce the supplied `x-om-ext-optimistic-lock-expected-updated-at` against the revision token. The first-party UI always supplies it; header-less external clients retain the platform's additive compatibility behavior rather than receiving a new mandatory-header error. For detail and successful update responses, top-level `updatedAt` equals `activeDraft.updatedAt`; `familyUpdatedAt` never populates the header. When `activeDraft` and top-level `updatedAt` are null, the UI renders no update/delete affordance. Scope/version body fields are ignored/rejected.

Effective mutations include `x-om-operation`. No-op update returns `changed:false`, current revision token, and no operation header. Delete returns `RoutingDeleteResult`: the family ID, owned revision ID, revision's advanced `updatedAt` token, and the shared soft-delete marker as `deletedAt`; it does not serialize a live `RoutingDetailDto` after deletion. Later detail reads return non-disclosing not-found.

| Status | Code | Meaning |
|---|---|---|
| `400` | `validation_error` | Invalid path/query/body/header/cursor. |
| `403` | `forbidden` | Required feature absent, including undo/redo. |
| `404` | `routing_not_found` | Missing, foreign, deleted, or mismatched pair. |
| `409` | `routing_code_conflict` | Live same-scope normalized code exists. |
| `409` | `optimistic_lock_conflict` | Revision token is stale. |
| `409` | `routing_restore_conflict` | Undo/redo preconditions no longer hold. |

OpenAPI documents all DTOs, guards, headers, cursor rules, errors, and conditional operation header.

## Commands, Events, and Undo/Redo

Public IDs:

- `manufacturing.routing.{create,update,delete}`;
- `manufacturing.routing.{created,updated,deleted}`.

Events use `createModuleEvents({ moduleId: 'manufacturing', events } as const)`. Payloads contain trusted scope, family/revision IDs, and revision number—never business text, ORM/request objects, audit-log IDs, or undo tokens. The audit operation identity is created later by CommandBus and is returned only through the canonical operation metadata/header path. Side effects and guard callbacks run after commit; failure is structured-logged and does not change committed success.

Audit root is family `manufacturing.routing` / `routingId`. Evidence is bounded to the family and initial revision states needed by the inverse and follows platform audit encryption.

### Create

- Execute inserts family and revision `1` atomically.
- Undo requires both owned rows and the current revision token to match the created evidence, then soft-deletes both with one marker.
- Redo restores the same IDs only when deleted evidence matches, code is free, and no competing live draft/revision `1` exists.

### Update

- Execute stores before/after normalized family state and advances the revision token only when effective.
- Undo/redo requires current family state and revision token to equal the expected opposite evidence side. A later revision-root mutation conflicts without P1.5a knowing which later capability caused it.
- Restored code is rechecked for live scoped uniqueness.

### Delete

- Execute records live owned state, soft-deletes revision then family atomically, and preserves IDs/deletion marker; it does not enumerate or mutate later child tables.
- Undo restores the same IDs only when deleted state matches, code is free, and no competing draft/revision exists.
- Redo requires matching restored live state and repeats scoped deletion.

Undo/redo rechecks current `manage`, trusted scope, family-then-revision lock order, relationship, uniqueness, marker, and semantic state. It does not use the historical HTTP token. Each effective inverse creates a new operation, emits the corresponding event post-commit, and advances timestamps.

## UI/UX

Navigation exposes **Manufacturing → Routings** at `/backend/manufacturing/routings`. The list uses `DataTable` with `entityId='manufacturing.routing'`, keyset paging, and `ListEmptyState`. Forms use `CrudForm`, `createCrud`/`updateCrud`/`deleteCrud`, `createCrudFormError`, and the identity mapping above. HTTP stays `apiCall`-based; CrudForm owns guarded mutations/conflicts and is not double-wrapped.

`activeDraft:null` is returned with top-level `updatedAt:null` and is readable without mutation affordances. `RoutingFormClient` receives the detail DTO without remapping the revision token: `initialValues.updatedAt` is the top-level alias of `activeDraft.updatedAt`, while `familyUpdatedAt` remains display/list metadata. Use canonical loading/error/form/confirmation/conflict primitives, translated copy, keyboard behavior, and accessibility. No hardcoded strings/colors/sizes, inline SVG, or unsafe HTML.

### Frontend Architecture Contract

| Surface | Server root | Client islands | Data owner |
|---|---|---|---|
| list | `page.tsx` | `RoutingTableClient` | list API |
| create | `page.tsx` | `RoutingFormClient` | create API |
| detail/edit | `page.tsx` | `RoutingFormClient` | detail/update/delete APIs |

| Client file | Exact reason | Heavy deps | Risk/guardrail |
|---|---|---|---|
| `RoutingTableClient.tsx` | DataTable cursor/sort/navigation state | DataTable only | Reset cursor on sort; ≤300 LOC. |
| `RoutingFormClient.tsx` | CrudForm state, mutations, conflict refresh | CrudForm only | Byte-equivalent detail DTO with revision-token `updatedAt`; ≤300 LOC. |

Budgets: zero page/layout-root `"use client"`, global providers, heavy browser libraries, or client islands over 300 LOC; `yarn check:client-boundaries` passes. Playwright loads every route without hydration errors and covers paging/create/edit/conflict/delete. Record one production build/bundle signal and confirm no route-root client chunk anomaly.

## Search, Indexing, Cache, and Performance

No `search.ts`, CRUD query-index registration, global query-index, vector/fulltext/token search, or encrypted search storage. A future capability must design projection and invalidation separately.

No cache: list/detail are indexed scoped queries; cold/warm paths are identical, so no keys/tags/TTL/invalidation exist. Keyset reads and batch draft enrichment have query count independent of page size. No unbounded arrays, background jobs, or commands touching more than two aggregate rows.

## Edge Cases & Failure Scenarios

- Code collision returns stable `409` without SQL details.
- Missing/foreign/deleted/mismatched family/revision share one `404`.
- Stale token conflicts before mutation; family-only effective update advances it; no-op does not.
- Failure between family and revision insert rolls back both.
- Undo/redo conflicts with later revision-token changes, code/draft/revision occupation, or marker mismatch.
- Forged/cross-scope/cross-sort cursor returns `400`.
- `activeDraft:null` never creates an implicit draft.
- Later child rows remain retained but inaccessible while their family/revision is deleted and become visible unchanged after valid undo.
- Post-commit failure is logged with IDs without changing success.
- Encrypted text is decrypted only for authorized bounded reads and escaped on render.

## Migration & Backward Compatibility

One additive migration creates both tables, scoped keys/FKs, checks, uniqueness, and indexes. There is no backfill or requirement to run `yarn db:migrate`. Entity changes and package snapshot stay synchronized; generated SQL is reviewed for unrelated output.

Generated entity, route, ACL, command, event, resource-kind, and DTO IDs become additive contracts. P1.7 may add statuses/revisions but preserves IDs, immutable revision numbers, nullable `activeDraft`, routes/errors/events, audit ownership, and revision-root locking.

Rollback is schema-preserving. Physical removal needs a separately reviewed migration proving no tenant data, audit, subscriber, or later capability depends on it. Incompatible changes follow `BACKWARD_COMPATIBILITY.md` deprecation/bridge/upgrade-note rules.

## Testing

Self-contained integration tests create API fixtures and clean them in `finally`/teardown. Coverage includes:

- migration constraints, scoped FKs, revision/draft/code uniqueness;
- tenant/organization isolation for every read/write/cursor/undo/redo;
- every route's metadata, ACL, OpenAPI schema, statuses, errors, headers, distinct update/delete response DTOs, and timestamp semantics;
- atomic create rollback and active-draft selection;
- effective/no-op update, delete result identity/token/marker, family-only token advance, separation of `familyUpdatedAt` from revision `updatedAt`, stale conflict, header-less compatibility;
- create/update/delete undo/redo with same IDs, expected revision tokens, monotonic timestamps, permissions, collisions, competing state, and marker conflicts;
- P1.5a command tests prove parent delete/restore never enumerate unknown child tables; P1.5b owns the first concrete child-retention integration test, proving deleted parents block operation reads/writes without cascading and valid restore exposes unchanged operations;
- post-commit injected failure;
- tied-key cursor traversal, limit, forged/cross-scope rejection, bounded queries/no N+1;
- list/create/detail/edit/delete UI, null draft, conflict refresh, full field reload persistence, i18n, keyboard, accessibility, hydration, and escaping;
- Enterprise family-history/revision-lock identity;
- prerequisites enabled and Manufacturing-disabled discovery behavior.

## Phasing

- **Phase 1:** entities, migration, encryption, validation, ACL/setup, repository, locking, commands/events, undo/redo.
- **Phase 2:** list/detail/mutation API, metadata, guards, OpenAPI, errors.
- **Phase 3:** server page shells, bounded client islands, i18n/accessibility/conflicts.
- **Phase 4:** integration matrix, discovery, frontend boundaries, full gate.

## Implementation Plan

1. Verify delivered compatible P1.0a and `CrudForm.mutationResource`, generated IDs, package discovery, migration ownership, and snapshot; stop if absent.
2. Add entities, indexes/constraints, validators, encryption, ACL/setup, repository, and locking; generate/review migration and snapshot.
3. Add commands with monotonic token, bounded audit evidence, semantic undo/redo, events, and post-commit effects; keep command tests green.
4. Add keyset list/detail and guarded aggregate routes with metadata, OpenAPI, errors, and operation headers; keep API tests green.
5. Add server pages and bounded DataTable/CrudForm islands with identity separation, i18n, accessibility, and conflicts; keep UI/hydration tests green.
6. Run `yarn generate`, migration checks, focused tests, `yarn check:client-boundaries`, and configured validation with one recorded runner.

## Risks & Impact Review

| Severity | Scenario / impact | Detection | Mitigation | Residual |
|---|---|---|---|---|
| High | Family update fails to advance revision token. | Concurrent stale-write test. | Atomically touch revision on every effective mutation. | Database timestamp authority remains shared platform behavior. |
| High | Undo restores over later work/occupied code/draft. | Semantic/collision/concurrency tests. | Stable locks, same-ID evidence, conflict instead of overwrite. | Old operations may become intentionally non-undoable. |
| High | Custom route omits scope/ACL/guard/OpenAPI. | Route inventory integration matrix. | Metadata, trusted scope, full guards, shared errors. | Future routes need the same gate. |
| Medium | UI confuses family/audit/revision identities. | Three-identity Enterprise test. | Frozen kinds and explicit mapping. | Bad third-party setup may degrade rich UX, not OSS guard. |
| Medium | Encryption causes unbounded reads/sort. | Query/page/schema tests. | Decrypt ≤100; exclude encrypted sorting/filtering. | Bounded page still has decryption cost. |
| Medium | Post-commit callback fails. | Injected failure/log test. | Catch/log and return committed result. | Projection can briefly lag. |
| Medium | Parent deletion or restore corrupts future child history. | P1.5b contract/integration tests exercise retained children across parent delete/undo. | Root-gated visibility; never cascade or snapshot later child tables in P1.5a. | Physical purge requires a separate lifecycle design. |

## Final Compliance Report — 2026-08-30

Reviewed: root/spec/core/UI/backend/events/cache/CLI/QA `AGENTS.md` files and `BACKWARD_COMPATIBILITY.md`.

| Area | Status | Evidence |
|---|---|---|
| Placement/naming/isolation | Compliant | One module, singular IDs, scoped rows/queries, no cross-module ORM. |
| Data/migration/encryption | Compliant | Exact schema/indexes, additive migration, maps and decryption-aware reads. |
| Concurrency/commands/undo | Compliant | Revision DI guard, monotonic token, conditional same-ID inverses. |
| API/OpenAPI | Compliant | DTOs, metadata/ACL/guards, headers/errors/cursor. |
| UI/HTTP/DS/frontend | Compliant | Server roots, bounded islands, canonical components/helpers, budgets/tests. |
| Events | Compliant | Typed, scoped, content-free, post-commit. |
| Cache/search/bulk | N/A compliant | Explicitly excluded with indexed direct reads. |
| Testing/compatibility | Compliant | Self-contained path matrix and additive rollback contract. |

Internal consistency passes: models map to DTOs/commands; API maps to UI; risks cover all writes; cache/search are explicit N/A; adjacent P1.0a/P1.5b/P1.5c/P1.7 boundaries agree.

**Verdict:** fully compliant at specification level, gated on delivered prerequisites. No product code is authorized by this documentation task.

## Changelog

### 2026-08-30

- Split routing family/initial draft from operation authoring and reordering.
- Added migration, compatibility, and data-protection contracts.
- Remediated review findings: monotonic revision token, complete API/errors, command-specific undo/redo, indexes/keyset paging, mutation identities, frontend boundaries, cache/search exclusions, risk evidence, and prerequisite gates.
- Clarified timestamp ownership: `familyUpdatedAt` is list/audit freshness, while detail-only `updatedAt` is the active revision token consumed by `CrudForm`; defined a separate minimal `RoutingDeleteResult` instead of returning a live detail DTO after deletion.
- Clarified that the expected-version header is enforced when supplied while header-less callers retain the platform compatibility path; excluded not-yet-created audit operation IDs and undo tokens from event payloads; assigned concrete future-child retention coverage to P1.5b.

### Review — 2026-08-30

- **Reviewer**: Agent, with fresh-context scope-cohesion review.
- **Security**: Passed; scope, ACL, Zod, non-disclosing errors, encryption, escaping, and content-free events are explicit.
- **Performance**: Passed; keyset list, indexes, bounded queries/decryption, and no N+1.
- **Cache**: N/A; no cache or global search projection.
- **Commands**: Passed; atomic, revision-versioned, audited, and conditionally reversible with same IDs.
- **Risks**: Passed; material scenarios include detection, mitigation, and residual risk.
- **Verdict**: Approved at specification level, gated on delivered prerequisites.
