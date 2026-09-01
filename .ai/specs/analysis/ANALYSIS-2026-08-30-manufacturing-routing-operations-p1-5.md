# Analysis: Manufacturing Routing and Operations (P1.5)

## Purpose and status

> **Superseded on 2026-08-30 by
> [Routing Families and Initial Draft (P1.5a)](../2026-08-30-manufacturing-routing-drafts.md),
> [Routing Operation Authoring (P1.5b)](../2026-08-30-manufacturing-routing-operations.md), and
> [Routing Operation Reordering (P1.5c)](../2026-08-30-manufacturing-routing-operation-reordering.md).**
> This document is retained as historical discovery evidence only. Where it
> differs from the specification—especially Work Centre write validation,
> revision lifecycle/selection, API/host IDs, and implementation contracts—the
> specification is authoritative.

This was the pre-specification analysis for P1.5, **draft routing and operation
authoring**. It recommended a deliberately small, reusable discrete-routing
contract for the existing `manufacturing` module. It is not the P1.5
implementation specification, does not reserve API or entity IDs, and does
not authorize implementation.

The intended result is a safe Gate A authoring capability: a technologist can
describe the ordered work required to make a product without the system
claiming that it has scheduled capacity, selected a machine, dispatched a
worker, or affected stock.

## Sources and evidence status

| Source | Status | Finding used here |
|---|---|---|
| Manufacturing product roadmap | Confirmed in repository documentation | P1.5 is an optional single-sequence routing contract; finite scheduling, planning, QMS, MES and costing are later capabilities. |
| P1.4a BOM draft specification | Confirmed in repository documentation | BOM is a standalone versioned aggregate; it must not co-own routing. A later `ProductionDefinition` references a BOM revision. |
| P1.6 Work Centre specification | Confirmed in repository documentation; later P1.5 decision supersedes the original write-gate inference | P1.5 stores at most one optional opaque Work Centre UUID. The active, scoped lookup powers the picker, but resolution is not a draft save gate and no concrete resource is selected. |
| Wave 0 backlog | Confirmed in repository documentation | P1.5a may proceed independently of P1.6 after P1.0a/shared mutation-resource support; P1.5b follows both P1.5a and P1.6, P1.5c follows P1.5b, and P1.7 consumes P1.5a/P1.5b while reorder remains optional. The current-state audit still includes `resources`/`planner` ownership, capacity/calendar data and existing scheduling/UI extension points for the operation-authoring slice. |
| Current branch code | Confirmed in codebase | `packages/manufacturing` is not present on this branch. This analysis therefore does not claim generated entity IDs, exact routes or extension spots. |
| SAP S/4HANA, Oracle Fusion, Dynamics 365 SCM and Odoo official documentation | Confirmed in vendor documentation | Mature ERP systems separate operation order, operation-specific timing/instructions and resource applicability from later capacity, scheduling, costing and shop-floor execution concerns. |

The lack of the future package on this branch is material: exact generated IDs,
route paths and UI injection spots must be discovered after P1.0a, not invented
in a P1.5 specification.

## Recommendation

P1.5 should create a **standalone, versioned routing aggregate** in the
discrete part of `manufacturing`, with one ordered list of operations per
routing revision. It should not make a routing a child of a BOM, and it should
not make a BOM line or a Work Centre the routing owner.

P1.7 should later create the executable `ProductionDefinition` by selecting
and freezing one compatible BOM revision and, when the product needs one, one
routing revision. This keeps a reusable product structure separate from the
process used to produce it, avoids routing/BOM co-ownership rejected by P1.4a,
and makes released/execution snapshots explicit.

The first release should support only a simple sequence. A routing with no
operations remains a valid draft but is not release-ready. A released
definition must decide its own completeness rule; P1.5 must not smuggle
release, Site applicability, effective dating or production-order behavior into
draft authoring.

## Recommended P1.5 scope

### Aggregate and data semantics

The full P1.5 specification should validate this proposed shape against the
actual P1.0a package conventions:

| Logical record | Responsibility | Minimum P1.5 semantics |
|---|---|---|
| Routing family | Stable reusable identity | UUID, tenant/organization scope, human-readable draft identity and lifecycle anchor. Whether a business code is required is a product decision, not an inferred platform convention. |
| Routing revision | Editable definition | Belongs to one family, is the optimistic-lock root, and preserves the ordered operations that a later release can snapshot. P1.5 creates/edits drafts only. |
| Routing operation | One required production step | Stable ID and position inside one revision; name, optional instructions, optional setup time, optional run time, and at most one `workCenterId`. |

`workCenterId` is a scalar Manufacturing ID, not an ORM relation to
`resources` or `planner`. The final specification deliberately treats it as an
optional opaque UUID in draft writes: the P1.6 active,
tenant/organization-scoped read contract supplies picker options only. Missing,
inactive, unavailable, foreign, or unauthorized lookup results must not expose
peer data and do not block an otherwise valid draft write. P1.5 never silently
substitutes another centre; P1.7 owns release-time resolution and snapshotting.

