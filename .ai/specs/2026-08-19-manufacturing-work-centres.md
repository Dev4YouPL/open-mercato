# Manufacturing Work Centers and Optional Resource Membership

## TLDR

P1.6 adds the bounded `ManufacturingWorkCenter` master-data capability inside the opt-in `manufacturing` module. A Work Center is the production context to which a future routing operation refers; it has a stable organization-scoped identity and may contain zero or more existing `resources` by scalar ID.

The slice deliberately excludes capacity calculation, calendars, shifts, costs, capability matching, alternate-work-center selection, automatic dispatching, and finite scheduling. `resources` keeps resource identity, active state, and base capacity; `planner` keeps reusable availability rules. P1.5 will own sequential routing operations, including their setup/run times and instructions.

**Specification status:** Design complete — readiness review pending. The accepted scope has no unresolved architectural question: Work Center plus optional resource membership are one capability, because the membership has no useful independent lifecycle.

## Overview

Manufacturing needs a stable way to say where a production operation is performed without treating a machine, person, calendar, or cost model as that place. This capability creates that production context and makes a group of shared resources available to it when the optional `resources` module is installed.

The intended outcome is truthful routing authoring: a technologist can associate an operation with a real line, cell, or assembly area. The capability makes no scheduling promise. It forms the prerequisite boundary for P1.5 routing drafts and later definition-release snapshots in P1.7.

## Scope

- Work Center identity, organization scope, active state, optional Site ID, optimistic locking, soft deletion, commands, API, ACL, UI, and audit/undo behaviour.
- Optional zero-to-many Work Center-to-Resource membership using scalar IDs, same-scope validation, and disabled-`resources` behaviour.
- The downstream reference and snapshot contract consumed by P1.5, P1.7, and P1.10.

## Explicit non-goals

- Routing operations, times, instructions, and operation order (P1.5).
- Definition release, Site applicability at release, and immutable released snapshots (P1.7).
- Production-order scheduling/execution (P1.10), stock movements (P1.11), MRP, finite capacity, calendars, costs, maintenance, quality, MES, and subcontracting.

## Problem Statement

The current platform has two useful but insufficient masters:

- `resources` represents a reusable person, machine, tool, location, or other resource, including its active state and base capacity;
- `planner` represents reusable, timezone-aware availability rules.

Neither is the Manufacturing concept of a production cell, line, or assembly area. Using a single `resourceId` on a future routing operation would incorrectly state that every operation is performed by one named asset or person. Copying capacity, calendars, or resource descriptions into Manufacturing would instead create competing masters.

Without a narrow Work Center boundary, P1.5 must either invent a temporary field that will later be migrated, or take an accidental dependency on planning. Either choice makes production definitions fragile before they can safely be released or executed.

## Official Product Benchmark

The following official sources were reviewed on 2026-08-28. They inform the boundary, not a copy of any vendor's full data model.

