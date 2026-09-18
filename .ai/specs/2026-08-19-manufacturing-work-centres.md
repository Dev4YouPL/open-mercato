# Manufacturing Minimal Work Centre and Resource Boundary

Throughout this specification, **Work Centre** is the user-facing domain term.
`WorkCenter`, `work_center`, and `work-centers` are the corresponding
technical class, event/entity, and route identifier forms required by code
conventions.

## TLDR

P1.6 defines the smallest Manufacturing-owned Work Centre capability needed by
the first discrete Manufacturing release. Manufacturing owns Work Centre
identity, applicability to manufacturing operations, and the references that
make a Work Centre usable from routing drafts. The `resources` module remains
the owner of reusable resource identity, capacity units, and active state. The
`planner` module remains the owner of reusable timezone-aware availability
rules; it is reserved for later planning and is not called by P1.6.

This specification must not create a second resource master, a second calendar
master, or a scheduling subsystem. It defines a bounded extension boundary over
scalar resource IDs and leaves finite-capacity planning, calendars, queue/move/
overlap time, alternate resources, crews, tools, and specialist constraints to
later capabilities.

## Overview

P1.6 is the Manufacturing Wave 0 foundation for Work Centres and resources. It
is specification work tracked by [GitHub issue #5394](https://github.com/open-mercato/open-mercato/issues/5394).
The planned artifact is explicitly listed in the Manufacturing specification
backlog as `2026-08-19-manufacturing-work-centres.md`.

The capability is required so that P1.5 routing drafts can refer to a stable
manufacturing operation context, and so that later P1.7 released definitions
can freeze the resource/work-centre interpretation used by a definition. It
does not make routing or production orders executable and does not implement
capacity planning.

The architecture baseline is staged: the Work Centre boundary may be designed
and implemented independently of stock-affecting WMS execution and of the
Catalog quantity/UoM contract. P1.6 is non-quantity work and therefore is not
blocked by Catalog delivery.

### Goals

- Define Manufacturing ownership of minimal Work Centres for later routing
  consumption.
- Reuse `resources` for reusable resource identity, capacity units, and active
  state.
- Preserve `planner` as the owner of reusable availability rules for later
  capabilities without making it a runtime requirement for P1.6 manual flows.
- Define stable scalar-ID references and immutable snapshots for downstream
  released-definition and execution contracts.
- Define enough CRUD/API/UI, ACL, scoping, optimistic-locking, and audit
  behavior for a real implementation-ready specification.
- Preserve a model-neutral internal boundary that a future process capability
  could consume without importing discrete-specific aggregates.

### Non-goals

This specification does not define:

- finite-capacity scheduling, MRP, pegging, dispatching, or optimization;
- calendar ownership, calendar authoring, or a new availability engine;
- alternate or parallel routings, overlap, queue, move, or setup matrices;
- automatic capacity reservation or resource allocation;
- crews, tools, assets, staff qualifications, maintenance, calibration, or tool
  life as Manufacturing-owned masters;
- shop-floor/MES data collection, offline buffering, device sequencing, OEE, or
  machine control;
- process/batch recipes, costing, QMS, PLM/ECO, subcontracting, or enterprise
  packaging;
- production-order release, stock postings, WMS reservations, or backflush;
- a public second runtime module or public model-neutral package subpath in
  the bootstrap phase.

## Problem Statement

Without an explicit boundary, a Manufacturing implementation could make a
warehouse or Work Centre the permanent plant/resource master, duplicate
`resources` or `planner` data, or silently introduce scheduling semantics into
draft authoring. It could also make the optional `planner` module a hard
dependency even though a manual first-core order does not require calendars or
finite-capacity checks.

The repository roadmap therefore requires an explicit ownership split before a
full routing or release specification is finalized:

- `resources` owns reusable resource identity and base capacity;
- `planner` owns reusable timezone-aware availability rules;
- Manufacturing owns minimal Work Centres; P1.5 owns routing applicability;
- assets, tools, and people remain separate identities and owners;
- scheduling never becomes the master of maintenance, calibration, tool-life,
  skills, or qualification state.

## Proposed Solution

Create a Manufacturing-owned Work Center master with a scoped identity and a
separate scoped membership table containing zero to 100 scalar resource IDs.
The public CRUD is intentionally configuration-only. It validates references
when the optional provider is present, preserves inactive references for
history, and never copies resource capacity or planner rules into Manufacturing.

P1.5 will reference at most one Work Center from a routing operation. P1.7 will
capture the Work Center and resource evidence in an immutable snapshot at
definition release. A later scheduling capability may interpret this data with
resources and planner, but P1.6 does not choose a machine, calculate dates, or
reserve capacity.

The rejected alternatives are: making Work Center a single resource, adding
capacity/calendar directly to Work Center, and implementing only a label with
no resource membership. Those options either duplicate ownership or leave no
stable boundary for later routing and planning.

## Scope and Accepted Decisions

### Resolved P1.6 decisions

The following decisions are normative for this specification:

- P1.6 implementation starts only from an implementation base where P1.0a and
  P1.4a are merged or rebased into the branch, generated, and accepted. The
  open prerequisite is PR #6, `feat/manufacturing-p1-0a-bootstrap-p1-4a-bom-authoring`
  → `develop`; a commit that exists only elsewhere in repository history does
  not satisfy this gate. P1.6 must use that package/module boundary; it must
  not re-scaffold, fork, or work around it.
- A Work Centre has zero to 100 optional resource members.
- Work Centre owns identity, lifecycle, and scope. P1.5 owns routing
  applicability.
- resources owns reusable resource identity, base capacity, capacity units, and
  active state.
- planner owns availability rules. P1.6 does not call planner and does not
  persist a calendar or availability result.
- A routing operation may reference at most one Work Centre. It does not select
  a concrete resource in P1.6.
- A Work Centre may be authored without resources. P1.7 decides whether an
  empty membership is acceptable for a released executable definition.
- code and name are required; code is case-insensitively unique within the
  tenant/organization for non-deleted Work Centres.
- membership is updated together with the parent Work Centre in one command and
  transaction; membership has no public standalone CRUD.
- on create, omitted and empty `resourceIds` are identical unassigned authoring
  requests and do not resolve the optional provider or require `resources.view`;
  a non-empty initial set requires the provider and `resources.view`.
- if an update omits `resourceIds`, membership is preserved without requiring
  the optional provider; an incoming set equal to the stored set is idempotent
  and may also proceed without that provider; every changed set, including a
  removal-only set, requires an available resources provider and
  `resources.view`. When available, that provider validates every resulting
  resource ID.
- P1.6 is OSS scope in the standalone Manufacturing package. Advanced
  scheduling, MES, QMS, costing and enterprise
  capabilities require separate specifications and readiness gates.

### Ownership and module dependencies

1. The runtime module is `manufacturing` inside the standalone
   `@open-mercato/manufacturing` package.
2. `catalog` remains the only hard **runtime-module** dependency in
   `ModuleInfo.requires`. `resources`, `planner`, WMS, assets, tools, and
   workforce providers are optional peers or later inputs. This is distinct
   from npm package dependencies: P1.6 uses the existing workspace runtime
   dependency on `@open-mercato/ui` and peer
   dependencies compatible with `@mikro-orm/postgresql`, `@open-mercato/shared`,
   `react`, and `react-dom`, following the standalone-module pattern used by
   `@open-mercato/checkout`. These npm dependencies do not add module metadata
   requirements or make `resources` or `planner` hard runtime modules.
3. Work Centre records are Manufacturing-owned. They are not a replacement
   for `resources_resources` and do not own reusable capacity or availability
   rules.
4. Resource references cross module boundaries as scalar IDs. No direct ORM
   relationship may be created between Manufacturing and `resources` or
   `planner`.
5. If an optional peer is absent, Work Centre authoring and manual routing
   authoring remain usable within the agreed reduced contract. A feature that
   genuinely needs availability must fail clearly or degrade according to the
   optional-provider contract; it must not silently invent availability.

### Work Centre identity and applicability

The user-facing master is a Manufacturing-owned Work Centre. The minimum
identity is:

- UUID;
- tenant and organization scope;
- required code and name;
- optional description;
- explicit isActive state;
- zero-to-100 resource membership stored in a Manufacturing-owned junction.

A Work Centre is a logical production place or work cell. It is not a machine,
person, warehouse, calendar, or reservation. A resource may belong to more than
one Work Centre because membership describes a manufacturing context, not
exclusive ownership.

P1.6 exposes an active, scoped Work Centre option-read contract for later
consumption. That contract is the conventional Work Centre GET with
`isActive=true`; it is not a second endpoint or service. It requires
`manufacturing.work_center.view`, applies the caller's tenant/organization
scope, excludes soft-deleted records, and answers an unknown or foreign `ids`
value with the standard empty, non-disclosing collection result. P1.5 must use
this predicate for its selector and may not infer activity from a response that
omits it.
P1.5 owns the routing contract: one routing operation may reference at most one
Work Centre, along with operation order, setup/run time, instructions, and any
future direct operation-level constraints. P1.6 does not select a concrete
resource for an operation or define an operation-to-Work-Centre link.

### Resources integration

The current `resources` module owns reusable resource records with tenant/org
scope, name, resource type, base capacity, capacity units, active state, an
optional availability rule set reference, custom fields, comments, activities,
tags, CRUD APIs, and UI. P1.6 reuses that contract and stores only scalar
resource IDs.

When `resources` is available, each resource ID supplied to Work Centre
create or update must resolve to a live, active resource in the caller's
tenant/org. P1.6 does not enforce a resource type because the current
resource-type model is configurable and has no Manufacturing-owned taxonomy.

If a resource is later disabled or soft-deleted, the membership is retained.
The Work Centre response exposes the stored scalar IDs and count, while an
authorized UI may resolve current display data through the resources API.
Missing or unavailable display data is shown as unresolved; Manufacturing does
not copy a resource state or silently remove the relation or choose a
replacement. New routing or release validation rejects an inactive or deleted
resource.

Manufacturing must not import `ResourcesResource` as a cross-module ORM
relation or copy name, capacity, type, availability, or active state into its
own mutable master. The only historical copy is the explicit immutable
snapshot owned by a downstream released-definition/order contract.

### Planner integration and planner-absent behavior

The current `planner` module owns availability rule sets and rules, including
timezone, recurrence, exclusions, availability/unavailability kind, and
resource subjects. P1.6 treats planner data as an optional future input, not as
a Work Centre master.

P1.6:

- does not create a calendar or availability rule set;
- does not add availability fields to Work Centre;
- does not call planner during create, update, delete, list, or routing lookup;
- does not persist “available” as a Manufacturing fact;
- does not make a missing calendar mean universally available;
- leaves timezone-sensitive execution to a later planning contract.

The only optional provider P1.6 uses is `resources`. If it is absent, Work
Centre CRUD and unassigned authoring remain usable. A changed `resourceIds`
set, including a removal-only set or an empty resulting set, returns the stable
`optional_provider_unavailable` result before mutation. An omitted
`resourceIds` field, or an incoming set equal to the already stored set, does
not require a provider lookup.

The current repository has an important distinction: `resources/index.ts`
currently declares `requires: ['planner']`. That is an existing
resources-module contract, not a Manufacturing dependency. P1.6 must not
change it or import around it. If the product later needs resources to run
without planner, that is a separate resources specification and compatibility
change. `planner` is never a P1.6 provider; its absence can only make the
`resources` provider unavailable through that existing dependency.

### Snapshot and historical semantics

P1.6 defines the input DTO for the snapshot; P1.7 owns the release moment and
the persistent released-definition snapshot. The snapshot is immutable evidence,
not a live join and not a second master.

```ts
type WorkCenterSnapshotV1 = {
  schemaVersion: 1
  capturedAt: string
  workCenter: {
    id: string
    code: string
    name: string
    description: string | null
    isActive: boolean
    updatedAt: string
  }
  resources: Array<{
    id: string
    name: string
    isActive: boolean
    updatedAt: string
  }>
}
```

P1.6 defines this as a module-internal exported type in
`packages/manufacturing/src/modules/manufacturing/lib/workCenterSnapshot.ts`.
P1.7 imports it only from within the Manufacturing module; it is not re-exported
from a supported package entrypoint or public package subpath. P1.6's type test
may import this module-internal file, but P1.6 neither serializes nor persists a
snapshot.

At release, P1.7 must resolve an active, non-deleted Work Centre and every
resource member captured for that Work Centre in the same scope, then capture
their display identity and source version. An unresolved, foreign, inactive,
deleted, or missing resource fails closed. An empty resources array is
technically valid but its eligibility for release is decided by P1.7.

The snapshot does not contain capacity, capacity unit, planner rules, calendar,
calculated availability, reservation, queue, or schedule. Later master-data
changes cannot reinterpret an existing released definition or order. Any
incompatible change to this DTO requires a new schemaVersion and an additive
migration path. P1.7 owns any Site reference and its immutable Site evidence;
P1.6 neither stores nor validates a Site.

### Scope, security, and compatibility

Every Work Centre and relationship operation must validate tenant and
organization scope and fail closed for cross-scope resource IDs. P1.6 must not
make a warehouse the plant identity; P1.7 owns Site applicability and scope
validation for released definitions.

The implementation must use canonical Open Mercato mechanisms for validation,
commands, mutation guards, events, ACL, i18n, CRUD forms, and data tables. The
minimum MVP permission shape follows the Manufacturing baseline: view, manage,
execute, and reverse. P1.6 registers only view and manage; execute/reverse
belong to later operational flows and must not be implied by Work Centre CRUD.

Every new user-editable Work Centre entity must use `updated_at`, return
`updatedAt` from list/detail APIs, and protect update/delete through the
standard optimistic-locking behavior. User-facing messages must be localized.
The API and event shapes must follow `BACKWARD_COMPATIBILITY.md`; additive
changes must also remain operationally backward compatible.

## Architecture

### Boundary model

The model-neutral Manufacturing boundary contains a minimal Work Centre
contract over shared resource IDs. It exposes an active, scoped Work Centre
read model for later capability consumers, while P1.5 separately owns every
routing and operation contract. Capability implementations depend on that
boundary; the boundary does not depend on discrete-only aggregates.

The boundary is an implementation acceptance criterion, not a second runtime
module. It owns contracts and lifecycle primitives only. It owns no UI,
workflow orchestration, direct WMS calls, model-specific business logic, or
aggregate outside the Work Centre capability. P1.0a exposes no domain
contracts publicly; any future reusable package subpath requires a separate
additive specification.

The implementation belongs under
`packages/manufacturing/src/modules/manufacturing/`: `data/entities.ts` and
`data/validators.ts` own persistence/input, `commands/` owns mutations and
undo/redo, `api/` owns the CRUD route and OpenAPI, `events.ts` owns typed event
declarations through `createModuleEvents({ moduleId: 'manufacturing', events } as
const)`, `acl.ts` and `setup.ts` own access/default grants, and
`backend/` plus locale resources own the setup UI. The module-root
`translations.ts` declares `translatableFields` for the generated Work Centre
entity ID with exactly `name` and `description`; it is generated and tested so
the Translation Manager can discover those fields. Generated registries and
entity IDs are produced by the generator and are never edited manually.

### Ownership map

| Concept | Owner | P1.6 responsibility | Explicitly not owned |
|---|---|---|---|
| Reusable resource identity | `resources` | Reference and validate IDs | Duplicate resource master |
| Base capacity and capacity unit | `resources` | Consume where a later contract needs it | Recalculate or persist competing capacity |
| Work Centre identity | `manufacturing` | Define, scope, manage, and expose it | Plant/site identity |
| Routing applicability | `manufacturing` P1.5 | Consume the active, scoped Work Centre read model | Operation-to-Work-Centre linkage in P1.6 |
| Availability rules and calendars | `planner` | Optional reference/input only | Calendar master or availability engine |
| Assets, tools, people | Existing specialist owners | Optional future constraint inputs | Manufacturing-owned identity/state |
| Physical stock | WMS | None in P1.6 | Inventory ledger or posting |

### Current-state repository audit

The current branch and the accepted prerequisite base contain the following
relevant surfaces:

- PR #6 (`feat/manufacturing-p1-0a-bootstrap-p1-4a-bom-authoring` →
  `develop`) is the open implementation prerequisite. Its branch defines
  `packages/manufacturing`, the single runtime module `manufacturing`, shipped
  BOM ACL IDs, and generated Manufacturing entity IDs; it is not an ancestor
  of this design branch. This worktree consequently contains none of those
  implementation artifacts.