The first timing model should be declarative rather than predictive: the
author can record setup and run values for an operation, but P1.5 does not
calculate duration by quantity, capacity, efficiency, shifts or calendars.
This preserves useful authoring data while avoiding a false finite-scheduling
contract.

### User-visible behavior

- List, create, inspect, edit and soft-delete routing drafts using the
  framework's generated CRUD/API/UI conventions once P1.0a establishes them.
- Add, update, remove and reorder operations through aggregate commands so a
  revision and its ordered sequence cannot partially commit.
- Use the revision's `updatedAt` as the optimistic-lock version for edits,
  reordering and deletion. Child-operation mutations must use the parent
  revision's version, not a stale unrelated record.
- Provide a scoped active Work Centre selector without calling `planner`,
  reserving capacity or calling WMS.
- Record standard audit/undo evidence for every authoring command. Undo must
  restore the exact ordered draft state or fail closed when its optimistic-lock
  precondition no longer holds.
- Provide a bounded, documented import/export format only when the P1.5
  specification identifies a real interoperable use case and explicit limits.
  It must not delay authoring CRUD.

### Required non-goals

P1.5 must not add any of the following:

- release, approval, effectivity, Site applicability or immutable snapshots;
- a production order, work order, dispatch, confirmation, good/scrap quantity
  or WMS posting;
- calendars, shifts, availability, capacity, efficiency, utilization,
  reservation, queue calculation or promised date;
- a concrete resource, automatic resource selection, alternative Work Centre
  or resource priority;
- parallel operations, branching, overlap, split/merge, rework loops or route
  networks;
- cost categories, overhead, WIP valuation or cost-centre ownership;
- QMS inspection plans, electronic signatures, controlled documents, MES
  device/PLC behavior, offline execution, OEE, tooling or qualifications.

## Ownership and native-mechanism audit

| Requirement | Recommended mechanism and owner | Evidence / reason |
|---|---|---|
| Routing family, revision and operation data | New entities, validators, migrations, commands, API and backend UI in `manufacturing` | This is a new Manufacturing lifecycle and cannot safely be represented by configurable fields. |
| Ordered operation mutations | Domain commands with one transaction, audit and undo | Reordering and delete/change of a sequence are multi-row mutations and need one integrity boundary. |
| Work Centre reference | Scalar opaque `workCenterId` plus non-blocking scoped P1.6 picker lookup | P1.6 keeps resource identity/capacity outside the aggregate; P1.7, not P1.5 draft authoring, owns release-time resolution. |
| Resources and calendars | Optional peer input only; no duplicated data | `resources` owns reusable resource identity/base capacity; `planner` owns availability. P1.5 functions without a calendar. |
| Product, variant and UoM | No new ownership in P1.5 | `catalog` remains authoritative. Product/variant applicability, pairing and effectivity belong to the later released-definition decision unless the P1.5 full spec proves a smaller additive need. |
| Release and snapshots | P1.7 `ProductionDefinition` | P1.5 drafts remain editable; P1.7 must select and freeze compatible revisions atomically. |
| Operational execution and facts | P1.9/P1.10 and the later WMS adapter | Routing authoring cannot post stock or write a production confirmation. |

Every persistent P1.5 record must carry tenant and organization scope; all
queries and references fail closed across that boundary. New editable roots use
`updated_at`/`updatedAt`; standard mutation guards, Zod validators, localized
messages and route-level OpenAPI contracts apply. New API routes, events, ACL
features, DI keys, schema and generated-discovery artifacts are additive
contract surfaces and must be inventoried by the full specification before
implementation.

## What other systems demonstrate

