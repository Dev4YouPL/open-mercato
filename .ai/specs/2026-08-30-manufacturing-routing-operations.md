# Manufacturing Routing Operation Authoring (P1.5b)

## TLDR

P1.5b adds append-ordered operations to an active routing draft. Authors can create, edit, and remove process steps with optional instructions, Work Centre, and setup/run estimates. Manual reordering is separate P1.5c scope.

## Problem Statement

A routing family is not useful for process authoring until its draft can hold a bounded sequence of production steps. Authoring must remain permissive and must not imply scheduling, capacity, feasibility, or release readiness.

## Scope

In scope:

- Zero to 1,000 operations owned by one active draft revision.
- Create, update, delete, cursor-paged read, and append order.
- Optional instructions, Work Centre, setup minutes, and run minutes.
- Revision-root locking, audit undo/redo, ACL, i18n, OpenAPI, events, and integration tests.

Out of scope:

- Manual reorder and renumbering; see [P1.5c](2026-08-30-manufacturing-routing-operation-reordering.md).
- Release validation, scheduling, capacity, resources, BOM/product/site linkage, orders, and stock.

Prerequisites are [P1.5a](2026-08-30-manufacturing-routing-drafts.md), the P1.6 Work Centre contract, and [CrudForm Mutation Resource Override](2026-08-30-crudform-mutation-resource.md).

## Architecture

Operations are child records inside the P1.5a routing-revision aggregate. They do not receive an independent interactive lock token: every write locks the scoped family and active revision in the P1.5a order and advances the revision `updated_at`. CommandBus owns all mutations; custom routes use canonical mutation guards and CRUD side effects.

The routing detail remains summary-only. Operations are read from a separate bounded cursor collection whose cursor is bound to the revision version. A revision change invalidates the cursor and causes an explicit reload.

Work Centre is a same-module P1.6 reference. The picker consumes P1.6's
conventional scoped collection GET with `isActive=true` and current
`manufacturing.work_center.view`; it is not a separate route. A changed
non-null reference requires the same feature before a scoped live-record
lookup. Missing, deleted, or foreign values share a non-disclosing not-found
response. Omission preserves the value; `null` clears it. Picker failure never
prevents saving an operation without a Work Centre or preserving/clearing an
existing reference.

## Data Model

Table `manufacturing_routing_operations` contains:

- Standard UUID, tenant/organization scope, timestamps, and soft delete.
- Scoped composite FK to `manufacturing_routing_revisions`.
- Positive `bigint position` within the JavaScript safe-integer range, unique among live rows per revision.
- Required trimmed `name`, 1–240 characters; duplicates allowed.
- Nullable trimmed plain-text `instructions`, maximum 8,000 characters.
- Nullable scoped FK to live P1.6 Work Centre, with database referential integrity.
- Nullable non-negative integer `setup_duration_minutes` and `run_duration_minutes`.

`updated_at` is audit freshness; the parent revision is the aggregate version. New operations append with a sparse position. The database and validators enforce numeric bounds; commands enforce the 1,000-live-operation limit while holding the revision lock.