- `resources` defines `ResourcesResource` with scoped identity, name,
  configurable resource type, base capacity, capacity units, active state,
  optional planner rule-set ID, timestamps, and soft delete.
- `resources` exposes CRUD at `/api/resources/resources` and supports
  scoped lookup by `id`/ `ids`, bounded search, and active filtering.
- `planner` defines scoped availability rule sets and rules with timezone,
  recurrence, exceptions, and resource subjects.
- `resources/index.ts` currently has `requires: ['planner']`; this remains
  an existing peer boundary and is not altered by P1.6.
- WMS Site remains an external contract consumed by P1.7 and later; P1.6 has no
  Site field, provider lookup, UI, or implementation gate.

Fact status is explicit: the `resources` entity, route, ACL, command IDs,
event IDs, and `requires: ['planner']` declaration are confirmed in code. The
Manufacturing package/module, Manufacturing entity IDs, and any cross-module
provider service are confirmed only by design documents or remain unimplemented
in this branch. Those latter items are implementation gates, not assumptions
that may be encoded as private imports or public aliases.

The implementation must use the existing query engine for optional
cross-module lookups. It resolves entity IDs at runtime from
`getEntityIds(false)`, scopes every query, and avoids direct imports of
`resources`, `planner`, or WMS ORM entities. No new cross-module DI contract
is introduced in P1.6.