| Product | Relevant pattern | Adopt now | Defer |
|---|---|---|---|
| [SAP S/4HANA](https://help.sap.com/docs/SAP_ERP/a0d3efbac8b14fc89b29bf47a1677c86/b978b6535fe6b74ce10000000a174cb4.html) | Routings contain operations, sequences, sub-operations, resources and standard values. Work-centre values later drive scheduling, capacity and costing. | Ordered operations and explicitly entered setup/run values. | Formula-driven standard values, sub-operations, PRTs, inspection characteristics, capacity and costing. |
| [Oracle Fusion](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25d/faumf/how-you-manage-standard-operations.html) | Work definitions use operations; standard operations are reusable and can be in-house or supplier operations. | Preserve the future option for reusable operation definitions without creating a library prematurely. | Standard-operation library, supplier operations and reusable resource usages. |
| [Dynamics 365 SCM](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/routes-operations) | Separates route order, operation identity, operation relation, route versions and resource requirements; supports simple routes before networks. | Versioned routing and an initial simple sequence. | Route networks, resource requirements, quantity-driven consumption/timing, activation workflow and change cases. |
| [Odoo](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/basic_setup/configure_manufacturing_product.html) | BoM operations point at Work Centres; execution, capacity and shop-floor controls are separate enabled capabilities. | Keep an operation's Work Centre reference understandable to a small manufacturer. | Alternatives, working-hours planning, OEE, work-order screens and Shop Floor behavior. |

The common lesson is not to copy a monolithic ERP model. The smallest useful
contract is process definition, ordered steps and contextual Work Centre
assignment. Capacity, cost and execution become reliable only once their own
authoritative inputs and providers exist.

## Extension map after P1.5

The following are product-capability candidates, not P1.5 commitments or
licensing decisions.

| Stage | Candidate | Why it is separate from P1.5 |
|---|---|---|
| Post-Gate A | Standard-operation library and bounded routing templates | Requires reuse, governance and copy/override rules that are not needed for one safe draft sequence. |
| Post-Gate A | Alternate routing / alternate Work Centre policy | Requires selection rationale, eligibility and release/execution snapshot semantics. |
| Release/engineering | Operation-to-BOM-line context, controlled instructions and document references | Affects immutable definition snapshots and document ownership; it must be decided with P1.7/P1.4h rather than as a P1.5 shortcut. |
| Planning | Parallel/network routes, overlaps, queue/move time, setup matrices, crews, tools and qualifications | These inputs only make sense with an explicit planning/scheduling model and ownership. |
| Scheduling | Capacity checks, calendar-aware dates, concrete resource selection, reservations and exceptions | Belong to a later `manufacturing_scheduling` capability consuming P1.5/P1.6 data. |
| Execution | Dispatch, work orders, operator steps, scan/device capture, offline buffering and OEE | Belong to P1.10 and later execution/MES capabilities, with their own safety and reconciliation contracts. |
| Quality/costing | Inspection, signatures, quality gates, cost categories, labour/machine booking, WIP and variance | Need independent QMS/traceability/costing ownership and must not mutate core routing history. |
| Supply collaboration | Supplier/external operations and subcontracting | Depends on procurement, ownership of material, lead time and WMS contracts; it is not an alternative Work Centre. |

## Risks and controls

| Risk | Control in the P1.5 specification |
|---|---|
| Draft routing is mistaken for a schedule | Use explicit product language and omit availability, reservation and promised-date fields/actions. |
| P1.5 duplicates a resource/calendar master | Store only opaque `workCenterId`; use P1.6 for non-blocking picker enrichment and do not copy capacity or calendar state. |
| Routing/BOM coupling prevents later reuse or creates ambiguous history | Keep aggregates independent; make P1.7 the sole owner of executable pairing and immutable selection. |
| A reordering write leaves a corrupted sequence | Use one command transaction, deterministic positions, revision-level optimistic locking and rollback tests. |
| Optional peers become accidental hard dependencies | Verify that authoring and draft writes work when P1.6 lookup fails or is forbidden and with no `resources`/`planner` provider. |
| Future extensions reinterpret historical work | P1.7/P1.10 snapshot the selected routing revision; extensions publish proposals or additive evidence rather than alter core history. |

## Historical open questions resolved by the P1.5 specification

These questions are retained to show the discovery path; they are no longer
open. The superseding specification requires code and name, allows an optional
opaque Work Centre UUID in drafts, keeps routing independent from Catalog/BOM
until P1.7, uses simple minute durations, and defers import/export.

1. Is a routing family required to carry a human code, a name, or both; and
   what is the scoped uniqueness rule?
2. Can an operation have no Work Centre in a draft, and what exact condition
   makes a routing release-ready in P1.7?
3. Does P1.5 associate a draft routing with a Catalog product/variant now, or
   does P1.7 exclusively pair independently reusable BOM and routing revisions?
   The recommended default is the latter because it has the smaller immediate
   contract surface.
4. Are setup/run values represented as simple durations only in Gate A, or is a
   quantity basis required by a validated first-customer use case? The
   recommended default is simple durations only.
5. Is bounded routing import/export needed in the first shippable slice, or
   should it follow validated interoperability demand?

## Required pre-specification audit

Before writing the P1.5 skeleton/full specification, inspect the actual
post-P1.0a module tree and generated facts for:

1. module discovery, public entrypoints and generated entity IDs;
2. the P1.6 Work Centre API, active selector, ACL and optional-provider
   behavior;
3. canonical aggregate-command, undo, nested child mutation and optimistic-lock
   patterns from the closest established module;
4. API/OpenAPI, CrudForm/DataTable, backend page and i18n patterns;
5. `resources`/`planner` module metadata and disabled-module coverage;
6. every affected backward-compatibility surface and the self-contained
   integration suite for list/create/edit/reorder/delete, scope, conflict,
   provider absence and undo.

## Conclusion

P1.5 should make production technology explicit, not make production planning
implicit. A versioned sequential routing with operation instructions, simple
times and an optional Work Centre is sufficient and useful in OSS Gate A. Its
value is a trustworthy definition that P1.7 can release and P1.10 can later
execute; advanced optimisation, execution depth, compliance and cost analysis
remain independent capabilities over that stable record.