| Product | Relevant documented behaviour | Adoption decision |
|---|---|---|
| [SAP S/4HANA](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d74941cf210b44768dc074ce2f243890/d184b8535c39b44ce10000000a174cb4.html) | A Work Center is plant master data assigned to routing/order operations. SAP later uses it for default values, scheduling, capacity planning, and costing. | Adopt the Work Center as the operation's production context; defer formulas, cost centers, capacity, and scheduling. |
| [Oracle Fusion SCM](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faumf/overview-of-oracle-manufacturing-cloud.html) | Work Centers represent departments/lines and contain production resources; operations in Work Definitions reference a Work Center. | Adopt the distinct Work Center and optional many-resource membership; defer Work Area, resource shifts, utilization, and cost rates. |
| [Microsoft Dynamics 365 SCM](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/operations-resources) | Resource groups model shop-floor cells and contain operation resources; later scheduling matches operation requirements to resource capabilities. | Adopt the distinction between a group/place and a resource; defer capabilities, validity dates, priority, and resource allocation. |
| [IFS Cloud](https://docs.ifs.com/ifsclouddocs/25r2/MfgStandard/AboutWorkCenter.htm) | A Work Center is an operation area with one or more resources. Capacity is calculated from resource, calendar, utilization, and efficiency data. | Adopt resource membership only; defer calculated capacity, calendar, efficiency, costs, and finite planning. |
| [Infor CloudSuite Industrial](https://support.infor.com/esknowbase/root/DLPublic/50333/csbi_9.01.x_csbiipmug_csindustrial_en-us.pdf) | The scheduling model uses resource groups with member resources, while Work Center retains a more limited role. | Do not make Work Center a scheduler or a capacity source of truth; preserve a future resource-group/planning layer. |

### Shared pattern and Open Mercato decision

All five systems distinguish the context/group in which an operation can happen from the concrete resource that performs it. Capacity, calendars, availability, skills, costs, and dispatching are separate layers over that relationship.

Open Mercato therefore adopts the smallest common denominator now: a Manufacturing-owned Work Center and optional membership of existing resources. It deliberately rejects capacity and scheduling fields in the first contract because no first-core workflow can yet calculate or enforce them truthfully.

## Proposed Solution

Add two scoped, additive entities in `packages/manufacturing/src/modules/manufacturing`:

```text
ManufacturingWorkCenter
  └── ManufacturingWorkCenterResource[]
          └── resourceId (scalar ID owned by optional resources)

P1.5 ManufacturingRoutingOperation
  └── workCenterId (scalar ID; at most one per operation)

P1.7 released definition snapshot
  └── workCenter snapshot and membership display fallback
```

`ManufacturingWorkCenter` exists and is manageable without `resources`, `planner`, or WMS. A resource membership can be created only when a safe, authorized `resources` lookup is available. A nullable `siteId` is future-compatible metadata: draft configuration may omit it; P1.7 will validate operational Site applicability when a definition is released. It is not a substitute for a WMS Site master and does not make WMS a hard module requirement.

### Design decisions

| Decision | Rationale |
|---|---|
| One `manufacturing` capability, not a new runtime module | Work Center data and its membership have one lifecycle and no independently useful deployment. This preserves accepted P1.0a topology. |
| Manufacturing owns Work Center; `resources` owns resources | A Work Center is production semantics, while resource identity/capacity is reused by other domains. |
| Zero-to-many optional resource membership | A cell may have multiple equivalent machines or people. Zero members supports a user that has not installed `resources`. |
| Scalar IDs and display fallbacks, never cross-module ORM | Cross-module history and disabled-module behaviour remain safe. |
| One Work Center per P1.5 operation | It gives an unambiguous baseline. Alternatives are a scheduling/routing policy and are deferred. |
| Nullable `siteId`, required only by a later release contract | P1.6 starts before P1.2 is an implementation-ready provider. Draft routes have no stock or executable semantics. |
| No custom fields in P1.6 | The master's invariants are intentionally narrow; tenant-specific configuration and document control need separate evidence. |
| No public domain subpath or exported constants in P1.6 | P1.0a freezes package entrypoints only. Consumers stay internal until a second real consumer proves a public contract. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Add `resourceId` directly to P1.5 operations | Cannot represent a line/cell with several resources and would force future data-model migration. |
| Add `workCenterId` to `resources` | A resource can be reused or regrouped; it reverses ownership and makes a general module know Manufacturing semantics. |
| Copy `capacity`, calendars, efficiency, or shifts into Work Center | Duplicates `resources`/`planner` masters before a scheduler defines how those values are interpreted. |
| Require a Site and WMS for all Work Centers | Prevents safe draft authoring in the optional-peer composition and incorrectly treats configuration as stock execution. |
| Create Work Area, hierarchy, or resource-group module now | No accepted customer case determines whether grouping should be organizational, logistical, or scheduling-specific. |

## User Stories and Acceptance Outcomes

- **Manufacturing administrator** wants to define a stable welding cell or assembly line so that routing authors refer to a meaningful production context.
- **Manufacturing administrator** wants to connect several existing machines or people to that cell, when `resources` is enabled, so that later planning has a truthful starting point without duplicating assets.
- **Manufacturing technologist** wants to select one active Work Center for a future routing operation so that a technology records where work happens without pretending it is scheduled.
- **Viewer** wants to inspect a Work Center and its current member-resource summaries so that they understand the configuration without receiving unauthorized resource details.
- **Release/execution capability author** wants a deterministic Work Center snapshot input so that a later master-data edit cannot reinterpret a released definition or order.

## Architecture

### Module and ownership boundary

| Domain fact | Owner | P1.6 use |
|---|---|---|
| Work Center identity, production description, lifecycle, current membership | `manufacturing` | Creates and manages it. |
| Resource identity, resource type, active state, base capacity | `resources` | Read-only optional validation/enrichment. |
| Availability rules, timezone, shifts and calendars | `planner` | Not read or copied in P1.6. |
| Plant/Site identity and warehouse roles | WMS | Optional Site lookup only when a `siteId` is supplied; P1.7 owns release applicability. |
| Routing operation | `manufacturing` P1.5 | Later stores scalar `workCenterId`. |
| Released definition and execution history | `manufacturing` P1.7/P1.10 | Later consumes an immutable snapshot producer defined here. |

The optional-consumer rule is explicit: `manufacturing`, not `resources` or `planner`, owns its optional lookup/enrichment glue. It attempts to resolve a documented provider from the request container in a `try/catch`; no optional peer is added to `ModuleInfo.requires`. An unavailable provider produces a bounded feature response, never an unscoped ORM query or a guessed value.

Exact DI registration names and generated route IDs remain implementation facts. The implementation must inspect generated guides and use the current sanctioned provider seam rather than infer one from a folder name.

### Data flow

```text
Admin CRUD command
  -> ManufacturingWorkCenter / ManufacturingWorkCenterResource
  -> command audit + undo payload
  -> local event only if a real subscriber is introduced later

Optional resource assignment
  -> authenticated resources lookup in same tenant/org
  -> persist scalar resourceId + display fallback

P1.5 routing mutation
  -> scoped active Work Center validation

P1.7 definition release
  -> capture Work Center code/name/site and member display fallbacks
  -> immutable definition snapshot
```

P1.6 emits no speculative cross-module event. Standard command/audit behaviour is sufficient. A future scheduling, maintenance, or indexing consumer must introduce an explicit event in the owning capability, with idempotent subscriber semantics, rather than rely on a hidden direct import.

### Optional-peer behaviour

| Peer state | Work Center CRUD | Resource membership read | Add/remove membership | Site selection |
|---|---|---|---|---|
| `resources` absent | Fully available | Returns persisted IDs and fallback display values only | Add is rejected as `resource_provider_unavailable`; remove remains available | Unchanged |
| `resources` present, actor lacks resource view | Fully available | Returns no protected current resource fields | Add/remove is denied by host-resource ACL | Unchanged |
| `resources` present, resource inactive/deleted | Existing membership remains visible with warning/fallback | Current summary marks it unavailable | Add and reassignment are rejected; removal remains available | Unchanged |
| `planner` absent or present | Unchanged | Unchanged | Unchanged | No calendar/availability call occurs |
| WMS/Site provider absent | Work Center without `siteId` is available | Unchanged | Unchanged | Supplying/changing `siteId` is rejected as `site_provider_unavailable` |

## Data Models

### `ManufacturingWorkCenter`

| Column | Type / rule | Notes |
|---|---|---|
| `id` | UUID | Canonical technical identity. |
| `tenant_id`, `organization_id` | UUID, required | Scope on every query and mutation. |
| `code` | normalized text, required, max 100 | Case-insensitively unique per non-deleted organization scope; immutable only after P1.7 has frozen it in a release snapshot. Before then it remains editable with locking. |
| `name` | text, required, max 200 | Business label, not a person record. |
| `description` | nullable text, max 2,000 | Operational description only; no personnel notes, credentials, or sensitive data. |
| `site_id` | nullable UUID scalar | No ORM relation. Validated through the optional Site provider when supplied. |
| `is_active` | boolean, default `true` | Blocks new routing use when false; preserves reads/history. |
| `created_at`, `updated_at`, `deleted_at` | standard lifecycle columns | `updated_at` supplies optimistic locking; deletion is soft. |

Indexes: `(tenant_id, organization_id, normalized_code)` unique among non-deleted records; `(tenant_id, organization_id, is_active, code)` for list/lookup; `(tenant_id, organization_id, site_id)` for bounded Site filtering. The generator/migration review must select the exact PostgreSQL partial-index expression supported by the repository.

### `ManufacturingWorkCenterResource`

| Column | Type / rule | Notes |
|---|---|---|
| `id` | UUID | Supports command audit and independently versioned membership undo. |
| `tenant_id`, `organization_id` | UUID, required | Must equal the Work Center and referenced resource scopes. |
| `work_center_id` | UUID scalar, required | Internal Manufacturing reference. |
| `resource_id` | UUID scalar, required | No cross-module ORM relation. |
| `resource_name_snapshot` | text, required, max 200 | Display fallback captured after authorized resource lookup; never treated as current resource master data. |
| lifecycle columns | standard | `updated_at` is the membership's lock version; soft delete keeps historical intent. |

The active `(work_center_id, resource_id)` pair is unique. There is no `capacity`, `priority`, `efficiency`, `role`, `sequence`, `calendar`, or allocation policy. Those fields would have scheduler semantics and require a later specification.

### Snapshot producer contract

P1.6 defines an internal, model-neutral snapshot producer for P1.7/P1.10. It is not a P1.0a public package export:

```ts
type ManufacturingWorkCenterSnapshot = {
  workCenterId: string
  code: string
  name: string
  siteId: string | null
  resources: Array<{ resourceId: string; name: string }>
}
```

P1.7 calls it inside its release transaction. The snapshot records the Work Center's then-current membership display fallback, not capacity, availability, or a scheduler decision. A current resource rename/deactivation must not alter a released snapshot.

### Validation and mutation invariants

1. All records, list filters, parent IDs, Site IDs, and resource IDs are resolved in the caller's tenant and organization; mismatch fails closed.
2. Codes are trimmed and normalized before uniqueness checking. Blank code/name is invalid.
3. A membership create requires an active Work Center and an active, readable same-scope Resource; database uniqueness handles concurrent duplicate submissions.
4. A membership delete is allowed even if the Resource provider is disabled or the member resource later became inactive; recovery from stale configuration is never blocked.
5. Deactivating a Work Center is allowed. P1.5 blocks it for new/changed routing-operation assignments and P1.7 blocks a release that uses it; old snapshots remain readable.
6. Soft deletion fails with `work_center_in_use` once P1.5/P1.7 introduces a live or historical reference. Until then, it is an undoable configuration deletion, not a hard delete.
7. `siteId` is optional in P1.6 and cannot be interpreted as warehouse, calendar, or inventory authorization.

No sensitive field is intentionally introduced. `description` is a bounded operational note, not an employee/customer note; UI help and API documentation prohibit PII, credentials, and personal health/qualification information. If a later requirement turns it into a free-text people record, that capability must add a module encryption map and decryption-safe reads rather than silently extend this field.

## API Contracts

All CRUD routes use `makeCrudRoute`, Zod input schemas, per-method `metadata`, `openApi`, canonical mutation guards, query indexing, scoped response transforms, and camelCase output. The exact generated entity constants are obtained by `yarn generate`; this document does not hard-code ungenerated IDs.

### Route matrix

| Route | Methods | Feature | Behaviour |
|---|---|---|---|
| `/api/manufacturing/work-centers` | `GET`, `POST` | `manufacturing.work_centers.view/manage` | Keyset list and create Work Center. |
| `/api/manufacturing/work-centers/[id]` | `GET`, `PUT`, `DELETE` | `view/manage` | Detail, update, soft delete. Delete returns `work_center_in_use` when downstream references exist. |
| `/api/manufacturing/work-center-resources` | `GET`, `POST` | `view/manage` plus host ACL for selected Resource | Keyset list filtered by `workCenterId`; create membership. |
| `/api/manufacturing/work-center-resources/[id]` | `GET`, `DELETE` | `view/manage` | Detail and remove membership. |

There is no membership `PUT` route. The UI performs remove then add in separate explicit commands, preventing an accidental history rewrite and preserving independent optimistic-lock versions.

### Schemas and response shape

`ManufacturingWorkCenterCreateInput` accepts `code`, `name`, optional `description`, optional `siteId`, and optional `isActive`. Update accepts `id`, the entity's optimistic-lock precondition, and editable values. `ManufacturingWorkCenterResourceCreateInput` accepts `workCenterId` and `resourceId`; `resourceNameSnapshot` is server-controlled.

List APIs use keyset pagination, `pageSize <= 100`, and bounded filters: `id`, `ids`, `siteId`, `isActive`, and exact/prefix code lookup where the query engine can support it. The first UI does not expose broad search, saved perspectives, export, selection, or bulk action controls. Detail/list responses include `updatedAt`, `deletedAt` where appropriate, and a membership's fallback `resourceNameSnapshot` plus a nullable current `resource` summary only after authorized, batch enrichment.

### Stable domain errors

| Code | HTTP | Meaning |
|---|---:|---|
| `work_center_code_conflict` | 409 | An active Work Center already has the normalized code in scope. |
| `work_center_inactive` | 422 | A new routing or membership mutation targets an inactive Work Center. |
| `work_center_in_use` | 409 | Delete would orphan a routing, released definition, or execution reference. |
| `work_center_resource_duplicate` | 409 | The resource is already an active member of the Work Center. |
| `resource_provider_unavailable` | 422 | Add/validate membership requires optional `resources`, which is unavailable. |
| `resource_not_found`, `resource_scope_mismatch`, `resource_inactive` | 404/403/422 | Resource validation failed without leaking cross-scope data. |
| `site_provider_unavailable`, `site_not_found`, `site_scope_mismatch` | 422/404/403 | Optional Site validation failed. |
| `version_conflict` | 409 | The submitted Work Center or membership `updatedAt` is stale. |

## Commands, Undo, and Audit

Every write is a singular Manufacturing command, uses the canonical command persistence/mutation-guard path, and records before/after evidence. A command owns one transaction and no external call can occur after its durable state is committed without a separately specified subscriber.

| Command | Atomic effect | Undo / recovery |
|---|---|---|
| `manufacturing.work_center.create` | Creates one scoped Work Center. | Soft-deletes the new record only while it has no P1.5/P1.7 reference; otherwise undo deactivates it. |
| `manufacturing.work_center.update` | Updates one record after optimistic-lock check. | Restores the precise preimage if no newer version conflicts. |
| `manufacturing.work_center.deactivate` | Sets `isActive=false`. | Restores active state if no newer version conflicts. |
| `manufacturing.work_center.delete` | Soft-deletes an unused Work Center. | Restores the same identity/code subject to current uniqueness and reference checks. |
| `manufacturing.work_center_resource.create` | Validates then adds one membership and snapshot fallback. | Soft-deletes that membership. |
| `manufacturing.work_center_resource.delete` | Soft-deletes one membership. | Restores it only if pair uniqueness and current Work Center state permit. |

Commands use the parent Work Center version for Work Center changes and the membership's own version for membership update/delete. They never reuse a parent version for a child mutation. Constraint races are translated into stable errors; the UI displays canonical record-conflict recovery.

## ACL and Authorization

P1.6 adds two feature IDs, following the `acl.ts` and `setup.ts` conventions:

- `manufacturing.work_centers.view` — read Work Centers and member fallbacks;
- `manufacturing.work_centers.manage` — create, update, deactivate/delete, and manage memberships; depends on `view`.

Default-role placement follows the P1.0a module setup policy and is synchronized through canonical role feature setup. Membership resolution additionally honors the host `resources` ACL: a user cannot learn or assign a Resource merely because they manage Work Centers. Resource lookup options are scoped and bounded; if the host does not authorize the read, the resource name/metadata is not enriched. The same rule applies to optional WMS Site lookup.

## UI/UX

### Routes and pages

| Route | Purpose | Access |
|---|---|---|
| `/backend/manufacturing/work-centers` | Minimal paginated list: code, name, optional Site fallback, active state, member count, last update. | `manufacturing.work_centers.view` |
| `/backend/manufacturing/work-centers/create` | Work Center `CrudForm`. | `manufacturing.work_centers.manage` |
| `/backend/manufacturing/work-centers/[id]` | Work Center edit `CrudForm`, status action, and member-resource `DataTable`/dialog. | view; mutations require manage |

The list uses a stable `DataTable` entity ID and extension table ID obtained from generated facts. It includes normal loading, error, empty, and pagination states, but no bulk mutation, search bar, advanced filters, column chooser, perspectives, or export in the first configuration slice.

The detail page uses a standard `CrudForm` with `createCrud`, `updateCrud`, `deleteCrud`, `apiCall`, translated `flash` feedback, `createCrudFormError`, and canonical optimistic conflict presentation. The resource-membership dialog uses a bounded server/API lookup; it has `Cmd/Ctrl+Enter` submit and `Escape` cancel. Destructive remove uses `useConfirmDialog()`. Status uses `StatusBadge` and a later-inactive resource uses `Alert` with semantic tokens. No raw `fetch`, raw form, hard-coded copy, arbitrary Tailwind values, inline page-body SVG, or unlabelled icon-only action is permitted.

### Frontend architecture contract

| Route | Server root | Client island | Data owner |
|---|---|---|---|
| list | `backend/manufacturing/work-centers/page.tsx` | `WorkCentersTableClient` | Work Center CRUD API |
| create | `backend/manufacturing/work-centers/create/page.tsx` | `WorkCenterFormClient` | Work Center CRUD API |
| detail | `backend/manufacturing/work-centers/[id]/page.tsx` | `WorkCenterFormClient`, `WorkCenterResourcesClient`, `WorkCenterResourceDialog` | Both scoped APIs |

Page roots stay server components. Client islands own only DataTable/CrudForm/dialog state and must not preload an unbounded resource catalog. No page-root `"use client"`, global provider, bootstrap change, or new browser-heavy dependency is allowed. New/touched client files must remain below 300 LOC; split dialog/table leaves before that threshold. The incremental first-load budget is no new heavy chunk and at most 20 KiB gzip above already reused UI/DataTable chunks. Hydration smoke tests and create/edit/dialog interaction tests are merge evidence.

## Internationalization, Search, Cache, and Observability

- Add all Manufacturing locale keys for list/form labels, status, membership help, empty/loading/error states, dialog keyboard affordances, and stable domain errors. Server code uses `resolveTranslations`; client code uses `useT`.
- Register query indexing for Work Centers and membership only through `makeCrudRoute`/generated entity facts. There is no global full-text search requirement in P1.6.
- Do not add a cache initially. Configuration is infrequent, pages are paginated, and cached cross-module summaries create avoidable invalidation and ACL risks. If a cache is later justified, resolve it through DI, scope tags by tenant/org, and invalidate on every parent/member mutation.
- List enrichment must use one bounded, same-scope resource batch lookup per page, never N+1. When the optional provider is absent or unauthorized, no retry storm or error log at warning level is emitted for a normal page read.
- Commands use structured logging without user-entered description or protected resource data. Metrics/telemetry may count stable error codes and provider-unavailable reads without payload values.

## Migration and Backward Compatibility

The change is additive: P1.6 introduces new Manufacturing tables, commands, ACL IDs, route paths, API schemas, backend pages, locale keys, generated registrations, and internal snapshot shape. It changes no existing WMS, Resources, Planner, Catalog, or Sales route/schema/event/import path.

The migration creates the two tables, scope/lifecycle indexes, and the partial active-membership/code uniqueness constraints. It has no backfill: an existing system has no Work Centers to infer from resource names or warehouses. Run `yarn db:generate` as a diff probe, retain only intended Manufacturing migration/snapshot output, and rerun as a no-op check. Do not apply it locally without explicit approval.

New IDs and APIs become stable only when released. The P1.5/P1.7 implementation must add reference checks before enabling delete on records that can be referenced; it must not rewrite P1.6 identities. No legacy client requires compatibility bridging because no Manufacturing runtime module is yet deployed by this specification.

## Implementation Plan

### Phase 1 — bounded domain model and commands

1. Confirm P1.0a package/bootstrap exists and generate current module facts; create `data/entities.ts`, validators, `acl.ts`, `setup.ts`, commands, command tests, and internal snapshot producer.
2. Implement Work Center and membership invariants, active partial unique indexes, scope checks, optional Resource/Site resolver seams, optimistic locking, audit, undo, and no-PII boundaries.
3. Generate and review the module migration/snapshot without applying it.
4. Result: commands exercise both entities with no API/UI dependency.

### Phase 2 — public API and safe optional enrichment

1. Add `makeCrudRoute` CRUD routes, schemas, OpenAPI, per-method metadata, query indexing, response transforms, canonical mutation guards, and stable errors.
2. Add bounded authorized resource enrichment with fallback summaries, absent-provider behaviour, and API scope/concurrency tests.
3. Result: all P1.6 data is manageable through a fully scoped contract.

### Phase 3 — ACL, UI, and i18n

1. Add ACL setup grants, localized pages, `DataTable`, `CrudForm`, membership dialog, conflict handling, keyboard behaviour, state components, and route guards.
2. Add server/client boundary and interaction/hydration tests; verify no raw HTTP/custom form or heavy client bundle is introduced.
3. Result: an authorized administrator configures a Work Center and its members end to end.

### Phase 4 — integration and downstream contract evidence

1. Verify disabled `resources`, disabled `planner`, optional WMS Site lookup, tenant/org isolation, generator output, and module-decoupling tests.
2. Add an internal consumer test proving the snapshot producer remains stable after current master data changes.
3. Record P1.12 evidence and run the readiness audit before implementation is promoted.
4. Result: P1.5 can rely on the defined Work Center reference contract, but routing is not implemented in this P1.6 change.

## Testing Strategy

### Unit and command tests

- code normalization, blank/length boundary, case-insensitive scope uniqueness, soft-delete/restore race;
- tenant/org/Site mismatch never resolves a Work Center or resource;
- create/update/deactivate/delete with optimistic lock and exact undo payloads;
- membership create accepts same-scope active resource only and concurrent duplicate create maps to `work_center_resource_duplicate`;
- membership removal works after the optional provider disappears or the resource becomes inactive;
- Work Center can exist with no `resources`/`planner`; add membership reports provider-unavailable rather than silently persisting an unchecked ID;
- unauthorized caller cannot receive current resource fields or use resource lookup;
- snapshot producer retains code/name/member display fallbacks after resource rename/deactivation/current membership changes;
- no planner service is resolved from any P1.6 path.

### API and UI integration tests

- self-contained create/read/update/delete Work Center fixtures, cleaned in `finally`;
- exact camelCase response fields including `updatedAt`, conflict `409`, OpenAPI presence, and no cross-scope read/mutation;
- membership GET/POST/DELETE through the same APIs; resource summary is batched and omits protected fields;
- absent `resources` composition supports Work Center CRUD and resource-mutation error behaviour;
- UI list/create/detail, empty/loading/error, inactive warning, dialog keyboard handling, deletion confirmation, and both parent/child conflict recovery;
- generated registry includes the module only when opt-in activation is enabled; an application without Manufacturing has unchanged behavior;
- query-count evidence establishes no resource N+1 on a page of up to 100 Work Centers/members.

### Validation commands

Choose the local or Docker runner once, record it with the PR evidence, and run the smallest relevant gate:

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
yarn workspace @open-mercato/core test
yarn typecheck
yarn i18n:check-hardcoded
```

## P1.12 Evidence Mapping

| Evidence class | P1.6 requirement |
|---|---|
| Tenant/org/Site isolation | All parent/member/provider lookups fail closed; cross-scope API and command tests. |
| Optimistic concurrency | Parent and membership have independent `updatedAt` guards and conflict UI coverage. |
| Module isolation | No direct cross-module ORM; `resources`/WMS optional and `planner` unused; disabled-module test. |
| Undo/audit | Every mutation is command-backed with before/after evidence and recovery rules. |
| Compatibility | Additive migration/API/ACL; no existing contract modified; generator evidence. |
| Partial failure | Resource lookup occurs before membership persistence; transaction failure produces no partial member row. |
| Performance | Keyset pagination, page size bound, no cache, no resource N+1, no client resource preload. |

## Alignment With Adjacent Specifications

- **P1.0a:** supplies the single opt-in package/module, hard `catalog` dependency, and optional `resources`/WMS/`planner` peers. P1.6 adds no public entrypoint beyond its internal capability files.
- **P1.2:** owns WMS Site. P1.6 accepts only an optional scalar Site ID and defers operational applicability/warehouse snapshots to P1.7/P1.10.
- **P1.4a/P1.4b:** remain BOM-only; they neither own nor require Work Centers.
- **P1.5:** consumes exactly one active `workCenterId` per optional sequential routing operation; it owns operation sequence, setup/run time, and instructions.
- **P1.7:** calls the snapshot producer during release and requires valid Site applicability for an executable definition.
- **P1.10:** freezes the released definition snapshot into the production-order execution snapshot. It does not recalculate member capacity or availability.

## Risks & Impact Review

### Duplicate resource master

- **Scenario:** Work Center receives capacity, efficiency, shift, resource type, or current-resource fields that diverge from `resources`/`planner`.
- **Severity:** High
- **Affected area:** Manufacturing, Resources, Planner, future scheduling and costing.
- **Mitigation:** Only scalar resource IDs and a display fallback persist; capacity/calendar/cost fields are forbidden in the schema and review checklist.
- **Residual risk:** A later scheduler still needs an explicit capability contract; this is acceptable because P1.6 makes no scheduling promise.

### Optional provider fails during membership write

- **Scenario:** `resources` is disabled or throws after the UI submits a member ID.
- **Severity:** High
- **Affected area:** Membership API/command and configuration integrity.
- **Mitigation:** Validate with an authorized same-scope lookup before the command persists. Provider absence produces a stable `422`; no unchecked member row is written.
- **Residual risk:** A provider can disappear after a valid historical assignment. Read/delete degrade through the persisted fallback rather than block recovery.

### Cross-tenant/resource ACL leak

- **Scenario:** A caller guesses a Resource UUID from another tenant or lacks host resource permission.
- **Severity:** Critical
- **Affected area:** Resource enrichment and membership create.
- **Mitigation:** Every provider lookup uses caller scope and host ACL; errors do not expose protected names; API tests cover tenant/org/ACL cases.
- **Residual risk:** New provider adapters must preserve the same contract, enforced by module-decoupling and integration tests.

### Concurrent configuration changes

- **Scenario:** Two administrators rename/deactivate a Work Center or add the same member concurrently.
- **Severity:** High
- **Affected area:** Commands, API, UI, future routing references.
- **Mitigation:** `updatedAt` lock headers for editable records, partial unique constraints, transactional command writes, stable `409` mapping, and UI retry/refresh.
- **Residual risk:** One administrator must retry after a legitimate race.

### Current master data rewrites history

- **Scenario:** A machine is renamed or later moved out of the Work Center, then a released definition is displayed.
- **Severity:** High
- **Affected area:** P1.7/P1.10 traceability.
- **Mitigation:** P1.6 defines the snapshot producer with Work Center and member display values; P1.7/P1.10 must persist it immutably.
- **Residual risk:** P1.6 alone has no released document. The release gate prevents claiming historical semantics before P1.7 exists.

### Premature scheduling expectation

- **Scenario:** Users interpret a listed resource membership as an available-capacity or date promise.
- **Severity:** Medium
- **Affected area:** UI/product positioning and future planning.
- **Mitigation:** UI labels state “assigned resources”, never “available capacity”; no date, utilization, shift, or allocation result is rendered.
- **Residual risk:** Product documentation must retain the same wording until a scheduler capability ships.

### Data volume or N+1 enrichment

- **Scenario:** A page with many Work Centers performs one resource query per membership or loads the entire resource catalogue in the browser.
- **Severity:** Medium
- **Affected area:** Backend list/detail latency and browser memory.
- **Mitigation:** Keyset page limit of 100, batch provider lookup, bounded API selector, no initial cache, and query-count tests.
- **Residual risk:** Large resource catalogs later need their own search/lookup contract.

## Final Compliance Report — 2026-08-28

### AGENTS.md Files Reviewed

- `AGENTS.md` (root);
- `.ai/specs/AGENTS.md`;
- `packages/core/AGENTS.md`;
- `packages/ui/AGENTS.md`;
- `packages/cli/AGENTS.md`;
- `.ai/skills/om-spec-writing/SKILL.md` and its template, checklist, and compliance review;
- `BACKWARD_COMPATIBILITY.md`;
- Manufacturing roadmap, Wave 0 backlog, execution plan, P1.0a package bootstrap, P1.2 Site, P1.4a BOM, `resources` entities/validators, and `planner` entities.

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root/Core AGENTS | No cross-module ORM | Compliant | Resource and Site links are scalar IDs; summaries use authorized providers. |
| Root/Core AGENTS | Tenant/org scope and fail-closed links | Compliant | Entity, API, command, provider, and test requirements are explicit. |
| Root/Core AGENTS | Commands, audit, mutation guards, optimistic locking | Compliant | All writes are singular commands with own locks and undo. |
| Core AGENTS | CRUD factory, OpenAPI, method metadata, query indexing | Compliant | Required for all declared CRUD routes. |
| UI AGENTS | CrudForm/DataTable/apiCall/guarded writes | Compliant | Exact primitives and conflict/keyboard behaviour are specified. |
| Root/UI AGENTS | DS and i18n | Compliant | Semantic primitives/tokens, locale keys, no raw controls/HTTP, and accessibility rules are explicit. |
| Core/CLI AGENTS | Migration and generated artefacts | Compliant | Generate/diff/no-op workflow, snapshot, and no local migration apply are specified. |
| BACKWARD_COMPATIBILITY | Existing contract surfaces | Compliant | Additive only; no existing entity/API/import/event/ACL rename or removal. |
| Spec checklist | Optional-peer ownership and disabled-module behaviour | Compliant | Manufacturing owns glue; matrices/tests cover Resources/WMS/Planner states. |
| Spec checklist | Sensitive data/encryption | Compliant | No PII or sensitive data is introduced; later semantic expansion is explicitly gated. |
| Spec checklist | Scope cohesion | Compliant | Independent fresh-context review passed: Work Center and optional membership have one lifecycle; routing, release, execution, capacity, calendars, and costing remain separate. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Capability boundary | Pass | Membership is inseparable from a useful Work Center; P1.5 routing remains separate. |
| Data model matches API | Pass | Both entities, IDs, locks, list bounds, response fallbacks, and errors align. |
| API matches UI | Pass | CRUD routes support the three pages and membership dialog without unbounded client data. |
| Optional peers | Pass | Tables and error rules define all absent/unauthorized/inactive states. |
| Snapshot/history | Pass | P1.6 creates producer contract; P1.7/P1.10 own immutable persistence. |
| Risks cover writes | Pass | Scope, provider, race, history, and performance failure modes are represented. |

### Non-Compliant Items

None identified.

### Verdict

**Design complete — readiness review pending.** The P1.6 contract is internally coherent and can enter the formal pre-implementation readiness audit after P1.0a topology evidence is available. It does not authorize implementation before the named upstream/bootstrap and readiness gates pass.

## Changelog

- 2026-08-28: Created P1.6 full specification. It confirms Manufacturing ownership of the Work Center, adds optional zero-to-many Resource membership with scalar IDs/display fallbacks, defines P1.5/P1.7/P1.10 contracts, and explicitly defers capacity, calendars, costs, and scheduling.

### Review — 2026-08-28

- **Reviewer:** Independent fresh-context scope review
- **Security:** Passed; every optional Resource/Site resolution is scoped, authorized, and fail-closed.
- **Performance:** Passed; keyset bounds, no initial cache, batch enrichment, and no client catalogue preload are required.
- **Cache:** Passed; no cache is introduced in this infrequent configuration slice.
- **Commands:** Passed; every mutation has command, transaction, undo, lock, and recovery requirements.
- **Risks:** Passed; optional-provider, scope, race, history, expectation, and N+1 risks are covered.
- **Scope cohesion:** Passed; Work Center plus optional membership is one capability; routing, release, execution, calendar, capacity, cost, and scheduling are deferred.
- **Verdict:** Approved for readiness review; implementation remains gated by P1.0a and P1.12 evidence.