P1.6 owns one local, typed `resolveOptionalReference` helper for a membership
operation that requires a peer validation. Create with an omitted or empty set,
and update with an omitted or stored-equal set, bypass this helper entirely.
The helper receives the generated entity ID, a requested ID/set, the required
source fields, the authenticated tenant/org scope, and the peer module's
published view feature. It must:

1. fail with `optional_provider_unavailable` when the generated entity ID is
   absent because the optional peer is not enabled or registered;
2. derive the authenticated actor from `ctx.auth.sub`, resolve `rbacService`,
   and call `userHasAllFeatures(actorId, [peerViewFeature], { tenantId,
   organizationId })` before querying; a missing actor or a false result maps
   to `resource_lookup_forbidden`, while a missing service, missing method, or
   thrown authorization check maps fail-closed to
   `optional_provider_unavailable`; wildcard feature grants remain valid
   through this canonical service;
3. after those provider and feature checks, return an empty result without a
   resource-ID query when the changed target set is empty; otherwise call
   `queryEngine.query()` with explicit `tenantId`, `organizationId`,
   `filters.id`, `withDeleted: false`, `page: { page: 1, pageSize: 100 }`, and
   only the fields required by the decision; because the normalized non-empty
   input contains at most 100 IDs, this is one bounded lookup rather than a
   paginated membership scan;
4. map a missing scoped row to the non-disclosing peer-not-found error and an
   inactive in-scope row to the peer-inactive error where that peer exposes
   active state; and
5. map a query failure to `optional_provider_unavailable`, log only scoped
   technical identifiers, and never turn an absent provider, an empty result
   for a non-empty requested set, or a query failure into a guessed reference
   or availability value.

For resources, the generated member is `E.resources.resources_resource`; its
runtime entity ID passed to `queryEngine.query()` is
`resources:resources_resource`. The existing `resources.view` feature is the
other input. The query selects `id` and `is_active` (and `name`/`updated_at`
only for the downstream immutable snapshot), so a soft-deleted row is
indistinguishable from a missing row. A
future performance adapter may be additive and module-local, resolved through
`tryResolve`, but must preserve these exact result and error semantics.

The generated entity IDs for the two Manufacturing entities are not hand
authored in this specification. After module discovery, `yarn generate` must
confirm the exact generated `E.manufacturing.*` members; P1.5 and P1.7 must
consume those generated facts rather than invent aliases. If the current
authoring branch predates P1.0a, that is a branch-state fact, not permission to
replace the contract with a private import or literal ID.

## Data Models

### `ManufacturingWorkCenter`

Table: `manufacturing_work_centers`.

The model tables below use application property names. Persisted columns use
the corresponding snake_case names, including `tenant_id`, `organization_id`,
`updated_at`, and `deleted_at`.

| Field | Type | Rule |
|---|---|---|
| `id` | UUID | Primary key and stable technical identity. |
| `tenantId` | UUID | Required tenant scope. |
| `organizationId` | UUID | Required organization scope. |
| `code` | text | Required, trimmed, 1–100 characters, case-insensitively unique per tenant/org among rows with `deletedAt IS NULL`. |
| `name` | text | Required, trimmed, 1–200 characters. |
| `description` | text nullable | Optional purpose/instructions, maximum 8000 characters. |
| `isActive` | boolean | Defaults to `true`. Inactive records cannot be newly referenced by routing or release. |
| `createdAt` | timestamp | Standard creation timestamp. |
| `updatedAt` | timestamp | Required optimistic-lock version; changes on every parent or membership mutation. |
| `deletedAt` | timestamp nullable | Soft-delete marker. |

Work Centre does not contain capacity, capacity unit, availability rule-set
ID, efficiency, utilization, priority, primary resource, alternate resource,
or cost fields. It does not host custom fields in P1.6.

The description is operational master-data text, not a people/credential/PII
field. P1.6 therefore adds no encryption map or custom-field encryption
surface; reads still use the platform's standard decryption-aware helpers.

### `ManufacturingWorkCenterResource`

Table: `manufacturing_work_center_resources`.

This is a current-state membership table, not a standalone public CRUD entity.

| Field | Type | Rule |
|---|---|---|
| `id` | UUID | Primary key. |
| `tenantId` | UUID | Must match the parent scope. |
| `organizationId` | UUID | Must match the parent scope. |
| `workCenterId` | UUID | Scalar/foreign key to the Manufacturing parent. |
| `resourceId` | UUID | Scalar ID of a resources resource; no cross-module ORM or DB FK. |
| `createdAt` | timestamp | Relation creation timestamp. |
| `updatedAt` | timestamp | Technical relation timestamp; mutation is guarded by the parent version. |

Constraints and behavior:

- A Work Centre may have zero to 100 members.
- `resourceIds` is de-duplicated before validation and is limited to 100 IDs.
- The tuple `tenantId, organizationId, workCenterId, resourceId` is unique.
- Membership order has no meaning; responses sort resource IDs deterministically.
- There is no primary, alternate, priority, capacity override, or utilization
  field.
- Parent and membership changes are committed atomically.
- Soft-deleting a Work Centre does not physically delete membership rows.
- Deleting or disabling a resource does not cascade into Work Centre rows.

### Resource validation

On create, omitted and empty `resourceIds` skip provider resolution; a non-empty
initial set requires an available resources provider and every referenced
resource must be in-scope, non-deleted, active, and readable by the caller
through `resources.view`. On update, every changed membership set first requires an available resources provider and
`resources.view`, including a removal-only set with no remaining IDs; when
available, every resulting resource is validated with the same rules. A
resource type is not restricted in P1.6. Reusing the unchanged stored set is
allowed without a provider lookup.

### Snapshot DTO

The exact immutable `WorkCenterSnapshotV1` DTO is defined in the Snapshot and
historical semantics section above. It is not a user-editable entity and is
persisted by P1.7/P1.10, not by P1.6.

## API Contracts

### Standard CRUD endpoint

P1.6 exposes one conventional CRUD endpoint:

```text
/api/manufacturing/work-centers
```

It uses `makeCrudRoute`, the query engine, zod validators, OpenAPI metadata,
and the same query-by-id convention as `resources` and `planner`. Detail is
requested with one ID in the `ids` query parameter; no parallel
`/work-centers/:id` route is added.

The route exports the standard `metadata` and `openApi` values. `GET` requires
`manufacturing.work_center.view`; `POST`, `PUT`, and `DELETE` require
`manufacturing.work_center.manage`. The route passes writes to the exact
command IDs listed below and does not contain domain persistence logic.

### GET

Supported query fields:

- `page`, starting at 1, default 1;
- `pageSize`, 1–100, default 50;
- `ids` for scoped lookup; a detail read passes one ID in this comma-separated
  parameter;
- `search` for bounded matching over code and name;
- `isActive`;
- `sortField`: `z.string().optional()`, resolved through `sortFieldMap`, never
  a closed zod enum. The map covers every sortable DataTable accessor key:
  `code`, `name`, `createdAt`, `isActive`, and `updatedAt`; `resourceCount` is rendered as a
  non-sortable accessor until a supported aggregate sort is designed;
- `sortDir`: asc or desc.

The list uses `defaultSort: { field: 'code', dir: 'asc' }` and
`tiebreakSortField: 'id'`. This stable ordering is required because Work Centre
primary keys are random UUIDs; explicit sortable fields still use the same ID
tiebreaker across pages.

Every query is constrained by authenticated tenant/org. A collection GET with
an unknown or foreign `ids` value returns the standard empty, non-disclosing
result; a detail page that requires one record maps that empty result to the
standard 404. Soft-deleted Work Centres are not returned by this public
list/detail contract; undo and audit handlers use their own scoped internal
reads.

The admin list may omit `isActive` or explicitly query either activity state.
The downstream option-read contract is strictly
`GET /api/manufacturing/work-centers?isActive=true` with the same scoped
collection response. P1.5 must use that request (and may combine it with its
own bounded search or IDs filter); it receives no inactive Work Centre through
this contract. It requires `manufacturing.work_center.view` and uses the empty
non-disclosing result for an unknown or foreign ID rather than a distinct
consumer endpoint or error code.

### POST

Request fields:

```json
{
  "code": "WC-ASSY-01",
  "name": "Montaż obudowy",
  "description": "Gniazdo montażu obudów",
  "isActive": true,
  "resourceIds": ["00000000-0000-4000-8000-000000000001"]
}
```

`tenantId` and `organizationId` are derived from authenticated context,
never trusted from the request. `resourceIds` is optional; omitted and empty
both create an unassigned Work Centre and skip provider/RBAC resolution. A
non-empty supplied set requires the resources provider and `resources.view`.
When present, it accepts at most 100 UUIDs after de-duplication.

The command authorizes every changed membership set and every non-empty initial
set, then validates every resulting resource reference before writing anything.
Code conflicts are field-level validation errors and never leave a partial
parent or membership set.

### PUT

