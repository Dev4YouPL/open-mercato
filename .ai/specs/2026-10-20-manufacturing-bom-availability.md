# Manufacturing BOM revision availability

## 📝 TLDR

Allow authorized users to withdraw and restore a released BOM revision for new production orders without changing its contents or affecting existing orders.

## 📝 Problem Statement

Released BOM revisions currently remain selectable indefinitely, even when a revision should no longer be used for new production. There is no production-order creation flow yet, so the platform also needs one server-side availability rule that future order creation can call inside its transaction.

## 📝 Proposed Solution

Add a separate availability flag, a guarded command and API, list filtering, a read-only detail-page toggle, and a server-side selection guard for future order creation. Use the implementation sequence and product decisions in [the implementation guide](../../packages/core/src/modules/manufacturing/BOM_AVAILABILITY_IMPLEMENTATION_GUIDE.md).

## 📝 Architecture

`ManufacturingBom.isAvailableForNewOrders` is independent of the lifecycle status. `isBomSelectableForNewOrder` is the shared status-plus-flag rule; `resolveBomAvailability` adds catalog variant checks for list display. The availability mutation follows the existing command, optimistic-lock, mutation-guard, and post-commit event patterns. Future order commands call `requireBomForNewOrder` in their write transaction; no order entity or order flow is introduced here.

The availability action reuses the organization-scoped action context used by BOM release. Existing BOM detail and list pages continue to use the existing API and UI component families.

## 📝 Data Model

Add `manufacturing_boms.is_available_for_new_orders boolean NOT NULL DEFAULT true`. Existing released revisions remain available after migration. Releasing a revision explicitly sets the flag to true, including when a draft was manually set false.

The BOM audit snapshot includes the flag. Availability changes update only this flag and `updated_at`; revision status, release metadata, completeness, quantities, and items remain unchanged.

## 📝 API Contracts

- `POST /api/manufacturing/boms/availability` accepts `{ id, isAvailableForNewOrders }`, requires `manufacturing.manage`, tenant and organization scope from authenticated request context, mutation guards, and the optimistic-lock header. Draft revisions return 409 with `manufacturing.bom_availability.not_released`.
- `GET /api/manufacturing/boms` returns `isAvailableForNewOrders` and effective `availability`. The additive `availableForNewOrders` filter intersects with released status; draft plus this filter returns no rows.
- `requireBomForNewOrder(em, bomId, scope, translate)` uses a fresh, scoped `PESSIMISTIC_READ` BOM read and the same effective availability resolver. An unavailable revision returns 422 with `manufacturing.bom.unavailable_for_new_orders` and a reason.
- A successful availability change emits CRUD `manufacturing.bom.updated` and lifecycle `manufacturing.bom.availability_changed` after commit. The action response has no operation undo header; restoring availability is a new versioned mutation.

## 📝 UI/UX

On released BOM details, show the availability badge and a `SwitchField`. Turning availability off asks for confirmation; turning it on does not. Writes run through `useGuardedMutation` with optimistic locking, and version conflicts use the shared conflict surface. Released forms and items stay read-only.

## 📝 Edge Cases & Failure Scenarios

- A draft BOM cannot be toggled, even if its persisted flag is true.
- A stale record version returns the standard optimistic-lock 409, including for a no-op request with a stale version.
- A current-version no-op returns the current state without updating `updated_at` or emitting events.
- Missing, deleted, or cross-organization BOMs return not found.
- A released but withdrawn revision reports `withdrawn` before catalog-variant problems so the user sees the deliberate withdrawal reason.
- The order-selection guard distinguishes draft, withdrawn, missing variant, and inactive variant. Existing orders are not looked up or modified.
- An error from an after-success mutation guard is handled by the route guard contract; domain events and indexing are queued through `runBomCommitEffects`.

## 📝 Risks & Impact Review

| Severity | Scenario | Mitigation | Residual risk |
|---|---|---|---|
| High | A future order path checks availability before starting its write transaction, allowing a withdrawal race. | The contract requires `requireBomForNewOrder` inside the order creation transaction and uses a share lock that conflicts with availability updates. | Until production orders exist, only unit coverage can verify this contract; each future write path must be wired and integration-tested. |
| Medium | A stale UI could overwrite a newer availability decision. | Optimistic locking is required for every availability mutation and conflict UI refreshes the BOM. | The user must retry after viewing the refreshed state. |
| Low | Clients assume the list availability reason enum is closed. | The new `withdrawn` reason is additive and the module has no released external consumers; the response schema is updated. | External consumers that validate the enum strictly must update when adopting this version. |

### Migration & Backward Compatibility

The database change is additive with a true default, preserving current behavior for all existing records. The list response gains an additive boolean, the query gains an optional parameter, and a new POST route and lifecycle event are added. The availability reason enum gains `withdrawn`. There are no ACL, DI, spot-ID, or existing endpoint removals. The module is not yet released, so no deprecation bridge is needed for the new field or enum value. Rollback drops the added column; application code must be rolled back with that migration.

## 📋 Phasing

1. Add the model, migration, shared selection rule, list decoration/filter, and availability selection guard.
2. Add the versioned command, event, shared action-route context, and guarded API.
3. Add the localized detail-page toggle and badge.
4. Add unit and self-contained API/UI integration coverage. Future order creation separately wires the selector and guard as described in the guide's section 8.

## 📋 Implementation Plan

1. Add the default-true availability column and generated schema snapshot. Verify migration generation has no unrelated module output.
2. Add the canonical selection predicate and `withdrawn` availability reason. Cover draft, withdrawn, variant missing, and inactive cases.
3. Add the list response field and `availableForNewOrders` intersection filter. Cover true, false, and draft intersections.
4. Add `requireBomForNewOrder` with fresh scoped reads and the transactional read lock. Cover successful and rejected selections.
5. Add the release initialization and availability command. Verify optimistic locking, no-op semantics, post-commit CRUD/lifecycle events, and unchanged BOM contents.
6. Extract the shared action context from the release route and add the availability route with mutation guards. Preserve the release route behavior.
7. Add the response parser, localized switch, confirmation, badge, and detail-page integration. Keep released forms/items read-only.
8. Add unit tests plus API/UI integration specs using isolated fixtures and cleanup. Run generation, type checking, manufacturing tests, and i18n checks.

## 📋 Final Compliance Report

- Tenant and organization scope comes from the authenticated action context and scoped queries.
- Mutations use the command layer, mutation guards, optimistic locking, and post-commit effects.
- The schema change is additive and does not introduce cross-module ORM relations.
- User-facing copy is translated in English, Polish, German, Spanish, and Korean.
- No production dependency, ACL feature, or new order entity is added.

## Changelog

- 2026-10-20: Added implementation spec aligned with the BOM availability guide.
