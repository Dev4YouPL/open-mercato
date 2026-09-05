# Manufacturing MVP Definition Release

## TLDR

This proposed child specification profiles P1.4a, P1.4b, and P1.7 for the definition input required by the [Manufacturing End-to-End MVP](2026-09-05-manufacturing-end-to-end-mvp.md): author a normalized direct-line, variant-targeted BOM, inspect its bounded multi-level tree, and release one immutable occurrence snapshot without Site, routing, Work Centers, automatic order orchestration, or Catalog normalization changes.

**Status:** Proposed MVP child contract — maintainer review and implementation-readiness audit pending.

## Overview

MVP-D turns the existing BOM-authoring design into the smallest executable definition boundary. It is independently mergeable behind the opt-in module and produces the immutable input consumed by MVP-O.

## Problem Statement

The broad P1.7 contract waits for quantity normalization, Site, and routing decisions that the same-unit MVP does not exercise. P1.4a already provides the normalized direct-line graph and P1.4b defines its bounded recursive read. Reusing the full broad readiness gate would block the vertical slice unnecessarily.

## Proposed Solution

Adopt the restricted profile below without weakening P1.4a aggregate integrity or changing Catalog. Broader definition behavior remains a separate post-MVP option.

## Scope

- Reuse the existing P1.4a family, revision, line, aggregate-lock, command, undo, and scope model.
- Permit concrete Catalog variants as executable BOM outputs and component occurrences. Both `stock` and resolvable `produce` lines are valid definition inputs.
- Require base-output and component quantities in the current inventory unit accepted by Catalog and WMS.
- Reuse the bounded P1.4b multi-level preview, occurrence identity, exact quantity propagation, cycle detection, and depth/node limits.
- Release one immutable snapshot containing the target variant, output quantity, ordered occurrences at every selected level, selected child revision IDs, full occurrence paths, component variants, normalized decimal strings, inventory-unit codes, and Catalog labels needed for historical readability.
- Reject product-only executable targets, unresolved or ambiguous `produce` lines, cycles, cross-unit conversion, unsupported precision or magnitude, lot/serial-controlled variants, unresolved variants, and out-of-scope Catalog references.

## Data and lifecycle

The existing editable BOM revision remains the optimistic-lock aggregate root. Release is one command and one transaction. It validates the complete bounded graph, deterministically selects each child revision, creates an immutable occurrence-preserving released-definition snapshot, marks the source revision released, and emits side effects only after commit. A later definition change creates a new draft revision; it never mutates a released snapshot.

All rows carry `tenant_id`, `organization_id`, `created_at`, and `updated_at` where editable. Cross-module references are scalar UUIDs plus immutable labels/unit evidence; no Catalog ORM relationship is introduced.

## Architecture

Manufacturing owns the family, revision, release command, and snapshot. Catalog remains the read-only owner of product, variant, and current unit identity. MVP-O consumes only the released snapshot ID and never reads a mutable draft to calculate execution.

## API and UI

The child implementation provides authenticated, feature-guarded list, create, detail, edit, line-maintenance, bounded multi-level preview, release, and released-definition read paths. All inputs use zod; routes export `metadata` and `openApi`; update, delete, reorder, and release enforce the aggregate optimistic-lock token.

Backend page roots remain server components. Client islands are limited to the existing BOM `DataTable`, `CrudForm`, line editor, bounded tree panel, and release confirmation. The implementation spec must record the exact file ledger, keep page roots free of `"use client"`, add no heavy browser dependency, and require hydration plus create/edit/preview/release interaction coverage.

## Errors and invariants

- A stale draft returns the platform `409 optimistic_lock_conflict` response.
- A duplicate release returns the existing released snapshot only for the same command idempotency key; incompatible replay fails.
- A release failure leaves the draft unchanged and creates no snapshot.
- Foreign or missing Catalog records use the same non-disclosing not-found response.

## Testing and readiness

Implementation coverage must create its own Catalog and BOM fixtures and prove direct and nested release, deterministic child-revision selection, bounded preview, cycle/limit rejection, occurrence-path preservation, snapshot immutability, stale-version rejection, cross-tenant and cross-organization isolation, unsupported quantity/unit rejection, product-only executable-target rejection, unresolved/ambiguous `produce` rejection, duplicate release, command undo policy, disabled-module behavior, API/OpenAPI, and the key UI path.

This child becomes implementation-ready only after P1.0a is available, the P1.4a/P1.4b contracts are accepted for this profile, its exact release entity/API/ACL/event contracts are frozen, and the readiness review is linked. P1.2, P1.3a-c, P1.4c-h, P1.5, P1.6, and P1.8a are not prerequisites for this restricted profile.

## Migration and Backward Compatibility

The profile preserves implemented P1.4a behavior and adds release surfaces additively. It removes or renames no existing entity, route, field, feature, event, command, import, or generated export. The implementation specification must classify each new surface under `BACKWARD_COMPATIBILITY.md` before code begins.

## Risks & Impact Review

- **Unsupported quantity accepted:** release could create an order that current WMS cannot post. Mitigation: validate the measured compatibility envelope at release and again at order release.
- **Draft changes historical execution:** later edits could reinterpret an order. Mitigation: orders consume only immutable released snapshots.
- **Multi-level definition is mistaken for automatic execution:** users could expect release to create or execute child orders. Mitigation: preserve and display the complete occurrence tree, but state that each production order consumes only its own revision's direct occurrences; subassembly production uses a separate order.

## Final Compliance Report

The contract preserves module ownership, scalar cross-module IDs, trusted scope, optimistic locking, command writes, immutable snapshots, canonical UI/API mechanisms, and self-contained integration coverage. It remains non-compliant for implementation until exact schemas, IDs, frontend ledger, migration snapshot, and readiness evidence are reviewed.

## Changelog

- 2026-09-05: Created the proposed direct-BOM and immutable-definition child contract for the end-to-end MVP.
- 2026-09-05: Expanded the MVP profile to bounded multi-level authoring/preview and deterministic child-revision snapshots while keeping automatic child-order execution out of scope.