PUT requires `id`. Clients that have read `updatedAt` send the header produced
by the canonical `buildOptimisticLockHeader` helper; as with every standard
`makeCrudRoute` endpoint, a headerless request remains additive and is allowed.
Scalar fields are partial. If `resourceIds` is omitted,
membership is unchanged. If `resourceIds` is present, it replaces the
complete set after UUID validation and de-duplication. A changed set requires
an available resources provider and `resources.view`, even when it only removes
IDs or has an empty resulting set; when available, the provider validates every
resulting resource. An equal set is accepted as an idempotent no-op even when
the optional provider is unavailable. All effective changes use atomic
synchronization. More than 100 normalized IDs is rejected before a provider
lookup or database write.

### DELETE

DELETE requires `id`; clients send the `buildOptimisticLockHeader` result when
they have an `updatedAt` value, while a headerless request follows the standard
additive CRUD contract. It soft-deletes the
parent and sets `isActive = false`. It does not delete resources or membership
rows and does not alter released snapshots. It returns the standard ok response
only after commit. Physical deletion is not public P1.6 behavior.

### Response shape

The canonical application response is:

```ts
type WorkCenterResponse = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  resourceIds: string[]
  resourceCount: number
  createdAt: string
  updatedAt: string
}
```

The public response is camelCase, including `updatedAt` and `isActive`. The
implementation may select snake_case database columns in the
CRUD projection, but its `transformItem`/response mapping must expose the
camelCase contract in both list and detail responses and must never drop
`updatedAt`. Resource names, capacity, availability, and current resource
state are not part of this response; the UI resolves display data separately
only when the authorized resources provider is available.

`resourceIds` contains at most 100 deterministically sorted IDs. Because
membership is stored in a separate table, the route uses one supported
mechanism: a hand-written `GET` wrapper around the configured `makeCrudRoute`
handler. It first obtains the factory's scoped, paginated parent payload, then
uses the returned IDs for one tenant/org-scoped membership query, groups and
sorts the IDs by parent, derives `resourceCount`, and serializes the amended
payload. The wrapper applies to both list and `ids` detail reads and preserves
the factory's filters, sorting, paging, OpenAPI envelope, and non-disclosure
behavior. `transformItem` is deliberately not used for this load because it is
synchronous and invoked once per item; response enrichers are also rejected
because their additive fields must be namespaced. The implementation must not
issue one membership query per row or expose the junction as a standalone
endpoint.

`openApi` is built with the canonical CRUD OpenAPI factory. It declares
`workCenterResponseSchema` for the response above,
`createPagedListResponseSchema(workCenterResponseSchema)` for GET (including
`items`, `total`, `page`, `pageSize`, and `totalPages`), a `201` POST body of
`{ id: uuid }`, and `defaultOkResponseSchema` (`{ ok: true }`) for PUT and
DELETE. DELETE accepts `{ id: uuid }` through the standard scoped record-ID
resolver. The documented stable-error envelope is `{ error: string, code:
WorkCenterErrorCode }`, where `error` is localized and `code` is one of the
machine-readable values below; standard authentication and generic validation
errors retain their framework envelopes.

### Stable errors

Each error carries a stable machine-readable code and a localized message.
`WorkCenterErrorCode` is the zod enum formed from the codes in this table and
is the `code` value documented by the OpenAPI error envelope.

| Code | HTTP | Meaning |
|---|---:|---|
| `work_center_not_found` | 404 | Missing or out-of-scope record; no existence disclosure. |
| `work_center_code_conflict` | 409 | Live code already exists in the same tenant/org. |
| `work_center_restore_code_conflict` | 409 | Undo or redo cannot restore a historical code, whether the Work Centre remains active or is reactivated, because another live record now owns it. |
| `resource_not_found` | 404 | Missing or out-of-scope resource. |
| `resource_inactive` | 422 | An in-scope resource exists but is inactive; a soft-deleted resource uses the non-disclosing `resource_not_found` contract. |
| `resource_membership_limit_exceeded` | 422 | The normalized membership contains more than 100 resource IDs. |
| `resource_lookup_forbidden` | 403 | Caller lacks `resources.view`; Manufacturing does not grant it. |
| `optional_provider_unavailable` | 503 | Required optional resources provider is unavailable or its scoped query fails; neither case mutates membership. |
| `work_center_undo_forbidden` | 403 | The caller lacks current `manufacturing.work_center.manage` during undo. |
| `work_center_redo_forbidden` | 403 | The caller lacks current `manufacturing.work_center.manage` during redo. |
| `optimistic_lock_conflict` | 409 | Parent changed since it was read. |

No P1.6 endpoint creates a WMS posting, reserves stock/capacity, releases a
definition, or performs finite scheduling.

P1.5 and P1.7 own the error contract for consuming an inactive, deleted, or
otherwise ineligible Work Centre. P1.6 defines the eligibility rule but does
not pre-publish consumer-only codes such as `work_center_referenced`.

## UI/UX

### Paths

After the module is activated:

- list: `/backend/manufacturing/work-centers`;
- create: `/backend/manufacturing/work-centers/create`;
- detail/edit: `/backend/manufacturing/work-centers/<id>`.

The menu uses `manufacturing.workCenters.menu.label` (Polish value:
`Gniazda robocze` in `i18n/pl.json`) and is visible only with
`manufacturing.work_center.view`.

### List

The list uses `DataTable` and contains only setup-oriented controls:

- bounded search by code/name and an active filter;
- columns: code, name, active state, resource count, updated time;
- create, edit, soft-delete and refresh;
- standard loading, empty, error and conflict states.

Saved views, export, bulk actions, row selection, CRM-scale filters and a
dashboard are out of scope.

The list registers the stable DataTable host in module-root
`extension-points.ts` as `workCentersTable`, using
`dataTableExtensionHost({ tableId: 'manufacturing.work_center', baseSpotId:
'data-table:manufacturing.work_center', source:
'components/WorkCentersTableClient.tsx' })`. The client
passes that exact `extensionTableId` to `DataTable`, exposing the standard
`data-table:manufacturing.work_center:{columns,row-actions,filters,
search-trailing,toolbar}` spots. The table context remains the normal scoped
Work Centre API result; it never enriches resource names or state. Built-in
`RowActions` use stable IDs `open`, `edit`, and `delete`. The list page metadata
requires `manufacturing.work_center.view`; create metadata requires `manage`;
the detail page requires `view` and hides mutation affordances without `manage`.

### Form

`CrudForm` contains required code and name, optional description, isActive, and
a multi-resource selector. The resource selector is available only when its
optional provider can validate the selected IDs.

The resource selector uses `/api/resources/resources` through `apiCall` and
keeps pageSize at or below 100. It never reads the resource table directly.
When the provider is absent, the form shows a localized warning, preserves
existing IDs as opaque values, omits unchanged provider-dependent fields from
the write, and disables every membership change, including removal. A user without `resources.view`
may still edit Work Centre-owned fields, but cannot add, remove, or replace
resource membership.

The form does not show capacity, availability, calendar, priority, cost,
reservation, or a “schedule” action. Choosing a Work Centre must not look like
reserving a machine.

All visible strings use i18n. Create/update/delete use the standard
`CrudForm` optimistic-lock behavior, `Cmd/Ctrl+Enter` submit, `Escape`
cancel, and the standard 409 conflict bar. A list-row delete that is not
performed by `CrudForm` must wrap the mutation with
`withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), ...)`
and surface failures through `surfaceRecordConflict(err, t)`.

### Routing

P1.5 may consume a read-only Work Centre option contract. It shows only scoped,
non-deleted, active Work Centres and must not imply that a Work Centre is
scheduled or reserved. Routing remains a separate capability and owns setup
time, run time, instructions, and operation order.

### Frontend architecture contract

| Route | Server root | Client island | Data owner |
|---|---|---|---|
| `/backend/manufacturing/work-centers` | `backend/manufacturing/work-centers/page.tsx` | `components/WorkCentersTableClient.tsx` | Work Centre API |
| `/backend/manufacturing/work-centers/create` | `backend/manufacturing/work-centers/create/page.tsx` | `components/WorkCenterFormClient.tsx` | Work Centre API + optional resources API |
| `/backend/manufacturing/work-centers/<id>` | `backend/manufacturing/work-centers/[id]/page.tsx` | `components/WorkCenterFormClient.tsx` | Work Centre API + optional resources API |

All page roots stay server components and resolve translations, declarative
feature metadata, and the route shell without loading an optional provider.

| Client file | Exact browser-only reason | Imported by | Heavy deps | Cleanup / hydration risk | Rejected alternative |
|---|---|---|---|---|---|
| `components/WorkCentersTableClient.tsx` | DataTable state and row-delete conflict recovery | `backend/manufacturing/work-centers/page.tsx` | Shared DataTable only | No subscription; clear mutation state on unmount | A server-only table cannot provide DataTable selection/actions. |
| `components/WorkCenterFormClient.tsx` | CrudForm state and resource lookup through `apiCall` | Create and detail server roots above | Shared CrudForm only | Abort or ignore an unmounted resource lookup; retain no provider state globally | A server form cannot use CrudForm validation, optimistic-lock retry, or asynchronous lookup. |

