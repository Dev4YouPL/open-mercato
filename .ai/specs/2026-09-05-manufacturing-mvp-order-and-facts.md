# Manufacturing MVP Order and Facts

## TLDR

This proposed child specification narrows P1.9 and P1.10 to a single-step production order, immutable execution snapshot, and append-only fact/intention ledger for the [Manufacturing End-to-End MVP](2026-09-05-manufacturing-end-to-end-mvp.md).

**Status:** Proposed MVP child contract — maintainer review and implementation-readiness audit pending.

## Overview

MVP-O owns production intent and durable Manufacturing evidence without performing physical inventory writes itself. It is independently mergeable behind the opt-in module after MVP-D is accepted.

## Problem Statement

The broad P1.9/P1.10 model includes routing, partial confirmation, scrap, and Site-aware behavior. The narrow MVP needs a smaller lifecycle whose terminal states remain consistent with compensating stock evidence.

## Proposed Solution

Define one single-step order aggregate plus append-only intents and facts. The order retains the full multi-level definition snapshot for traceability and gross-requirement visibility but executes only the direct occurrences of its top-level revision. Physical writes remain delegated to MVP-X through a typed port.

## Scope

- Create a draft order for one released multi-level definition and requested output quantity, with an optional explicit parent-order reference for manually coordinated subassembly production.
- Select existing material/output warehouse and location IDs without introducing Site.
- Release an immutable execution snapshot containing the complete selected occurrence tree, selected revision IDs, scaled gross requirements, the top-level direct execution set, output quantity, current inventory-unit evidence, definition identity, and readable warehouse/location snapshots.
- Track issue intent per BOM occurrence, one receipt intent per order receipt attempt, and one correction intent per original WMS movement.
- Persist append-only accepted, failed, and corrected facts with correlation, idempotency key, recorded/occurred timestamps, WMS movement ID, and original-fact link.

Routing, operations, partial quantities, backflush, scrap, `complete_short`, recursive descendant execution inside one order, automatic child-order creation, MRP, phantom flattening, reservations, costing, and lot/serial execution are excluded.

## Lifecycle

```text
draft -> released -> in_progress -> completed
   \       \-> cancelled          \-> correction_pending -> in_progress
    \-> cancelled
in_progress -> cancellation_pending -> cancelled
```

- `released` requires a valid immutable execution snapshot.
- The first accepted issue moves the order to `in_progress`.
- `completed` requires one accepted, uncompensated full-output receipt.
- Cancellation after any stock effect remains `cancellation_pending` until every uncompensated posting is compensated; failures remain visible and retryable.
- Correcting the only output receipt moves `completed` through `correction_pending` to `in_progress` and permits a new receipt intent.
- Correcting all issued material returns the order to `released`; otherwise it remains `in_progress`.

Every transition is a command with optimistic locking and an explicit allowed-source-state matrix. Facts are append-only and never rewritten by correction.

## Data, API, and UI

Orders are tenant/organization scoped, user-editable, soft-deletable only while draft, and carry `updated_at`. Facts and intents are append-only scoped rows. Cross-module definition and WMS references use scalar IDs plus snapshots.

Authenticated, feature-guarded APIs cover order list/create/read/update, release, start/issue orchestration entry, receive orchestration entry, cancel, correct, and fact/evidence read. Action routes use zod, `metadata`, `openApi`, mutation guards, optimistic-lock headers, commands, and stable errors.

Backend page roots remain server components. Client islands are limited to the order `DataTable`, `CrudForm`, action confirmations, and evidence timeline. The implementation spec must provide the concrete `"use client"` ledger, zero heavy page-root dependencies, hydration smoke coverage, and key transition tests.

## Architecture

Manufacturing owns state transitions, snapshots, intent fingerprints, facts, authorization, and reconciliation decisions. It stores scalar released-definition, optional parent-order, and WMS movement IDs. A `produce` occurrence is issued to its parent as stocked subassembly inventory; its descendant raw materials belong to a separately created order. WMS owns balances and movements; the order aggregate advances only from persisted accepted facts.

## Idempotency and recovery

Each logical action first persists its intent and input fingerprint. Repeating the same key and fingerprint returns the original outcome; reusing the key with different input fails as incompatible replay. A pending intent is reconciled against the WMS posting port before any retry creates physical stock work.

## Testing and readiness

Coverage must prove lifecycle transitions and forbidden transitions, immutable multi-level snapshots, direct-occurrence execution boundaries, optional parent-order scope validation, no implicit child-order creation, stale versions, scope isolation, intent cardinality, same-key replay, incompatible replay, cancellation before and after issue, correction state transitions, append-only evidence, disabled WMS/module behavior, API/OpenAPI, and list/detail/action UI paths.

This child becomes implementation-ready only after the definition-release child is accepted and its own exact model/API/ACL/event/command contracts pass readiness review. Site, routing, Work Centers, generic posting groups, and broader P1.10 behavior are not MVP prerequisites.

## Migration and Backward Compatibility

All order, intent, and fact surfaces are additive. The implementation specification must freeze stable IDs and schemas, include additive migrations and snapshots, and classify every public surface under `BACKWARD_COMPATIBILITY.md`.

## Risks & Impact Review

- **Terminal state disagrees with net stock evidence:** mitigation is fact-derived transition invariants and non-terminal pending correction/cancellation states.
- **Duplicate intent changes quantity or target:** mitigation is persisted fingerprint comparison and deterministic incompatible-replay rejection.
- **Master data changes reinterpret history:** mitigation is immutable definition, quantity, warehouse, and location snapshots.

## Final Compliance Report

The contract preserves tenant/organization isolation, append-only history, optimistic locking, command state transitions, scalar cross-module references, canonical API/UI patterns, and deterministic retry requirements. It remains non-compliant for implementation until exact schemas, transition/error matrices, ACL/event IDs, frontend ledger, migrations, and readiness evidence are reviewed.

## Changelog

- 2026-09-05: Created the proposed single-step order and append-only facts child contract for the end-to-end MVP.
- 2026-09-05: Added full multi-level execution snapshots and optional explicit parent-order references while retaining direct-occurrence execution per order.