## API Contracts

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/manufacturing/routings/:routingId/revisions/:routingRevisionId/operations` | Cursor-paged operations, maximum 100 per page. |
| `POST` | same collection | Append an operation. |
| `PUT` | `.../operations/:operationId` | Partial operation update. |
| `DELETE` | `.../operations/:operationId` | Soft-delete an operation. |

Create accepts `name` plus optional operation fields. Update requires at least one supplied field. Omitted fields remain unchanged; `null` clears nullable fields; numeric `0` is valid.

Every mutation verifies that the supplied scoped revision is the family's active draft and returns the new revision `updatedAt`. Effective mutations include `x-om-operation`. Stable errors cover validation, scope/not-found, Work Centre authorization/not-found, operation limit, restore conflict, and optimistic-lock conflict.

Commands and events:

- `manufacturing.routing_operation.{create,update,delete}`
- `manufacturing.routing_operation.{created,updated,deleted}`

Events contain scoped IDs and changed-field metadata, not instructions or Work Centre labels.

## UI/UX

The routing detail adds a cursor-paged operation editor. Create/edit uses `CrudForm` with `mutationResource` and the active revision token. Delete uses `useGuardedMutation`, an execution-time latest-token getter, and standard conflict recovery.

The Work Centre picker uses the bounded P1.6 collection and shows active same-scope results. Failure or forbidden access degrades to a localized no-picker state. An existing value that cannot be resolved is shown generically as unavailable without exposing a foreign ID or label.

Names and instructions are escaped plain text. Shared dialogs, keyboard behavior, loading/errors, DS tokens, i18n, and accessibility rules apply.

## Data Protection

Operation names and instructions are user-entered business text and may contain confidential or personal information. They participate in the Manufacturing encryption map when tenant encryption is enabled, are excluded from events and operational logs, and follow platform export, retention, search-index encryption, and soft-delete behavior. Audit evidence stores only the changed record state required for undo and remains bounded.

## Failure Scenarios

- Picker `403` or failure leaves routing-owned authoring available without raw UUID entry.
- Missing/foreign Work Centre values do not disclose record existence across scope.
- A stale revision token conflicts before child mutation.
- A cursor bound to an older revision version is rejected and reloaded.
- Create or restore beyond 1,000 live operations fails without mutation.
- Undo of a deleted operation fails if its historical append position is no longer valid; it never silently chooses another position.

## Migration & Backward Compatibility

This is additive to P1.5a and P1.6. The migration adds the operation table, scoped revision and Work Centre FKs, bounds, indexes, and live-position uniqueness. It must not modify P1.6-owned tables; the required scoped parent key is a readiness prerequisite owned by P1.6.

The operation routes, DTO fields, command/event IDs, error codes, and revision-root locking become additive public contracts. P1.5c may change positions through an explicit reorder action but must preserve append/create/update/delete semantics. P1.7 must preserve operation ownership by revision.

Rollback is schema-preserving. Disable or roll back P1.5b code without dropping operation data. Physical removal requires a separate reviewed migration and dependency audit.

## Testing

Ship self-contained integration coverage for:

- Scoped FKs, tenant isolation, limits, numeric bounds, and append ordering.
- Every API path, OpenAPI, ACL, Work Centre authorization-before-lookup, and stable errors.
- Revision-token conflicts and cursor invalidation.
- Create/update/delete undo/redo, operation-limit restore, and concurrent child mutations.
- Parent delete/restore retention: operation rows are not cascaded, deleted parents block operation reads/writes, and valid parent restore exposes the unchanged operations again.
- Picker search/paging/degradation, unavailable historic value, plain-text escaping, i18n, accessibility, and conflict recovery.
- Bounded list enrichment without N+1 when family list exposes `operationCount`.

## Phasing and Implementation Plan

1. Verify P1.5a, P1.6 scoped Work Centre contract, and shared mutation-resource support.
2. Add operation entity, migration, validators, commands, undo/redo, and events; run `yarn generate`.
3. Add bounded cursor reads and create/update/delete routes with OpenAPI.
4. Add operation editor and degraded Work Centre picker.
5. Run focused tests and the configured validation gate with one recorded runner.

## Risks and Exit Criteria

| Risk | Control |
|---|---|
| Work Centre reference crosses scope | Authorization before scoped lookup plus scoped FK. |
| Child edit bypasses aggregate concurrency | Revision-root guard and token coordinator. |
| Reads or audit payloads become unbounded | Cursor paging, 1,000-row cap, and command-local evidence. |
| Authoring is mistaken for scheduling | Explicit terminology and no capacity/availability behavior. |

P1.5b is ready when append authoring, scoped Work Centre validation, revision locking, undo/redo, bounded reads, and key UI paths pass integration coverage. It is independently deployable without manual reorder.

## Changelog

### 2026-08-30

- Extracted operation authoring from the routing-family and reorder specifications.
- Accepted ownership of the concrete child-retention integration test introduced by P1.5a's root-gated deletion contract.