Each server route has both page and metadata files at these exact paths:
`backend/manufacturing/work-centers/{page.tsx,page.meta.ts}`,
`backend/manufacturing/work-centers/create/{page.tsx,page.meta.ts}`, and
`backend/manufacturing/work-centers/[id]/{page.tsx,page.meta.ts}`.

No global provider or bootstrap registry changes; both islands remain route-local.

Budgets are: zero page-root `"use client"` directives, zero touched client
files over 300 LOC, zero new heavy browser libraries, and zero new global
providers. Client files must not import a resources ORM entity, planner, WMS,
or a provider SDK. Before merge, run `yarn check:client-boundaries` and
`yarn build:app`; attach the route-size output or explain why it is unavailable.
Browser coverage must prove hydration plus create/edit/delete,
provider-unavailable rendering, and 409 conflict recovery without client-side
route errors.

## Edge Cases & Failure Scenarios

- A duplicate code is pre-checked inside the scoped write transaction and the
  partial-index unique-violation race is mapped to `work_center_code_conflict`;
  concurrent contenders receive the same translated conflict contract. The
  command must never use `ON CONFLICT ON CONSTRAINT` for this partial index.
- A resource ID is missing, foreign, deleted, inactive, forbidden, or
  unavailable from its optional provider. The command fails before any parent
  or membership write, using the stable error that applies to that condition.
- More than 100 normalized resource IDs is rejected with
  `resource_membership_limit_exceeded` before provider lookup, preserving a
  bounded request, response, and audit snapshot.
- A scalar-only edit is submitted while an optional provider is absent. The
  edit succeeds when it omits or preserves the existing reference; adding or
  changing membership, including a removal-only set, fails with
  `optional_provider_unavailable`.
- Two edits that send the same parent version. Exactly one commits; the other
  gets the standard optimistic-lock 409 and the membership set is never
  partially applied. Headerless clients retain the platform's additive behavior.
- A resource becomes inactive or deleted after membership assignment. The
  membership remains for history, but new routing/release consumers reject it;
  no replacement is selected implicitly.
- Undo or redo encounters a changed parent, a code collision, or a missing
  provider for resource IDs it introduces. It fails closed and never restores
  data in another module.
- A post-commit event, audit, index, or cache callback fails. The committed
  database mutation remains successful; the failure is logged with scoped
  technical identifiers and does not expose resource details.

## Observability

Every create, update, delete, undo, and redo records the standard audit entry
with the Work Centre identity, scoped IDs, command outcome, and before/after
snapshot required for recovery. Structured operational logs record provider
availability failures, constraint conflicts, optimistic-lock conflicts, and
post-commit callback failures using scoped technical identifiers only. P1.6
introduces no worker, queue, scheduler, or new metrics contract.

## Commands, Events, Undo, and Redo

### Commands

The CRUD route delegates to:

- `manufacturing.work_center.create`;
- `manufacturing.work_center.update`;
- `manufacturing.work_center.delete`.

Commands must:

- parse zod input and derive tenant/org from authenticated context;
- validate every new or changed optional-provider reference before mutation;
- update parent and membership atomically;
- for every update, delete, undo, and redo, call the Manufacturing lock helper
  modeled on `acquireBomGraphLock`: a tenant/org-scoped
  `pg_advisory_xact_lock` inside the write transaction. It is the selected lock
  primitive (not an unspecified row lock); re-read `updatedAt` after it and run
  `enforceCommandOptimisticLock` against that locked value before any write;
  use `enforceRecordGoneIsConflict` when an opted-in record is absent, and
  register/use `createCommandOptimisticLockGuardService` for the canonical
  command guard seam. A missing header remains the canonical additive no-op;
- use `withAtomicFlush(..., { transaction: true })` for parent and membership
  synchronization; any `runCrudCommandWrite` wrapper must preserve that same
  transaction and command side-effect contract;
- apply mutation guards, optimistic locking, audit, index and cache side
  effects through canonical helpers;
- emit side effects only after the database transaction commits;
- include the generated Work Centre entityType and explicit `cacheAliases: []`
  in execute and undo because P1.6 disables list/read caching;
- never call a scheduler, reserve capacity, move stock, or write WMS state.

The update command takes the scoped parent row lock, then loads the current
membership set in the same tenant/organization scope. Two writes that supply
the same expected version serialize at that lock; after the winner commits, the
loser re-checks the locked `updatedAt` and receives the standard 409 without a
membership write. The command applies effective scalar and set changes
atomically and bumps `updatedAt` when effective state changes. An idempotent
update does not emit a second update event. Snapshot/build-log reads are scoped
and use the platform's decryption-aware helpers even though P1.6 currently has
no encrypted fields.

Membership is replaced through the parent update command. There are no public
membership create/update/delete endpoints.

### Undo and redo

Undo payloads contain the complete parent snapshot and the sorted membership
set.

Undo and redo use the existing audit-log endpoints, not new Manufacturing
`reverse` permissions. The endpoint-level gates remain
`audit_logs.undo_self`/`audit_logs.redo_self` for the actor's own actions and
`audit_logs.undo_tenant`/`audit_logs.redo_tenant` for the tenant-wide exception.
Before any Work Centre handler changes state, it must additionally re-check
the caller's current `manufacturing.work_center.manage` grant in the target
tenant/org. Audit-log access never bypasses the Work Centre mutation feature.
The UI shows undo/redo only when both the applicable audit-log feature and
`manufacturing.work_center.manage` are effective.

Before an undo or redo changes the membership set, it compares the current and
target sets. A difference requires an available resources provider and current
`resources.view`, even when the target set is empty. A non-empty target set
validates every resulting resource ID; an empty target set performs no
resource-ID lookup. An unchanged membership set does not require the provider.

- Create undo soft-deletes an unchanged newly-created Work Centre and preserves
  its UUID for redo; it does not revalidate unchanged membership.
- Update undo restores the exact previous scalar fields and membership set only
  when the parent has not changed since the command; otherwise it returns 409.
  A changed membership set follows the provider, RBAC, and target-set rules
  above before it mutates.
- Delete undo runs in one transaction, takes the tenant/org-scoped parent row
  lock, and re-checks after the lock that the row is still exactly in the
  post-delete state recorded by the audit entry (`deletedAt`, `isActive`, and
  `updatedAt`). If it is not, it returns `optimistic_lock_conflict` before any
  mutation. Otherwise it atomically restores `deletedAt` and `isActive`, bumps
  `updatedAt`, and emits undo side effects only after commit. Membership already
  remains stored and is not revalidated. It never restores a resource in
  resources. Thus two concurrent delete-undo attempts serialize at the row
  lock and only one succeeds.
- Redo uses the command handler's `redo` path with the original log snapshot,
  not a replay that depends on a stale HTTP optimistic-lock header. It takes a
   scoped parent row lock, confirms that the record is still in exactly the
   state produced by the preceding undo, and otherwise returns
   `optimistic_lock_conflict` before writing. It reuses the original UUID and
   follows the provider, RBAC, and target-set rules above before a membership
   mutation.
- Before any undo or redo restores a historical code, whether the Work Centre
  remains active or is reactivated, it checks for another live Work Centre with
  that code in the same scope. A collision returns
  `work_center_restore_code_conflict` without mutation.
- A missing provider or `resources.view` cannot be bypassed when undo or redo
  changes membership, including a removal-only mutation.

### Events

Typed CRUD events are:

- `manufacturing.work_center.created`;
- `manufacturing.work_center.updated`;
- `manufacturing.work_center.deleted`.

Membership changes emit `updated` for the parent. No public event is defined
for the junction row. Event payload contains scoped identity and standard
command metadata, not copied resource or planner data. Events are notifications,
not the source of truth and not a replacement for the P1.7 snapshot. The
minimum payloads are:

- `created`: `tenantId`, `organizationId`, `workCenterId`, `updatedAt`;
- `updated`: the same fields plus `membershipChanged`;
- `deleted`: `tenantId`, `organizationId`, `workCenterId`, `deletedAt`,
  `updatedAt`.

No event contains `undoToken`, resource capacity, planner data, or a released
snapshot. Persistent event and guard callbacks run after commit; a post-commit
failure is logged and does not turn a committed mutation into a failed API
response.

## ACL and Security

P1.6 adds:

- `manufacturing.work_center.view`;
- `manufacturing.work_center.manage`.

`view` covers list/detail and read-only routing options. `manage` depends on
`view` and covers create, update, soft-delete and membership. `execute` and
`reverse` are not P1.6 permissions; they belong to later production-order
flows.

The module setup grants `manufacturing.work_center.view` and
`manufacturing.work_center.manage` to `admin`, and
`manufacturing.work_center.view` to `employee`; no P1.6 feature is granted to
other roles by default. Administrator access is expressed through the feature
system rather than mutable role-name checks. List/detail pages require `view`,
the create page and all write methods require `manage`, and the edit page may
be opened with `view` while hiding write affordances without `manage`. All
reads, writes, optional-provider lookups, snapshots and undo operations are
tenant/org scoped.

