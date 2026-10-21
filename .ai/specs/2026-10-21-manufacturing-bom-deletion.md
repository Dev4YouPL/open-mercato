# Manufacturing BOM deletion safety

## TLDR

Allow deletion of unused BOM revisions and unused BOM families while preserving every revision referenced by a production order. Deletion is a tenant and organization scoped soft delete, protected by family-level transaction locks and fresh version tokens.

## Overview

This feature implements `packages/core/src/modules/manufacturing/BOM_DELETION_IMPLEMENTATION_GUIDE.md`. A BOM family consists of every revision for one output variant within a tenant and organization. A production order referencing any revision is durable evidence of use, including soft-deleted orders and orders in any status.

## Problem Statement

Manufacturing users could only delete draft revisions. The command did not check production-order references, and order creation could race with revision deletion because it read the BOM and inserted the order in separate transactions.

## Proposed Solution

- Permit deletion of a revision with no direct use, except a released revision in a family that has any use.
- Permit deletion of all active revisions only while the family has no use.
- Keep direct and family use distinct in conflict responses; expose production-order numbers only to users with `manufacturing.view`.
- Serialize order creation, revision creation/variant changes, and deletion on a PostgreSQL advisory lock keyed by tenant, organization, and output variant.
- Revalidate order eligibility inside the insert transaction and check READ COMMITTED isolation before relying on post-lock reads.
- Use a server-generated SHA-256 version over the affected revisions and active items to reject stale confirmations.
- Soft-delete revisions and items atomically; keep existing CRUD event identifiers.

## Architecture

`domain/bomDeletion.ts` decides deletion eligibility. `data/bomUsageReader.ts` owns the family lock and order usage query. `lib/bomDeletionQueries.ts` builds previews and version tokens. `commands/bomDeletion.ts` owns transactional deletion. The existing DELETE route continues to delete one revision; new preview and delete-all routes provide the family workflow. The backoffice uses the shared confirmation and guarded mutation patterns.

## Data Models

No new table or column is introduced. Add the scoped `(tenant_id, organization_id, bom_revision_id)` index to `manufacturing_production_orders`. Revision and item rows retain their existing soft-delete fields. Production orders retain their existing BOM revision ID as immutable use evidence.

## API Contracts

- `GET /api/manufacturing/boms/deletion-preview?id=<revisionId>` returns the revision/family state, both version tokens, and deletion decisions.
- `DELETE /api/manufacturing/boms` accepts an optional `expectedVersion` in addition to the existing revision ID.
- `POST /api/manufacturing/boms/delete-all` accepts `outputVariantId` and required `expectedVersion`.
- Use conflicts return HTTP 409 with `manufacturing.bom_delete.revision_used`, `manufacturing.bom_delete.bom_used`, or `manufacturing.bom_delete.stale`.

All routes derive scope from authenticated context and require `manufacturing.manage`.

## Risks & Impact Review

| Failure scenario | Severity / area | Mitigation | Residual risk |
|---|---|---|---|
| An old app process creates an order without taking the family lock while a new process deletes the family. | High / deployment | Roll out order locking and in-transaction revalidation before enabling deletion; do not overlap old writers with deletion-capable processes. | Rolling deployments must honor the two-stage rollout described in the implementation guide. |
| A future order flow mutates or physically removes order references. | High / data integrity | Keep order revision IDs immutable and orders soft-deleted; add invariant review coverage and move to an append-only usage registry if that contract changes. | Static checks cannot detect every dynamic SQL path or external module. |
| Preview becomes stale while the user confirms. | Medium / UX and data | Recompute version and usage inside the transaction; reject stale tokens with 409. | User must refresh and retry. |
| Caller uses a transaction isolation level other than READ COMMITTED. | High / data integrity | Reject the operation before lock-dependent usage checks. | Integrators must configure the supported isolation level. |

## Integration Coverage

- API: preview and delete an unused BOM family with its items; delete an unused released revision.
- UI: confirm deletion of an unused family and return to the BOM list.
- Unit coverage: deletion decision cases, family locking and isolation checks, usage mapping, token stability, and existing released-BOM immutability.

## Final Compliance Report

- Scope is tenant and organization constrained; no cross-module ORM relationship was added.
- Existing command ID and CRUD event IDs are preserved; new routes and the index are additive.
- No local database migration was applied.
- Validation: `yarn generate`, core package typecheck, manufacturing module tests, and focused BOM deletion tests.

## Changelog

- 2026-10-21: Added safe deletion of unused BOM revisions and families, guarded against order creation races and stale confirmations.
