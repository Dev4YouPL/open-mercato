# Manufacturing MVP Inventory Execution

## TLDR

This proposed child specification narrows P1.8b and P1.11 to guarded material issue, full output receipt, deterministic retry, and evidence-derived compensation for the [Manufacturing End-to-End MVP](2026-09-05-manufacturing-end-to-end-mvp.md).

**Status:** Proposed MVP child contract — maintainer review and implementation-readiness audit pending.

## Overview

MVP-X is the only physical-stock integration used by the narrow MVP. It is independently reviewable, but public MVP release waits for the composed MVP-D/MVP-O/MVP-X scenario.

## Problem Statement

Calling internal WMS commands directly would create an untyped runtime dependency, bypass route-owned mutation guards, and misclassify normal production as manual adjustment. Building the full generic posting-group platform first would delay validation.

## Proposed Solution

Add one narrow WMS-owned typed and guarded posting port over existing inventory commands. Manufacturing owns orchestration and compensation; WMS retains physical posting authority.

## Typed WMS posting port

WMS owns one additive DI service, provisionally identified as `wmsManufacturingPostingService`, with exported zod schemas and derived TypeScript types for:

- negative material issue;
- positive finished-output receipt;
- compensation of one prior movement; and
- lookup/reconciliation by stable correlation key.

Every input carries the caller-derived tenant and organization scope, stable intent UUID, production discriminator, warehouse/location IDs, Catalog variant ID, quantity, and original movement ID for compensation. Results contain movement ID, accepted quantity, posting timestamp, correlation key, and `idempotentReplay`.

The final implementation spec must freeze the DI key, import path, schemas, errors, and result shape as additive public contracts. Manufacturing resolves the service softly through DI and never imports WMS handlers or entities.

## Guard and posting behavior

The WMS implementation validates trusted scope, warehouse/location ownership, inventory profile, unsupported lot/serial control, quantity envelope, and incompatible replay. It runs the canonical WMS mutation-guard registry and post-success callbacks, then delegates to existing `wms.inventory.adjust` or `wms.inventory.receive` commands.

Normal production movements use an additive production reference discriminator; they must not be classified as `manual`. The port preserves current WMS balance and movement ownership and adds no WMS table, column, route, arithmetic change, generic posting group, or production workflow.

## Architecture

The WMS module registers the port through DI and owns its public schemas and implementation. Manufacturing resolves it with a soft-optional helper, fails closed when absent, and persists only scalar movement IDs and evidence snapshots. Neither module creates an ORM relationship to the other.

## Orchestration

Manufacturing persists intent before calling WMS. Issue processes deterministic BOM occurrence order and records each result independently. Receipt has one intent for the full planned output. A retry first reconciles every pending intent and calls WMS only for missing work.

Compensation derives the inverse target and quantity solely from the original accepted fact and WMS movement. It creates a new movement and correction fact; it never edits or deletes the original. If compensation cannot post because stock is no longer eligible or available, the order stays `correction_pending` or `cancellation_pending` with a stable retryable error.

## Crash-window contract

If WMS commits and the process fails before Manufacturing records the movement ID, the persisted intent remains pending. Retrying the same intent causes WMS to return the original movement. Manufacturing records the missing fact and only then advances order state. A different payload under the same intent UUID fails without posting.

## API and UI

Manufacturing action APIs expose explicit full issue, full receipt, correction, and recovery retry. They require execute/correct features, mutation guards, optimistic-lock headers, zod schemas, `metadata`, `openApi`, and non-disclosing scoped errors. WMS exposes no new HTTP route for this port.

Order detail shows per-intent pending/accepted/failed/corrected evidence and blocks conflicting actions. Confirmation dialogs cover issue, receipt, cancellation compensation, and correction. Page roots stay server components; the implementation spec must provide the concrete client-island ledger, hydration test, interaction coverage, and zero heavy page-root dependency budget.

## Testing and readiness

Self-contained integration coverage must prove guarded issue and receipt, inventory-freeze denial, insufficient stock, scope isolation, partial multi-line failure, missing-line retry, exact same-key replay, incompatible replay, WMS-committed/Manufacturing-failed reconciliation, output correction, issue correction, compensation failure, cancellation compensation, disabled WMS behavior, balances, movements, facts, API/OpenAPI, and key UI recovery states.

This child becomes implementation-ready only after the order/facts child is accepted, the typed port contract is reviewed as additive, and the WMS and Manufacturing implementation seams are specified precisely. Generic atomic posting groups, WMS evidence migrations, and exact reversal infrastructure remain post-MVP options.

## Migration and Backward Compatibility

The WMS port, production discriminator, DI key, schemas, and export path are additive contract surfaces. Existing inventory commands and `manual` behavior remain unchanged. No migration is required. Future replacement by a generic posting-group service must keep this port as a bridge for at least one minor release or follow the repository deprecation protocol.

## Risks & Impact Review

- **Guard bypass:** mitigation is one WMS-owned guarded port; direct Manufacturing command-bus calls are forbidden.
- **Misclassified production movement:** mitigation is the production discriminator and typed operation kind.
- **Partial multi-line issue:** mitigation is persisted per-occurrence intents, visible partial state, deterministic reconciliation, and compensation.
- **Crash after WMS commit:** mitigation is same-key lookup/replay returning the original movement.
- **Compensation cannot post:** mitigation is a non-terminal recovery state and explicit operator retry; history remains intact.

## Final Compliance Report

The proposed port preserves WMS ownership, guard execution, tenant/organization scope, semantic movement classification, additive compatibility, soft-optional coupling, deterministic idempotency, and self-contained integration coverage. It remains non-compliant for implementation until its final DI key, export path, zod schemas, mutation-guard seam, production discriminator, error contract, frontend ledger, and readiness evidence are reviewed.

## Changelog

- 2026-09-05: Created the proposed guarded WMS execution and compensation child contract for the end-to-end MVP.