A user with manage but without `resources.view` may still create an unassigned
Work Centre and edit scalar fields of an accessible Work Centre without
changing its membership. They cannot use Manufacturing to list, discover, or
mutate a resource, and Manufacturing must not grant
`resources.manage_resources`. Stored `resourceIds` remain opaque membership
scalars; no resource names or state are returned without `resources.view`.
Cross-scope mutation IDs fail closed with the non-disclosing 404 contract.

The implementation must use declarative feature guards, zod validation,
canonical mutation guards, optimistic locking, localized messages, and the
platform's standard conflict response.

## Search, Indexing, and Cache

List/read cache is disabled initially, so the CRUD indexer uses the generated
Work Centre entity type with `cacheAliases: []` and no cache invalidation
contract. The setup table may use bounded search over code and name, but does
not receive CRM-scale perspectives, export, selection or bulk operations.

`search.ts` and global full-text/search-index discovery are explicitly N/A for
P1.6. The bounded setup-table filter is served by the scoped CRUD/query-engine
list contract only; adding global search is a separate, additive capability
with its own index and field-policy decision.

The Work Centre entity uses `indexer: { entityType, cacheAliases: [] }` in CRUD
side effects. Membership is not a public searchable entity. The P1.6 response
does not enrich resource state. If the UI resolves resource labels, it
batch-loads them through the authorized resources API, scopes the request, and
treats missing data as unresolved; it never becomes an authoritative copy of
resource or planner data.

## Dependencies and Sequencing

The accepted sequence is:

1. P1.0a establishes the opt-in Manufacturing package/module boundary.
2. P1.6 defines the Work Centre/resource ownership and snapshot boundary.
3. P1.5 defines optional sequential routing drafts using the P1.6 contract.
4. P1.7 uses P1.6 together with the external WMS Site contract, Catalog public
   quantity/UoM contract, and BOM/routing contracts to freeze released
   definitions.

P1.6 can proceed without Catalog quantity/UoM delivery because it is not a
   quantity-bearing path. P1.6 does not wait for WMS stock-posting contracts,
   P1.9 facts, or P1.10 production-order execution.

The future roadmap remains staged:

- Wave 0: Work Centres, simple sequential routing, BOM, release and basic
  production flow without finite scheduling;
- Wave 1: MRP, netting, pegging and material proposals, still without a machine
  scheduler;
- Wave 2: candidate `manufacturing_scheduling` capability for finite
  scheduling, planning calendars, sequences, constraints and reservations;
- later waves: MES/edge/OEE, tools, skills, QMS, costing, PLM and enterprise
  operations.

The future scheduler may consume Work Centre membership, base capacity from
`resources`, and availability from `planner`, but it must not move ownership
of those data into Work Centre.

## Testing Strategy

### Unit and command tests

- zod schemas require code/name, normalize text, and validate UUIDs;
- resourceIds are de-duplicated, capped at 100, and returned deterministically;
- a 101-ID request returns `resource_membership_limit_exceeded` before a
  provider query or write; a 100-ID request uses one scoped bounded lookup;
- a removal-only update and a partial removal both return
  `optional_provider_unavailable` without mutation when the resources provider
  is unavailable; the same membership changes return `resource_lookup_forbidden`
  without mutation when the provider is available but the caller lacks
  `resources.view`;
- with an available resources provider and `resources.view`, a removal-only
  update to an empty set succeeds atomically without a resource-ID query; a
  partial removal validates the non-empty resulting set in one scoped query;
- POST with omitted `resourceIds` and POST with `resourceIds: []` both create
  an unassigned Work Centre without provider resolution or `resources.view`;
  both representations are covered with a missing provider and without
  `resources.view`;
- Work Centre create/read/update/soft-delete works with 0, 1, and many members;
- parent and membership changes are atomic;
- code uniqueness, scope guards, inactive/deleted resource validation, and
  non-disclosing cross-tenant errors are covered;
- optimistic-lock conflicts are covered for parent update, membership update,
  delete, and guarded undo; a two-contender test proves the locked
  compare-and-write path, while a headerless request proves canonical additive
  behavior;
- two concurrent delete-undo attempts lock the same parent; exactly one restores
  it and the other returns `optimistic_lock_conflict` without a second mutation;
- undo/redo preserves the parent UUID and exact membership snapshot;
- undo and redo of an active Work Centre update both return
  `work_center_restore_code_conflict` without mutation if another live Work
  Centre now owns the historical code; every undo/redo membership mutation
  requires the provider and `resources.view`, validates a non-empty target set,
  and performs no resource-ID lookup for an empty target set;
- the exported `WorkCenterSnapshotV1` type does not contain capacity, calendar,
  planner result, or schedule;
- generated translations register exactly Work Centre `name` and `description`
  under the generated entity ID;
- typed events and audit/index side effects happen only after commit;
- no planner, scheduler, reservation, or WMS write is made by P1.6.

### API and optional-module tests

- list/detail, POST, PUT, DELETE, their declared OpenAPI success/error
  envelopes, and pageSize <= 100;
- missing resources provider allows unassigned authoring but rejects every
  changed `resourceIds` set, including removal-only and partial-removal sets,
  with `optional_provider_unavailable`; unchanged membership and scalar-only
  edits remain possible;
- missing planner leaves unassigned authoring and scalar-only CRUD operable.
  Because `resources` currently requires `planner`, a request that creates or
  changes `resourceIds`, including removal-only changes, while that dependency
  makes the resources provider unavailable returns
  `optional_provider_unavailable`;
- resource lookup proves the generated entity-ID resolution, peer feature
  authorization, explicit tenant/org query scope, inactive mapping, and the
  distinction between an absent peer, a failed provider query (mapped to
  `optional_provider_unavailable`), a missing RBAC service, wildcard grants,
  and a missing scoped record;
- ACL separates manufacturing view/manage from resources.view/manage;
- undo/redo require both the applicable audit-log feature and current
  manufacturing manage access; a removed manage grant, a changed parent after
  undo, and a redo with stale restored state all fail without mutation;
- disabled Manufacturing module leaves the host application loadable.

Integration tests must create their own scoped fixtures and clean them up. They
must not rely on seeded/demo Work Centres or resources.

### Module-enablement integration matrix

| Harness configuration | Suites | Required proof |
|---|---|---|
| Manufacturing, resources, and planner enabled | Membership create/update/remove, resource lookup, selector, and P1.5 option-read contract suites | Resources provider resolves and validates scoped active IDs. |
| Manufacturing and planner enabled; resources absent | Unassigned create, scalar-only update, list/detail, and unavailable-provider UI/API suites | Unassigned/scalar CRUD remains operable; every changed membership request returns `optional_provider_unavailable`. |
| Manufacturing enabled; planner absent | The same resources-absent suites | The harness disables `resources` as unavailable because `resources/index.ts` declares `requires: ['planner']`; it must not load a partial resources provider. |

The integration harness switches module enablement through its normal
module-activation fixture/configuration before app boot, never by mocking a
provider after boot. Each matrix row creates and cleans its own scoped data.

### UI tests

- list, create, edit, soft-delete, active/inactive and provider-unavailable
  states are covered through the real application;
- the selector calls the resources API, not a cross-module ORM entity;
- keyboard behavior, i18n, loading/error states, ACL visibility and 409 conflict
  recovery are covered;
- the stable DataTable extension host and `open`/`edit`/`delete` row-action IDs
  are generated and rendered with the declared scoped table context;
- P1.6's filtered Work Centre read contract returns only active Work Centres and
  has no scheduling or reservation side effect; P1.5 tests its own selector.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Manufacturing duplicates the `resources` master | High | Scalar IDs, explicit ownership map, current-state audit, no duplicate capacity fields without justification | Future features may still be tempted to add convenience copies |
| Planner becomes a hidden hard dependency | High | P1.6 never calls planner; unassigned CRUD works without optional providers; missing availability is not treated as universal availability | Current `resources -> planner` requirement remains a separate module boundary |
| Unverified resource ID is written | High | Scoped optional-provider lookup, ACL check, fail-closed errors and no cross-module ORM | Membership needs the provider in deployments that use resources |
| Released definitions change meaning after master-data edits | High | Immutable Work Centre/resource snapshot with source identifiers, names, versions and capture time | Snapshot schema must evolve additively |
| A resource becomes inactive after assignment | High | Preserve membership for history, show unresolved/current-state warnings where the authorized provider can resolve them, and block new routing/release use | Operator must reactivate or remove it explicitly |
| CRUD is mistaken for scheduling | Medium | Exclude capacity reservation, calendars, and finite scheduling from API/UI | Users may infer scheduling from terminology; copy and UI state must be explicit |
| Cross-tenant resource IDs leak data | High | Scope every lookup, mutation, and snapshot; fail closed | Integration coverage must remain mandatory |
| Work Centre UI grows into a generic resource admin | Medium | Keep resource ownership in `resources`; link to authorized lookup only | Additional requirements need a separate specification |
| Parent and membership writes partially commit | High | One transaction, parent optimistic lock, `withAtomicFlush`, side effects after commit | Concurrency tests must run against real PostgreSQL |
| Empty Work Centre is released by mistake | Medium | Authoring allows empty set, but P1.7 owns the explicit release gate and resource-free policy | P1.7 must not infer a release rule from P1.6 |
| Contract drift between P1.6 and P1.5/P1.7 | Medium | Cross-reference this spec and require readiness checks before adjacent specs freeze | Later design changes may require additive revisions |

