# Manufacturing Routing Operation Reordering (P1.5c)

## TLDR

P1.5c adds an explicit action for moving an operation before another operation or to the end of an active routing draft. Reordering is atomic, revision-locked, bounded to 1,000 operations, and safe when sparse positions require renumbering.

## Problem Statement

Append-only operation authoring is independently useful, but authors eventually need to correct sequence without deleting and recreating operations. Reordering must not corrupt order or expose partial state under concurrency.

## Scope

In scope:

- Move one live operation before another live operation or to the end.
- Idempotent no-op detection.
- Sparse-position allocation and collision-safe bounded renumbering.
- Revision-root optimistic locking, undo/redo, stable errors, UI interaction, and tests.

Out of scope:

- Arbitrary client-supplied positions, parallel branches, dependencies, drag-across-routings, scheduling, and background/eventual reorder.

Prerequisite: fully delivered [P1.5b](2026-08-30-manufacturing-routing-operations.md).

## Architecture

Reorder is a custom command and route inside the existing routing-revision aggregate. It takes the same scoped family-then-revision locks as P1.5a/P1.5b, verifies the expected revision version, and locks the bounded live operation set before calculating the new order.

The request expresses intent as `operationId` plus nullable `beforeOperationId`; it never accepts a numeric position. A move that already matches the requested semantic order returns `changed: false` and creates no audit entry, event, or operation header.

When a gap exists, the moved operation receives an integer between its new neighbors. When no safe integer gap exists, the command renumbers the locked live set in deterministic `(position,id)` order. Because live-position uniqueness is non-deferrable, renumbering uses two set-based updates through temporary unoccupied positions followed by final sparse positions. No statement or row count may grow beyond the 1,000-operation aggregate bound.

The command owns transaction-local lock and statement timeouts. Timeout values must be validated on the reference PostgreSQL runner and mapped to a stable retryable response; deployment defaults are not assumed.

## API Contract

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/manufacturing/routings/:routingId/revisions/:routingRevisionId/operations/reorder` | Move an operation before another operation or to the end. |

Request:

```ts
{
  operationId: string
  beforeOperationId: string | null
}
```

The route rejects missing, foreign, deleted, cross-revision, or self-target records without disclosure. Effective reorder returns the new revision `updatedAt`, `changed: true`, and `x-om-operation`. A semantic no-op returns the current token and `changed: false`.

Stable errors cover validation/not-found, optimistic-lock conflict, unsafe or exhausted ordering space, and retryable lock/statement timeout. Timeout responses include `Retry-After` and never relabel client cancellation.

Command and event:

- `manufacturing.routing_operation.reorder`
- `manufacturing.routing_operation.reordered`

The event contains scoped IDs and movement intent/result metadata, not operation text.

## Concurrency and Undo

Every effective reorder advances the revision version and timestamps of operations whose stored positions changed. Audit evidence stores the prior and resulting ordered `{id, position}` map for the bounded changed set.

Undo and redo take the same locks and compare semantic order plus expected live IDs before mutation. They conflict rather than overwrite later add/delete/edit/reorder work. Restored versions always advance; timestamps are not copied from history.

## UI/UX

The P1.5b editor adds a keyboard-accessible move interaction. It uses `useGuardedMutation`, revision mutation-resource identity, an execution-time latest-token getter, and standard conflict recovery. A timeout shows a translated retryable state; retry is always explicit.

The UI does not optimistically display an order that the server has not committed. After success it replaces the shared revision token and reloads the affected cursor window.

## Performance Contract

The normative guarantees are:

- One atomic foreground transaction.
- At most 1,000 locked/renumbered operations.
- Set-based renumbering with no per-row SQL loop and no N+1 behavior.
- Bounded audit evidence, capped at 256 KiB serialized.
- Transaction-local lock and statement timeouts with full rollback.
- Safe-integer positions in persistence, DTOs, and cursors.

The reference implementation is expected to use one staging and one final bulk position update. Exact total SQL statement count is recorded as a diagnostic rather than a permanent public contract; readiness is based on bounded behavior and measured median/p95 on the named PostgreSQL runner.

## Failure Scenarios

- Stale token or concurrent sequence change returns a conflict without partial updates.
- Lock or statement timeout rolls back positions, version, audit, and event effects.
- Missing safe staging/final positions fails before mutation.
- Undo/redo conflicts when the live operation set or semantic order no longer matches.
- Client cancellation remains cancellation and is not mapped to a database timeout.

## Migration & Backward Compatibility

P1.5c adds no entity or table. Any supporting index/check adjustment must be additive and remain compatible with P1.5b append semantics. The reorder route, command/event IDs, request intent, error codes, and `changed` behavior become additive public contracts.

Rollback disables the reorder route and UI while preserving P1.5b append authoring and all stored positions. A rollback must not renumber or delete data. Any later ordering representation must preserve observable operation order and bridge the existing numeric-position contract according to `BACKWARD_COMPATIBILITY.md`.

## Testing

Ship self-contained integration coverage for:

- Move before, move to end, no-op, invalid targets, scope isolation, ACL, and OpenAPI.
- Concurrent reorder/add/delete and stale revision tokens.
- Forced gap exhaustion with collision-safe renumbering and safe-integer bounds.
- Timeout rollback and explicit retry without misclassifying client cancellation.
- Undo/redo conflict behavior and bounded evidence.
- Maximum-size median/p95 diagnostics on the named PostgreSQL runner.
- Keyboard/accessibility behavior, translated conflicts/timeouts, and token refresh in the editor.

## Phasing and Implementation Plan

1. Add reorder command, deterministic ordering helper, timeout mapping, undo/redo, and event.
2. Add the guarded reorder route and OpenAPI contract.
3. Add accessible move controls and explicit retry/conflict handling.
4. Run forced-renumber, concurrency, rollback, performance, and UI tests plus the configured validation gate.

## Risks and Exit Criteria

| Risk | Control |
|---|---|
| Unique-position collision corrupts order | Locked set and collision-safe two-pass set-based renumbering. |
| Reorder overwrites concurrent work | Revision token plus semantic undo/redo comparison. |
| Maximum reorder holds locks too long | Aggregate cap, local timeouts, measured performance, explicit retry. |
| Algorithm becomes the public contract | Public API expresses semantic intent; SQL counts remain diagnostics. |

P1.5c is ready when normal and forced-renumber moves are atomic, concurrency-safe, reversible, bounded, performant on the reference runner, and covered in the editor.

## Changelog

### 2026-08-30

- Extracted manual reorder and renumbering from operation authoring.
- Replaced brittle exact-statement requirements with bounded behavioral and measured performance contracts.