## Migration & Backward Compatibility

There is no existing Manufacturing Work Centre contract or table in this
branch. P1.6 creates additively:

- `manufacturing_work_centers`;
- `manufacturing_work_center_resources`;
- entity IDs, ACL IDs, command IDs, event IDs, API route and OpenAPI;
- backend pages and i18n keys.

The migration must be module-scoped under
`packages/manufacturing/src/modules/manufacturing/migrations` and contain
only these tables, indexes and constraints. Generate and review the SQL and
the module schema snapshot; do not run `yarn db:migrate` without explicit
permission.

Required database constraints:

- scope index on `manufacturing_work_centers(tenant_id, organization_id)`;
- case-insensitive partial unique index on
  `(tenant_id, organization_id, lower(code)) WHERE deleted_at IS NULL`. Commands
  pre-check inside their scoped locked transaction and map a race-time unique
  violation to `work_center_code_conflict`; never target this index with a
  named-constraint `ON CONFLICT`. Add a SQL-shape regression test proving the
  generated write does not contain `ON CONFLICT ON CONSTRAINT` and preserves
  the partial-index predicate;
- scope/index support for membership reads;
- unique `(tenant_id, organization_id, work_center_id, resource_id)`;
- a parent FK from membership to the Manufacturing Work Centre, compatible
  with soft delete;
- no DB FK to `resources`.

The command layer must also enforce that a membership row's tenant and
organization equal its parent scope. If the migration uses a composite scoped
foreign key for that invariant, it must add the matching parent unique key;
otherwise the scoped command/repository write path is the authoritative guard
and must have a regression test. No membership row may be created through a
route that bypasses that guard.

All new API, command, event, ACL, entity and import surfaces are
stable/additive under `BACKWARD_COMPATIBILITY.md`. Optional fields may be
added, but the meaning of `resourceIds: []`, source IDs and
`WorkCenterSnapshotV1` cannot silently change. P1.6 does not change
`resources` or `planner`, especially not `resources.metadata.requires`.

## Implementation Plan

Each step must leave the application buildable and have corresponding tests.

### Phase 0 — package and readiness

1. Rebase or start from a branch that contains the accepted P1.0a implementation
   base as an ancestor. Confirm the opt-in `packages/manufacturing` package and
   `manufacturing` module, source/dist discovery, generated registries, and
   disabled-by-default behavior; PR #6 reachable only from another branch is
   not sufficient. P1.6 does not implement bootstrap work itself.
2. Confirm the existing `@open-mercato/ui` runtime dependency and peer
   dependency set; do not add `@open-mercato/core`, `resources`, or `planner`
   without a concrete P1.6 runtime import. Keep `resources` and `planner` out
   of `ModuleInfo.requires`; validate standalone package build and peer
   resolution.
3. Record the generated resources entity ID, its published view feature, and
   the exact `queryEngine.query()` field/filter projection. Prove the local
   resolver maps absent peer, forbidden caller, missing scoped record, and
   inactive record without a direct ORM import.
4. Check that no cross-module ORM relation or direct resource-entity import is
   introduced.

### Phase 1 — data model and migration

1. Add `ManufacturingWorkCenter` and `ManufacturingWorkCenterResource` with
   scope, timestamps, soft delete and parent optimistic locking.
2. Add code uniqueness, membership uniqueness, scoped indexes and parent FK;
   do not add a resources DB FK.
3. Generate and review only the intended migration and module schema snapshot.

### Phase 2 — commands, API and ACL

1. Add zod validators for create/update/list and deterministic
   `resourceIds` normalization.
2. Implement create/update/delete commands with atomic membership replacement,
   scope guards, stable errors, audit, undo and redo.
3. Add `makeCrudRoute`, OpenAPI, entity indexer, list/detail projection and
   typed CRUD events, including the declared list, success, and stable-error
   OpenAPI envelopes. Add the hand-written `GET` wrapper described in API
   Contracts and prove it makes one scoped membership batch query for the
   factory-returned page, never a per-row query.
4. Add ACL features, exact setup grants, module-root `translations.ts` for
   `name` and `description`, locale resources, and optimistic-lock conflict
   handling; synchronize grants for existing tenants with the repository's
   `auth sync-role-acls` workflow.

### Phase 3 — optional resources provider and bounded read contract

1. Implement the normative scoped resource resolver through `getEntityIds`,
   `rbacService`, and `queryEngine.query`; test missing, inactive, deleted,
   foreign, forbidden, wildcard-grant, missing-RBAC-service, and
   unavailable-provider cases.
2. Verify the active, scoped Work Centre read contract consumed later by P1.5;
   prove that reading a Work Centre performs no planner call, reservation or
   WMS write.

### Phase 4 — bounded UI

1. Add Work Centre list, create and detail/edit pages using DataTable, CrudForm,
   i18n, ACL and standard loading/error/conflict states, plus the declared
   `extension-points.ts` host, `extensionTableId`, and stable row-action IDs.
2. Add the resource selector through `/api/resources/resources` with a
   maximum page size of 100 and an explicit unavailable-provider state.
3. Add keyboard and UI integration coverage, including the no-provider case.

### Phase 5 — contract handoff and quality gate

1. Define `WorkCenterSnapshotV1` as an internal P1.7 handoff; it creates no new
   public package import. P1.6 does not serialize, persist, or test a
   released-definition/order snapshot.
2. Run `yarn generate`, package build, typecheck, lint, unit/API/integration/UI
   tests and backward-compatibility checks.

## Readiness and Exit Criteria

P1.6 is ready for implementation only when:

- PR #6 provides the accepted P1.0a/P1.4a opt-in package/module boundary;
- the `resources` vs Manufacturing ownership split is accepted;
- resource cardinality is fixed at 0..100 with no priority semantics;
- Work Centre identity, code uniqueness, and its active scoped read contract
  for later P1.5 consumption are defined;
- planner-absent and resources-provider-absent behavior is explicit;
- snapshot V1 contents and immutability are defined for P1.7/P1.10 consumers;
- API, UI, ACL, optimistic-lock, scope and stable-error contracts are written;
- all excluded scheduling and execution behavior is named;
- current-state audit findings, including `resources -> planner`, are recorded;
- generated entity IDs are confirmed after discovery and PR #6 is merged or
  rebased into the implementation base;
- integration coverage is mapped to every affected API and UI path;
- PR #6 is merged or rebased into the implementation branch, then its generated
  package/module facts and shipped `manufacturing.bom.*` conventions are
  re-verified;
- the specification passes project specification and compatibility review.

P1.6 does not authorize finite scheduling, stock-affecting execution, or a
production-order lifecycle. Those remain later workstreams with their own
contracts and gates.

## Alignment With Adjacent Manufacturing Specifications

- The product roadmap defines the ownership and dependency laws used here:
  `resources` owns reusable resources, `planner` owns calendars, Manufacturing
  owns minimal Work Centres, and scalar IDs plus snapshots cross boundaries.
- The Phase 1/Wave 0 execution plan makes P1.6 independently startable as
  specification work and places it before P1.5 routing drafts and P1.7 release
  contracts.
- The Wave 0 specification backlog names this file, requires a skeleton/code
  audit, and lists ownership, resource cardinality, snapshots, and
  planner-absent behavior as the completion outcome.
- The Manufacturing dashboard lists P1.6 as the Work Centre specification
  workstream; after this document is accepted its status should move to the
  repository's agreed readiness state.
- P1.5 must consume this contract; P1.7 may depend on the resulting Work
  Centre shape but must not pull scheduling semantics into definition release.

## Research Benchmark

The benchmark of official SAP, Oracle Fusion SCM, Microsoft Dynamics 365
Supply Chain Management, IFS Cloud, Infor LN, Business Central and Odoo
documentation confirms a shared pattern: Work Center is a production place or
group of execution resources, while calendars, capacity, costs, capabilities
and scheduling form the broader planning layer.

- [SAP S/4HANA — Work Center](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8308e6d301d54584a33cd04a9861bc52/4e366afdf7604bc9b25f39b4aff05cb2.html)
- [Oracle Fusion SCM — Work Definitions](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/overview-of-work-definitions.html)
- [Oracle Fusion SCM — Assign Resources to a Work Center](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/assign-resources-to-a-work-center.html)
- [Dynamics 365 — Operations resources](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/operations-resources)
- [Dynamics 365 — Routes and operations](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/routes-operations)
- [IFS Cloud — Work Center resources](https://docs.ifs.com/ifsclouddocs/26r1/lang/en/MfgStandard/ActivityDefineResource.htm)
- [Infor LN — Work Centers](https://docs.infor.com/ln/2026.x/en-us/lnolh/tiolh/help/ti/rou/tirou0101m000.html)
- [Business Central — Work and machine centers](https://learn.microsoft.com/en-us/dynamics365/business-central/production-how-to-set-up-work-and-machine-centers)
- [Odoo — Work centers](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/using_work_centers.html)

Open Mercato adopts the place/group boundary and multi-resource membership,
but deliberately defers capacity interpretation, calendars, priorities,
capabilities, costs and scheduling to later capabilities. This keeps P1.6
useful for real routing authoring without creating a false promise of APS/MES.

## Final Compliance Report

### Sources reviewed

- `.ai/specs/2026-08-13-manufacturing-product-roadmap.md`
- `.ai/specs/2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`
- `.ai/specs/2026-08-19-manufacturing-wave-0-specification-backlog.md`
- `docs/manufacturing/README.md`
- `docs/manufacturing/waves-and-readiness.md`
- `.ai/specs/AGENTS.md`
- `.ai/review-checklist.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx`
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`
- `.ai/docs/module-development.md`
- `packages/core/src/modules/resources/data/entities.ts`
- `packages/core/src/modules/resources/index.ts`
- `packages/core/src/modules/resources/api/resources.ts`
- `packages/core/src/modules/resources/commands/resources.ts`
- `packages/core/src/modules/resources/events.ts`
- `packages/core/src/modules/planner/data/entities.ts`
- `packages/core/src/modules/planner/index.ts`
- `packages/checkout/package.json`
- `packages/checkout/src/modules/checkout/translations.ts`
- `packages/core/src/modules/resources/extension-points.ts`
- `packages/core/src/modules/auth/services/rbacService.ts`

### Compliance matrix

| Requirement | Status | Evidence |
|---|---|---|
| One independently deployable capability | Pass | P1.6 owns Work Centre CRUD and bounded resource membership only; Site applicability and release capture remain P1.7. |
| Module boundaries and optional peers | Pass | Resource IDs cross by scalar reference and query engine; no direct ORM relation, planner call, or WMS dependency. |
| Tenant isolation and stable errors | Pass | Scope is required for parent, membership, resolver, API, undo/redo, and provider failures. |
| Concurrency and reversibility | Pass | Parent row lock plus post-lock version comparison serializes opt-in concurrent writes; undo/redo cover membership, code collisions, and provider revalidation. |
| Bounded collection and response | Pass | `resourceIds` is normalized to 0–100, uses one scoped lookup, and returns deterministic bounded IDs. |
| Canonical API and UI mechanisms | Pass | `makeCrudRoute`, commands, OpenAPI, DataTable, CrudForm, `apiCall`, optimistic-lock helpers, and i18n are required. |
| Frontend architecture | Pass | Server/client route map, file-exact ledger, 300-LOC/no-heavy-dependency budgets, no global provider, `yarn check:client-boundaries`, build evidence, and hydration tests are explicit. |
| Migration and compatibility | Pass | Additive tables, APIs, events, ACL, generated IDs, and no existing contract changes are enumerated. |
| Testability | Pass | Unit, API, two-contender lock, provider-absence, bounded-membership, self-contained integration, and UI flows are mapped. |
| Implementation-base prerequisite | Conditional | PR #6 must be merged or rebased, generated, and accepted before implementation starts; the current design branch does not satisfy this condition. |

### Consistency checks

- Ownership remains `resources` → reusable resources, `planner` → calendars,
  P1.6 → Work Centres, and P1.5 → routing applicability.
- `planner` and WMS remain optional/non-blocking for P1.6 authoring.
- P1.6 remains independent of Catalog quantity/UoM because it is non-quantity
  work.
- Snapshot semantics are historical and immutable, not a duplicate master.
- Scheduling, reservation, stock execution, and production orders remain out
  of scope.
- The file is an OSS specification and contains no enterprise-only behavior.

### Fact status

- **Confirmed in code:** `resources` entity fields, `/api/resources/resources`,
  `resources.resources.{create,update,delete}`, `resources.*` CRUD events,
  `resources.view`/`resources.manage_resources`, and
  `resources -> planner` module dependency.
- **Confirmed in documentation:** the opt-in `@open-mercato/manufacturing`
  package/module boundary.
- **Not confirmed in the current branch:** generated Manufacturing entity IDs
  and any cross-module provider service key. The implementation base is
  assumed to close P1.0a before P1.6 starts; P1.6 consumes generated entity
  facts and the generic query-engine seam rather than a provider service key.

### Verdict

**Specification is ready for implementation on the accepted prerequisite
base.** The design is consistent with the roadmap and repository boundaries:
Work Centre is a Manufacturing-owned place/group with zero-to-100 scalar
resource references, not a second resource master or a machine scheduler. The
implementation starts only once PR #6's P1.0a/P1.4a base is an ancestor of the implementation
branch, uses the documented generated-ID/query-engine resolver, and re-checks
Work Centre manage access during audit-log undo/redo. It must not change the
existing resources-to-planner module contract;
planner-independent resources remain a separate future decision.

## Changelog

- 2026-09-01: Re-verified against the open P1.0a/P1.4a prerequisite branch in
  PR #6 and corrected frozen singular Work Centre ACL and DataTable IDs, the
  explicit base spot, page and module-root client-component paths, and the
  locale-backed menu label. Replaced the impossible asynchronous
  `transformItem` membership load with a factory-wrapping batch GET, named the
  advisory-lock and command optimistic-lock helpers, made `sortField` an open
  string with stable UUID pagination, defined partial-index conflict handling
  and its SQL-shape test, removed the unjustified core dependency, omitted the
  permanently-null public `deletedAt`, and added the resources/planner
  enablement test matrix requirement.

- 2026-08-30: Closed independent implementation-readiness findings: separated
  `ModuleInfo.requires` from the required npm dependency contract, made
  `translations.ts` and generated Translation Manager coverage explicit,
  serialized delete undo with a scoped post-delete-state check, defined the
  exact RBAC resolver call and failure mapping, froze the DataTable extension
  host and row-action IDs, completed the OpenAPI envelopes, and marked global
  search as out of scope.

- 2026-08-29: Made unassigned POST semantics explicit: omitted and empty
  `resourceIds` bypass provider/RBAC resolution, while a non-empty initial set
  requires `resources`. Extended historical-code collision protection to active
  undo/redo updates and mapped provider-query failures to the stable 503 code.
- 2026-08-29: Made empty-membership removal executable: after provider
  registration and `resources.view` checks, an empty target set skips the
  resource-ID lookup and removes membership atomically. Applied the same rule
  to undo/redo and added success-path coverage.
- 2026-08-29: Resolved optional-provider ambiguity: every membership mutation,
  including removal-only or empty-resulting-set updates, requires available
  `resources` plus `resources.view`; unavailable or forbidden membership changes
  fail before mutation. Clarified that `planner` is not a P1.6 provider and
  added removal-path coverage.
- 2026-08-29: Removed the P1.6 routing-contract ambiguity. P1.6 now exposes
  only the active, scoped Work Centre read model; P1.5 exclusively owns routing
  and operation-to-Work-Centre linkage. Clarified that P1.7 snapshots every
  resource member captured for a Work Centre rather than a P1.6-selected
  resource.
- 2026-08-29: Corrected the Query Engine resolver contract to use the required
  nested `page: { page: 1, pageSize: 100 }` shape. Clarified that a missing
  planner preserves only unassigned/scalar-only Work Centre CRUD when it makes
  the resources provider unavailable, and that PR #6's P1.0a/P1.4a base must be an ancestor of the
  implementation branch rather than merely an available commit.
- 2026-08-29: Closed follow-up review findings: bounded membership at 100 IDs,
  one bounded resource lookup, file-exact frontend client ledger, and a
  rule-by-rule compliance matrix. P1.0a remains the explicit external start
  condition.
- 2026-08-29: Removed the independently deployable WMS Site integration and
  executable snapshot work from P1.6. Site applicability and capture remain
  P1.7 responsibilities; P1.6 exports only the Work Centre snapshot boundary.

- 2026-08-29: Reworked the draft into an implementation-ready specification:
  fixed 0..N resource membership, Work Center identity and uniqueness,
  optional Site scalar, exact data/API/ACL/error contracts, optimistic locking,
  transactions, undo/redo, UI, snapshot V1, test matrix, roadmap and ERP
  benchmark. Documented the current resources-to-planner dependency as a
  separate module gap.
- 2026-08-29: Review corrections removed the unconfirmed public resource-state
  enrichment, made the camelCase API response normative, specified unchanged
  optional references and idempotent updates, fixed default ACL grants and
  consumer-owned reference errors, and recorded generated/provider facts as
  implementation gates.
- 2026-08-29: Readiness review made P1.0a an explicit implementation-base
  prerequisite; defined the generated-ID, RBAC, and query-engine contract for
  optional resources and WMS Site lookups; and aligned Work Centre undo/redo
  with audit-log permissions plus a current Manufacturing manage re-check.
