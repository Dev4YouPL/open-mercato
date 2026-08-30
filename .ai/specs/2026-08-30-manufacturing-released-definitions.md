# Manufacturing P1.7 — Released Definitions and Immutable Snapshots

## TLDR

P1.7 adds the Wave 0 publication boundary between mutable Manufacturing drafts and later production-order execution. An authorized user validates one explicit top-level BOM draft, every explicit ambiguous-child choice and an optional compatible sequential routing revision, then atomically publishes one Site- and date-applicable immutable production-definition snapshot. The candidate hash binds the complete server-resolved occurrence and source-version selection without echoing an unbounded graph in the release request. Selected drafts are frozen and copied into their next editable draft revisions; already released child revisions are reused without mutation.

This document is the single OSS source for the P1.7 business outcome, actors, requirements, acceptance criteria, scope boundary, market rationale and technical implementation contract.

## Overview

P1.7 is one publication capability: stateless readiness, hash-bound atomic release, immutable evidence, deterministic resolution and the minimum read/UI surfaces needed to operate and audit that boundary. Freezing selected drafts and creating their next editable revisions are not a separate user-facing workflow; they are mandatory postconditions of the same release command and reuse the revision allocators owned by the prerequisite BOM and Routing aggregates. If prerequisite discovery shows that either aggregate cannot participate in the same transaction through a public Manufacturing service contract, implementation stops and the lifecycle contract is specified separately rather than reimplemented inside P1.7.

## Document Role and Prerequisites

Implementation starts only after compatible P1.0a, P1.4a, P1.5a/P1.5b, P1.6, Catalog quantity/UoM, external WMS Site, P1.14 bounded portability, the accepted attachment-reference contract and a correction/withdrawal capability are present and generated discovery facts confirm their public IDs. P1.14 and the attachment contract are Gate B sequencing prerequisites recorded by the roadmap, backlog and execution plan; P1.7 does not own their import/export APIs, file content or document lifecycle. P1.7 persists only attachment identity/version evidence defined by the owning contract. The release capability gate fails closed until every named prerequisite registers its accepted public contract; procedural risk acceptance is not a substitute for a missing executable correction path.

Exact filenames, DI keys and generated identifiers remain provisional until that audit. The [Manufacturing product roadmap](2026-08-13-manufacturing-product-roadmap.md), [Wave 0 execution plan](2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md) and [Wave 0 specification backlog](2026-08-19-manufacturing-wave-0-specification-backlog.md) remain authoritative for portfolio scope and sequencing.

### Implementation readiness status

This specification is **conditionally approved as a design, but is not yet implementation-ready**. Step 1 must replace every provisional dependency name with code- or generated-fact evidence and record the exact public contract for Catalog quantity/UoM, WMS Site eligibility plus the complete Site/warehouse-role snapshot and lock, Work Centre and resource eligibility, routing output target, BOM graph locking, BOM/Routing transaction-aware release-and-copy, source lifecycle migration, correction/withdrawal disposition/applicability, multi-resource mutation-guard execution and the CommandBus input/result-integrity seam. A missing contract is resolved in its owning prerequisite specification; it is not invented inside P1.7. The discovery record must also confirm the attachment-reference decision required by the Gate B plan.

After those technical contracts are confirmed, implementation may build and test the capability. The DI-resolved `productionDefinitionReleaseGate` defaults closed and enables readiness/release only when every Gate B provider and the correction/withdrawal provider report an accepted compatible contract for the trusted tenant/organization scope. Request bodies, environment variables and UI state cannot override it. Technical completion still requires P1.7 acceptance criteria and validation; technical completion alone is not production enablement.

## Problem Statement

Mutable BOM and routing drafts are not safe execution evidence. P1.7 must establish one deterministic publication boundary that prevents live master-data reinterpretation, ambiguous applicability, graph cycles, mixed-version structures and partial snapshot publication while preserving exact component occurrence identity.

## Actors and Outcomes

| Actor | Required outcome |
|---|---|
| Manufacturing engineer or master-data manager | Select a top-level BOM draft, optional routing revision, Site and validity window, review the exact recursive revision selection and release the definition. |
| Production planner | Resolve exactly one released definition for an output product or variant, Site and planned start date. |
| Auditor or support operator | Inspect what was released, from which source revisions, by whom and when. |

## Business Requirements

### BR-1 — Explicit and complete release input

The user explicitly selects one top-level BOM draft, an optional compatible sequential routing revision, a Site, a validity window and an override for every occurrence whose child family has multiple eligible revisions. Readiness deterministically expands every `produce` occurrence and binds the complete ordered occurrence/source selection into `candidateHash` and `selectedResourceDigest`. The compact release request resubmits the readiness input, explicit overrides and both commitments; the server reconstructs the complete candidate inside the transaction and rejects any different child, BOM revision, routing revision or source token.

### BR-2 — Deterministic applicability

A released definition applies by tenant, organization, exact output target (product fallback or validated variant), Site and business-effective date. Wave 0 requires a finite interval: `validFrom` is inclusive and `validTo` is required and exclusive. Intervals may not overlap within the same exact-target tier. A variant-specific tier and its product-fallback tier may both contain a matching interval; the resolver evaluates the variant tier first and consults product fallback only when the variant tier has no match. Zero or multiple matches in the selected tier fail closed.

### BR-3 — Complete immutable evidence and authoring continuity

Release binds the selected top-level BOM, every recursively selected child BOM revision, the optional routing and the complete WMS Site/warehouse-role eligibility evidence into one occurrence-preserving snapshot, freezing only sources that are still drafts. Duplicate component occurrences remain distinct and keep their full paths. Later changes to drafts, Site assignments, default warehouses or referenced master data do not reinterpret the snapshot.

An already released BOM revision may be reused by any number of parent definitions. A draft selected anywhere in the candidate is frozen once. Freezing a selected BOM or routing draft atomically creates its next editable draft revision by copying the released source content with new identities. Creating that draft is authoring continuity, not supersession: it has no applicability and does not alter any released definition.

### BR-4 — Readiness before publication

Release is rejected when the capability gate is closed or the candidate contains a cycle, unresolved manufactured child, invalid tenant or organization scope, invalid Catalog/UoM evidence, an ineligible Site or Site warehouse-role assignment, an inactive/deleted Work Centre, a Work Centre with no eligible resource membership, incompatible selected revisions, exceeded release bounds or overlapping applicability.

A routing is compatible only when its tenant, organization and exact output product/variant target equal the top-level BOM target and its status is eligible for release or reuse. Wave 0 treats Work Centres as organization-scoped and Site-independent because P1.6 defines no Site relation: every referenced Work Centre must be active, non-deleted, same-scope and contribute at least one active same-scope resource to `WorkCenterSnapshotV1`. Site eligibility is independently determined by the WMS-owned active Site plus its complete current warehouse-role/default assignment snapshot. Product-level and variant-specific targets are not interchangeable for this explicit BOM–routing pairing.

### BR-5 — Atomic and idempotent publication

Users never observe a partial release. The complete released definition, immutable evidence and next editable copies commit together or no release state is published. Retrying the same release request does not create duplicate revisions or snapshots.

The released event is a standard persistent best-effort integration signal emitted after commit. Its enqueue is not part of the database publication transaction: a process failure between commit and enqueue may omit the event. Authoritative consumers must use consumer-owned polling or read comparison until the platform provides a transactional event-outbox contract; P1.7 adds no reconciliation job.

### BR-6 — Released definition access

Authorized users can list released definitions, inspect a released revision and its bounded snapshot pages, run readiness and release a candidate. Later production-order work can resolve one immutable definition reference and content hash.

### BR-7 — Minimal auditability

The immutable release header records the actor, release time, selected source revisions and every consumed peer version, applicability and immutable content identity. Those fields are authoritative evidence in the same publication transaction. The platform command/action log is an additional audit surface; if its post-handler write fails, the committed release remains readable and a structured recovery signal is recorded. Events, logs and errors do not copy full instructions, secrets or unrelated sensitive data.

## Acceptance Criteria

1. A valid candidate releases one immutable definition that resolves for its business key.
2. Repeating the same release request idempotently does not create duplicate revisions or snapshots.
3. A cycle, unresolved manufactured child, invalid peer reference, exceeded bound or applicability overlap prevents every release write.
4. Two simultaneous releases cannot both publish overlapping executable windows for the same applicability key; a record-lock or mutation guard on any selected draft blocks the release before mutation, and no CommandBus interceptor can transform the guard-approved input or authoritative result.
5. Editing source BOM, routing, Catalog, Site, Site warehouse-role/default assignments or Work Centre data after release does not change the released view or content hash.
6. Duplicate component occurrences remain separately visible through their occurrence paths.
7. A released definition cannot be edited or deleted in Wave 0.
8. Every affected API and key UI path has self-contained integration coverage for success, isolation, conflict, rollback and recovery.
9. Changing any selected draft during recursive release is either included before candidate locking or causes a stale-candidate failure; a mixed-version snapshot is impossible.
10. Readiness exposes the exact selected revision for every occurrence through bounded preview pages; release reconstructs the selection and rejects any candidate hash or resource digest changed by an omitted, added, reordered or substituted selection.
11. Reusing an already released child revision does not mutate it or require a new child draft, while freezing a selected draft creates one next editable draft for its family in the same transaction.
12. An incompatible BOM/routing pair, an ineligible Site or changed warehouse-role/default assignment, a Work Centre with empty or ineligible resource membership, or a guarded/locked selected resource is rejected without freezing any source.
13. A committed release remains authoritative if post-commit event enqueue fails, and consumer-owned polling or read comparison can discover it through released reads.
14. A mutable peer unable to join the shared transaction, an isolation/serialization failure or a stale discriminated source-version token rejects release without any source freeze or immutable snapshot write.
15. Two concurrent releases for the same family on different non-overlapping Sites create one family and distinct serialized revision numbers; two overlapping releases for the same target/Site produce exactly one committed result.
16. The same unchanged readiness input always produces the same `candidateHash` across repeated runs and the published golden vectors; `capturedAt` is excluded from that projection. One transaction-assigned `releasedAt` is reused as final snapshot `capturedAt`, and any changed path, ordering, decimal or source token changes the appropriate hash.
17. The production release surface is disabled unless `productionDefinitionReleaseGate` confirms every Gate B provider and a compatible correction/withdrawal provider; no request or environment override can bypass the gate, and point resolution/overlap checks consume that provider's scoped executable-disposition view.

## Technical Scope

### Required surface

- Stateless readiness for one explicit top-level BOM draft, optional compatible routing revision, Site and validity window, with bounded selection-preview pages rather than an unbounded response or release request.
- Recursive variant-first/product-fallback child-family resolution followed by explicit occurrence-to-revision selection.
- Release-time cycle, scope, Catalog/UoM, WMS Site/warehouse-role/default, Work Centre/resource-membership, per-resource mutation-guard, unresolved-child, bound and overlap validation.
- Atomic freezing of selected BOM/routing drafts, creation of their next editable drafts and creation of one normalized immutable definition snapshot.
- Stable definition family identity for one output product or validated variant.
- Finite Site/date applicability with `validFrom` inclusive and required `validTo` exclusive.
- Idempotent release and optimistic candidate validation.
- Immutable source-version manifest for all peer evidence consumed by the snapshot, using discriminated version tokens rather than assuming every provider exposes a timestamp.
- Serialized applicability and definition-family concurrency with a documented lock/constraint strategy.
- Released list, detail, paged snapshot and deterministic resolve reads.
- Fail-closed DI release-capability gate, minimal release UI, OpenAPI, typed released event, i18n and self-contained integration tests.

### Explicitly deferred

- Persisted production-definition drafts and their CRUD.
- Successor relationships, supersession, open-ended effectivity and release undo. The mechanical next editable draft created from a frozen source is included and has no applicability or predecessor semantics. Correction/withdrawal is implemented by its prerequisite owner and consumed only through the release-capability gate; P1.7 does not duplicate that lifecycle.
- Downstream reference claims and P1.10-owned integration glue.
- Manufacturing-specific outbox, dispatcher, automated reconciliation job and dead-letter infrastructure. Consumer-owned polling or read comparison remains available for failure recovery.
- Production-order release, execution snapshots, reservations, stock effects and confirmations.
- Approval workflows, engineering changes, signatures, deviations and other governance.
- BOM history/comments, comparison/where-used, copy-to-new-target and full document control. P1.7 persists only stable attachment-reference identity/version evidence when the Gate B owner contract is available; it never owns file content, retention or attachment lifecycle.
- Quantity-range alternatives, priorities, substitutes, alternate routings and phantom flattening.
- Unit/serial effectivity, configuration rules and order-specific overlays.
- Bulk release, search, cache, import/export and queued mass processing.
- MRP, costing, scheduling, MES, quality inspection and shop-floor execution.

## Proposed Solution

Release is an aggregate command over existing BOM and routing revisions. It derives the output target from the top-level BOM, finds or creates its stable `ProductionDefinition` family, validates the complete candidate under shared graph, WMS Site and applicability locks, freezes selected draft sources, reuses selected released sources and writes one immutable `ProductionDefinitionRevision` with normalized snapshot rows.

There is no separately persisted production-definition draft or readiness record. Readiness starts from the requested top-level draft, resolves each `produce` occurrence to one variant-first/product-fallback child family and exposes the exact selected revision through bounded preview pages. The client resubmits only the original readiness input, every explicit ambiguous-child override, `candidateHash` and `selectedResourceDigest`. Readiness performs no writes; release reconstructs and revalidates the complete candidate inside its transaction and never trusts readiness as authoritative state. This compact commitment keeps the request below 256 KiB even when the server-side graph reaches its supported bounds.

For each resolved child family, the eligible set contains its active draft, when present, plus its released revisions. An occurrence override selects one member of that family explicitly. Without an override, readiness selects the only eligible revision; zero eligible revisions returns `definition_unresolved_child`, while two or more return `definition_child_revision_selection_required`. It never chooses a latest revision. The same released revision can appear at multiple occurrence paths and in multiple parent definitions. Every occurrence remains explicit even when several occurrences reference the same revision.

When release selects a draft revision, that revision becomes released and an exact editable copy with new revision and line/operation identities is created as the family's sole active draft in the same transaction. This applies to top-level and child BOM drafts and to the optional routing draft. It preserves authoring continuity but creates no successor edge, applicability or supersession behavior. A selected already released revision is read-only and is not copied again.

A later definition for the same output and Site may use another finite, non-overlapping validity window. Adjacent intervals are allowed but have no successor semantics. Wave 0 does not automatically shorten, supersede, withdraw, edit or delete a released revision.

### Alternatives rejected

| Alternative | Decision |
|---|---|
| Persist a separate definition draft before release | Rejected for Wave 0: existing drafts and the release payload contain all required candidate state. |
| Resolve live child BOMs when an order is released | Rejected: historical meaning would change with mutable master data. |
| Store only one large JSON snapshot | Rejected: bounded reads and integrity constraints require normalized immutable rows. |
| Add successor and withdrawal lifecycle now | Deferred: not required to publish or consume the first immutable definition. |

## Market and Product Rationale

P1.7 adopts the common manufacturing pattern of binding a concrete material structure and routing/process version to an effective production definition, while keeping released evidence immutable and creating a new editable revision for later changes:

- SAP S/4HANA production versions bind a BOM and routing and use validity to determine the production technique; this supports explicit pairing rather than an implicit latest-record lookup.
- Oracle Fusion work definitions use effective versions and require a new version for structural changes once a version is effective.
- Microsoft Dynamics 365 engineering versions keep BOM, route and effectivity together and can enforce non-overlapping effectivity.
- IFS Cloud exposes explicit structure/routing revision selection and copying a structure into a new revision.
- Infor LN production BOMs use revision status plus effective/expiry dates, while Infor CSI preserves the current BOM/routing in history and copies it into a new current revision.

Wave 0 takes only the shared minimum: explicit revision identity, finite non-overlapping Site/date applicability, immutable released evidence and a new editable draft after freezing. It intentionally excludes alternative priority, lot-size selection, engineering-change approval, withdrawal, automatic predecessor closing and order-specific overrides.

Official references reviewed on 2026-08-30:

- [SAP S/4HANA — Selecting a Bill of Material Alternative](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/34de0103497c4b80a7c7fbf6952ff971/c701b753128eb44ce10000000a174cb4.html)
- [Oracle Fusion Cloud SCM — How You Manage Work Definition Versions](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/faumf/how-you-manage-work-definition-versions.html)
- [Microsoft Dynamics 365 — Engineering versions and engineering product categories](https://learn.microsoft.com/en-us/dynamics365/supply-chain/engineering-change-management/engineering-versions-product-category)
- [IFS Cloud — Copy Structure Revision](https://docs.ifs.com/ifsclouddocs/24r1/lang/en/MfgStandard/ActivityCopyStructureRevision.htm)
- [Infor LN — Production Bills of Material](https://docs.infor.com/ln/2026.x/en-us/lnolh/tiolh/help/ti/mfc/timfc3100m000.html)
- [Infor CSI — Change Item Revision](https://docs.infor.com/csi/10.x/en-us/csbiolh/mergedprojects/sl_invprod/forms/ecntopic/change_item_revision.html)

## Architecture

### Ownership

| Concern | Owner and mechanism |
|---|---|
| Release lifecycle and snapshot | OSS `manufacturing` command and entities |
| Catalog identity and UoM | Scoped public Catalog reader; scalar IDs plus immutable quantity/display evidence |
| Site eligibility | Prerequisite scoped public WMS reader and owner serialization points shared by Site/assignment/warehouse mutations; scalar Site/warehouse IDs plus immutable role/default/display/version evidence |
| Work Centre eligibility | P1.6 scoped Manufacturing reader; organization-scoped and Site-independent in Wave 0; scalar IDs plus immutable display/resource evidence |
| Release enablement | P1.7 DI service `productionDefinitionReleaseGate`; default closed and satisfied only by compatible prerequisite providers |
| Audit and operation discovery | Standard CommandBus and platform audit mechanism |
| Released event | Standard typed persistent event mechanism; no feature-specific dispatcher |
| UI | Server-first released list/detail and one guarded release dialog |

Manufacturing owns the orchestration and all new definition/snapshot rows. BOM and Routing retain ownership of their source aggregates and expose DI-resolved, transaction-aware release-and-copy operations that reuse their revision allocators; P1.7 must not import their entity internals or duplicate their copy logic. Catalog, Site and Work Centre evidence is read through scoped DI ports. Optional or externally installed peers are resolved with a local `tryResolve`-style helper: Manufacturing remains loadable without them, historical reads continue from snapshots, and the capability gate/readiness/release fails with a stable unavailable reason. No direct cross-module ORM relation is introduced; peer references are scalar IDs plus immutable evidence.

`productionDefinitionReleaseGate.evaluate({ tenantId, organizationId })` returns either `{ enabled: true }` or `{ enabled: false, reasons: ProductionDefinitionReleaseGateReason[] }`, where reasons are a closed non-sensitive registry. P1.7 registers the default-closed implementation. Each prerequisite remains owner of its compatibility/version decision and contributes only through a confirmed public provider contract; request data, ad hoc environment flags and UI checks never mark a prerequisite ready. `GET /api/manufacturing/production-definitions/release-capability` exposes the safe gate result for UI, while the readiness and release routes independently re-evaluate it as the authoritative check.

### Contract freeze required before implementation

Step 1 must attach owner-spec or generated-fact evidence for each contract below. These are required shapes, not permission to invent private adapters in P1.7:

- The routing revision reader returns trusted tenant/organization scope, `outputProductId`, nullable `outputVariantId`, status, `updatedAt`, ordered operations and Work Centre IDs. P1.5a/P1.5b must add and own the target linkage before P1.7 can accept a routing revision.
- The WMS owner-spec update publishes a reader that accepts the trusted scope, Site ID and shared transaction, acquires the WMS Site serialization key followed by deterministic assignment/warehouse row or advisory locks, and returns a complete `SiteEligibilitySnapshotV1`: Site ID/code/name/active state/version plus every live warehouse-role assignment used by release with assignment ID, fixed role, default flag, warehouse ID/code/name/active state and discriminated source-version tokens. The same serialization points must be used by Site lifecycle, assignment/default writes and warehouse activation/deactivation. The reader verifies the required `raw_material` and `finished_goods` defaults and holds the locks through publication commit. The current WMS contract does not yet publish this reader or serialize warehouse-active mutations, so its owner-spec/code work is an explicit prerequisite; a Site timestamp alone is insufficient because mapping writes do not advance `Site.updated_at`.
- The Work Centre reader returns the exact complete P1.6 `WorkCenterSnapshotV1`, including its `workCenter.updatedAt` and every `resources[].updatedAt`, under the same scope and transaction/lock boundary. P1.7 maps those timestamps to `{ versionKind: 'updated_at', versionToken }` entries in its source manifest without changing or relabelling the V1 DTO; any different owner shape requires a new owner-versioned snapshot contract. Wave 0 deliberately defines no Site-to-Work-Centre eligibility relation: same-organization active Work Centres are Site-independent. The owner contract must state whether the release caller needs `manufacturing.work_centers.view` and `resources.view`, or whether a narrowly scoped internal reader performs the read without bypassing tenant, organization or deletion checks.
- BOM and Routing expose an operation equivalent to `releaseAndCreateNextDraft({ revisionId, expectedUpdatedAt, transaction })`, returning the released identity and newly allocated draft identity. The operation owns status constraints, allocator locking, child identity copying and source-level update/delete/undo rejection after release.
- The mutation-guard contract accepts an explicit `(resourceKind, resourceId, operation, headers, payload)` context for each resource. P1.7 may invoke the existing registry once per resource only through a public helper that preserves guard status/body, transformations and callbacks; it may not forge headers or use a root guard for a child.
- Catalog, Site/assignment/warehouse, Work Centre, resource and attachment-reference readers expose discriminated stable source versions as `{ versionKind: 'updated_at' | 'immutable_revision' | 'opaque', versionToken: string }`. Every mutable row consumed by release must be read and locked through the shared transaction until commit. A peer that cannot join the shared transaction blocks release; a version assertion or advisory timestamp without a lock held through local commit is insufficient. A truly immutable versioned reference may use `immutable_revision` without a mutable-row lock when its owner contract guarantees that identity/version content can never change.
- The correction/withdrawal owner exposes a compatible scoped provider with: a safe UI action target; a durable disposition that can make a released revision non-executable without deleting or rewriting its snapshot; and a transaction-aware applicability view consumed by release overlap validation and point resolution. Its compatibility marker is consumed by `productionDefinitionReleaseGate`; absence or incompatibility keeps the release capability closed. The provider owns correction authorization, writes and history, while P1.7 only consumes the disposition/applicability contract through public scoped APIs.

### BOM and Routing Compatibility

The optional routing revision must have the same trusted tenant and organization scope and the exact same output product/variant target as the top-level BOM. A product-level routing cannot be paired with a variant-specific BOM, or vice versa. This target linkage is an explicit P1.5 owner-contract prerequisite; P1.7 must not infer it from operation or display data. The routing must be the sole active draft of its family or an explicitly selected released revision and use the accepted sequential P1.5 operation model. Each referenced Work Centre must resolve an active, non-deleted, same-organization `WorkCenterSnapshotV1` handoff with at least one active same-scope resource; an empty resource array is not release-eligible in Wave 0. Site eligibility is evaluated separately from the WMS `SiteEligibilitySnapshotV1`; P1.7 does not invent a Site-to-Work-Centre relationship. Any mismatch rejects readiness and release without freezing either aggregate.

No cross-module ORM relationship is introduced. Peer references are resolved through public scoped services and stored as scalar IDs with only the bounded immutable evidence required to understand historical content.

### Release Transaction

1. Resolve trusted tenant and organization scope, reject body/path scope overrides, validate the compact request and recheck both release and view authorization.
2. Compute the canonical semantic request hash from the compact request. If the same scoped idempotency key already has a completed identical result, return it with `replayed: true` after authorization without evaluating the current release gate or running mutation guards, CommandBus, callbacks or another event attempt. A different hash returns `idempotency_key_reused`. This ordering recovers an authoritative committed response even if a prerequisite becomes unavailable after commit.
3. Evaluate `productionDefinitionReleaseGate`. A closed gate returns the stable unavailable response before candidate work and blocks only new publication.
4. Reconstruct the bounded candidate read-only to derive every distinct draft that would be mutated. In deterministic `(resourceType, UUID)` order, run the complete registered mutation-guard set, including the legacy bridge, once per draft with the owner-published resource identity, `operation: 'update'`, that resource's version headers and the full compact release payload. Chain transformations and parse the complete release schema after each one. Any transformation of readiness-bound semantics fails as `release_guard_payload_changed`; collect callbacks but do not run them yet.
5. Dispatch `manufacturing.production_definition.release` through CommandBus using the prerequisite public command-integrity seam for this command. Deliberate interceptor rejection preserves its validated 4xx status/body. Any pre-handler `modifiedInput` is rejected as `release_command_payload_changed` before the handler can commit, so interceptors cannot silently change Site, sources, effectivity or commitments after resource guards approve them. A post-handler result transformation is too late to become a 4xx: the seam discards it, records `command_result_transform_ignored` and returns the authoritative result stored by the handler/idempotency row.
6. The handler begins one `REPEATABLE READ` publication transaction on the scoped `EntityManager` and claims idempotency with a scoped unique insert. A concurrent identical request waits and replays the committed result; a different request fails; a rolled-back transaction leaves no claim.
7. From the read-only candidate's distinct resource identities, call each public owner `lockAndRead`/equivalent exactly once at its position in one fixed global order: organization BOM graph key; WMS Site key; WMS assignment and warehouse keys; BOM/routing source rows; Catalog product/variant/UoM rows; attachment-reference rows; Work Centre rows; resource-membership/resource rows; definition-family key; applicability base key. Within each class, sort by the owner's canonical physical key and then lower-case UUID; each owner mutation path must use the same published serialization point. No provider reacquires an already-held key and no later step acquires a missing peer lock or an earlier class. If locked reconstruction discovers an identity absent from the pre-lock set, abort stale instead of locking it out of order.
8. Reconstruct the graph from those locked owner results, validate the submitted explicit child overrides and identify the complete occurrence selection. Verify every draft version token after locking; guard success never substitutes for database locking or per-resource optimistic validation.
9. Validate Catalog/UoM and immutable attachment evidence, capture `SiteEligibilitySnapshotV1`, and capture every active same-scope `WorkCenterSnapshotV1` with non-empty active resource membership from the already locked owner results. Every mutable peer row remains locked in the shared transaction through commit. A provider that offers only an unlocked read, acquires locks outside its assigned position or performs a one-time version assertion blocks release.
10. Recompute `candidateHash` and `selectedResourceDigest` from the complete locked candidate and compare both with readiness. The digest includes Catalog, UoM, Site, Site assignment, warehouse, BOM, Routing, Work Centre, resource and attachment-reference tokens. Any mismatch returns `release_candidate_stale`.
11. Under the already acquired definition-family key, find or create the stable family and serialize family creation plus revision allocation. The family key is not reacquired later; the later applicability check uses its already-held base-key lock.
12. Under the already acquired applicability base-key lock `(tenant, organization, exact output target, Site)`, read the correction provider's transaction-aware disposition/applicability view and reject any overlapping executable released interval. The date is part of the lookup key but not the concurrency key. A supported database/provider combination must provide an exclusion/range constraint that models executable disposition or an equivalent serialized overlap strategy; no best-effort fallback exists.
13. Allocate one transaction timestamp and use it as both `releasedAt` and every final snapshot `capturedAt`. Mark each distinct selected draft released once, preserve its immutable revision number, and call the prerequisite allocator/copy operation to create the next editable draft with new child identities. Selected already released revisions are not mutated or copied.
14. Write the immutable definition revision, normalized BOM/routing/Site/warehouse/Work Centre/resource snapshot rows, source-version manifest and completed idempotency result. Commit all authoritative rows together.
15. CommandBus `buildLog` returns `skipLog: true` for an idempotent handler replay and attempts one non-undoable action-log entry for a newly committed release. The handler declares `isUndoable: false`, never supplies `undoToken`, and carries only bounded safe audit metadata. After `CommandBus.execute` succeeds, the route runs the collected per-resource guard callbacks and attempts `manufacturing.production_definition.released` with `{ persistent: true }`; callback and enqueue errors are caught, structurally logged and do not replace the committed success response. If CommandBus throws after the handler may have committed, the route queries the scoped idempotency row by key and semantic hash. No completed row means normal error propagation. A completed row proves only the domain commit: return its stored result, record `command_post_commit_pipeline_failed`, and run the still-pending callbacks/event attempt. This does not resume or claim completion of action-log, after-interceptor, cache-invalidation or other CommandBus tail effects; those may be omitted and require platform operational repair.

Steps 7, 9 and 13 call prerequisite public transaction-aware operations on the same scoped `EntityManager`; P1.7 never writes BOM, Routing, WMS or peer tables directly. Step 4 reuses the public multi-resource mutation-guard composition contract, and step 5 reuses a public CommandBus integrity seam that rejects pre-handler input transformation, discards/logs post-handler result transformation and preserves deliberate interceptor rejections. Absence of either helper, or of a shared-transaction reader/lock for any mutable evidence, blocks implementation rather than moving platform/owner infrastructure into P1.7 or falling back to compare-and-lock. The complete lock order and post-commit recovery branches require two-contender and injected-failure tests.

The database transaction is the publication boundary. A failure before commit exposes no released definition. Persistent subscribers retry after successful enqueue, but there is no transactional database-to-event outbox: process death between commit and enqueue can omit the event. Authoritative consumers use polling or read comparison rather than treating event absence as proof that no definition exists; P1.7 adds no dispatcher or reconciliation job.

### Applicability

The stored applicability key is:

`tenantId + organizationId + exactOutputTarget(productId, variantId|null) + siteId + businessEffectiveDate`

The resolver key above is distinct from the write-lock key. The applicability write-lock key is `tenantId + organizationId + exactOutputTarget(productId, variantId|null) + siteId`, because an interval overlap can involve any date in that base key. Every release acquires that key before reading executable released intervals through the correction provider's transaction-aware applicability view and holds it through commit. The supported database/provider combination must serialize this lock and enforce the same invariant with an exclusion/range constraint that models executable disposition or an equivalent transaction-local serialized query; a non-serialized preflight check is not a valid fallback.

For a request with `outputVariantId`, Catalog first validates that the variant belongs to `outputProductId`. The resolver then searches executable definitions in the correction provider's scoped disposition view at the exact variant tier. Exactly one match wins; multiple matches are an integrity failure. Only when that tier has zero matches does it search the product-fallback tier, which likewise must return exactly one or fail with zero/ambiguous resolution. A request without a variant searches only the product tier. Dates are ISO `YYYY-MM-DD` database `date` values. `validFrom` is inclusive and required `validTo` is exclusive. Open-ended effectivity is deferred. An adjacent future interval is permitted, but adjacency creates no relationship and is not required.

Wave 0 accepts only stored non-overlapping intervals per exact output target and Site. Product and variant tiers may overlap because precedence is explicit. It does not derive an effective upper bound from another revision and does not reinterpret existing intervals.

Because P1.7 itself cannot delete, mutate or withdraw a released window, an operator mistake must first go through the prerequisite correction/withdrawal flow. That provider preserves the immutable snapshot while changing executable disposition through its own authorized history; only its transaction-aware applicability view may then permit a replacement release for the corrected dates. The release dialog states this limitation and links to that flow. `productionDefinitionReleaseGate` remains closed until the executable provider is present; raw data correction and procedural risk acceptance are not valid enablement paths.

### Consistency and lock contract

The publication transaction uses `REPEATABLE READ` plus explicit owner-defined row/advisory locks for every mutable row that contributes evidence. Every mutable peer reader must share the Manufacturing `EntityManager` and hold its lock through publication commit. A one-time version assertion is insufficient because the peer can change between assertion and local commit. Truly immutable version identities need no mutable-row lock when their owner contract guarantees content immutability. A serialization failure, lock timeout or version mismatch aborts the entire release and maps to the existing stale/conflict contract.

All locks are acquired in the fixed order `(idempotency claim, organization graph, WMS Site, WMS assignments/warehouses, BOM/routing sources, Catalog product/variant/UoM, attachment references, Work Centres, resource memberships/resources, definition family, applicability base key)`, using each owner contract's canonical physical key followed by lower-case UUID inside a group. Each provider exposes one transaction-aware `lockAndRead`/equivalent operation used at that assigned position, and every owner mutation path shares the same serialization point; providers do not independently reacquire keys later. No code path may acquire a later lock and then request an earlier one, and a newly discovered identity causes a stale abort. The idempotency claim uses a scoped unique insert inside the same publication transaction; a concurrent identical request waits, then replays the committed result or claims the key after rollback. The claim is never committed independently of the immutable release.

## Data Model

Names remain provisional until prerequisite discovery. Every new row includes UUID `id`, trusted `tenant_id`, trusted `organization_id` and `created_at`; every mutable row additionally includes `updated_at`. Immutable revisions and snapshot rows are append-only, not user-editable, and still carry explicit scope columns so every direct query and composite foreign key can enforce tenant and organization isolation.

### `ProductionDefinition`

- Stable family identity for one output product or validated variant.
- Catalog scalar IDs: `output_product_id` and nullable `output_variant_id`.
- Scoped uniqueness follows the accepted P1.4 output-target rule.
- Cannot be edited or deleted after any released revision exists.

### `ProductionDefinitionRevision`

- Scoped `production_definition_id` and positive immutable `revision_number`.
- `status = released`; no draft or withdrawn state in P1.7.
- `site_id`, `valid_from` and required `valid_to`.
- Immutable Site code/name/active evidence, accepted discriminated Site version and `site_eligibility_schema_version`.
- Selected released `bom_revision_id` and nullable released `routing_revision_id`.
- `released_at`, `released_by_user_id`, `snapshot_schema_version` and `snapshot_content_hash`.
- Immutable root BOM and optional routing evidence includes source family ID, source revision ID, immutable revision number and the version token accepted by the release command; historical display never requires a mutable source join.
- An immutable source-version manifest identifies every Catalog product/variant/UoM, Site, Site assignment, warehouse, BOM, Routing, Work Centre, resource and attachment reference consumed by the snapshot.
- No edit or delete API.

### `ProductionDefinitionSnapshotSiteWarehouse`

- One immutable row per live warehouse-role assignment captured in WMS `SiteEligibilitySnapshotV1`, owned by the definition revision.
- Preserves assignment scalar ID, fixed role, default flag, warehouse scalar ID/code/name/active state, deterministic ordinal and discriminated assignment/warehouse source-version tokens.
- At least the active default `raw_material` and `finished_goods` assignments are required; all live assignments returned by the bounded owner snapshot are persisted so historical eligibility does not require WMS.
- Scoped composite foreign keys bind the row only to the Manufacturing definition revision; there is no ORM or database FK to WMS tables.

### `ProductionDefinitionSnapshotNode`

- One row per selected BOM occurrence node, including the root.
- Owning definition revision, stable occurrence path, nullable parent node, depth and deterministic ordinal.
- Output product/variant IDs, selected released BOM family/revision IDs, immutable source revision number and immutable base quantity/UoM evidence.
- Bounded Catalog display fallbacks.

### `ProductionDefinitionSnapshotLine`

- Owning snapshot node, stable source line ID, unique occurrence ID and position.
- Component product/variant IDs and exact entered/normalized quantity/UoM evidence.
- Consumption basis, yield factor, supply mode and nullable child-node ID.
- Immutable Catalog product/variant/UoM display and source-version evidence required to interpret the line without a live Catalog join.
- Duplicate component IDs are allowed; occurrence identity remains distinct.

### `ProductionDefinitionSnapshotOperation`

- Owning definition revision, stable source operation ID and sequence position.
- Name/instruction snapshot and nullable scoped reference to one immutable `ProductionDefinitionSnapshotWorkCentre` row.
- Exact setup/run durations from P1.5b.
- Confidential/free-text fields use the Manufacturing encryption map and decryption-aware readers and do not appear in list DTOs, events, logs or errors.

### `ProductionDefinitionSnapshotWorkCentre`

- One de-duplicated immutable row per Work Centre referenced by the selected routing, scoped to the owning definition revision.
- Persists the complete P1.6 `WorkCenterSnapshotV1` header: `schema_version`, transaction-assigned final `captured_at = released_at`, Work Centre scalar ID, code, name, nullable description, active state and `updated_at`; the source manifest additionally represents that timestamp as `{ versionKind: 'updated_at', versionToken }`.
- Has at least one child `ProductionDefinitionSnapshotWorkCentreResource` row; an empty membership is rejected before publication in Wave 0.

### `ProductionDefinitionSnapshotWorkCentreResource`

- One immutable row per resource entry in the owning `WorkCenterSnapshotV1`, preserving resource scalar ID, name, active state, `updated_at` and deterministic ordinal; the source manifest additionally represents that timestamp as `{ versionKind: 'updated_at', versionToken }`.
- Scoped composite foreign keys bind the row to its definition revision and Work Centre snapshot. Historical reads never join the live resource provider.

### `ProductionDefinitionSnapshotSourceVersion`

- One immutable row per external or source resource consumed during candidate construction, owned by the definition revision.
- Stores the closed `resource_type`, scalar `resource_id`, trusted scope, `version_kind`, canonical `version_token`, evidence schema version and deterministic ordinal.
- Covers every resource committed by `selectedResourceDigest`, including Catalog/UoM, Site/assignment/warehouse, BOM/Routing, Work Centre/resource and attachment-reference entries. The row is audit evidence, not a live foreign-key relationship.
- Historical reads and hash verification use this manifest; they never require the peer provider to be installed or reachable.

### `ProductionDefinitionReleaseIdempotency`

- Scoped uniqueness on `(tenant_id, organization_id, command_id, idempotency_key)`.
- Transactional claim state (`pending` while uncommitted, `completed` after the immutable result is written), canonical semantic-request hash, released revision result and timestamps. No `pending` claim is visible outside the publication transaction.
- The hash excludes the idempotency key itself, actor identity and volatile transport metadata; it includes trusted scope, actor-independent readiness input and explicit overrides, submitted `candidateHash`, submitted `selectedResourceDigest`, hash algorithm, and candidate/resource-digest/snapshot schema versions. The server does not need the unbounded occurrence/resource selections or source-version manifest in the release request; step 10 proves those compact commitments against the locked reconstruction.
- Identical replay returns the original result; a different request using the same key returns `idempotency_key_reused`.
- The row commits in the release transaction. A rolled-back attempt does not reserve the key.

### Source revision continuity

- Source BOM and routing families retain at most one active draft according to their prerequisite contracts.
- Freezing a draft and inserting its next editable copy occur in the release transaction.
- The new draft uses new revision, line and operation IDs so future edits cannot alter released source identity.
- Copy provenance is recorded using the prerequisite aggregate's internal source-revision field when available; it is not a public successor or supersession contract.
- A released child revision may be referenced by unlimited immutable snapshots and is never copied merely because it is reused.

### Source lifecycle migration and mutation rules

P1.7 requires additive owner-spec changes and migrations in both BOM and Routing before the release command is enabled:

- Their current `status = 'draft'` constraints are widened to admit `released` while preserving existing draft rows and indexes.
- The owner aggregate performs the only `draft -> released` transition and rejects a second release, update, delete, undo or redo against a released revision with its existing mutation/error contract extended additively.
- The owner aggregate creates exactly one next active draft, with new revision, line and operation identities, in the same transaction as the status transition. A failed copy rolls back the status transition.
- Existing source CRUD and command handlers must check released immutability before any write or soft-delete side effect. No cascade may delete or rewrite a released source referenced by an immutable definition.
- The migrations and owner-spec updates are part of the P1.7 prerequisite gate; P1.7 must not widen another module's constraints or write its tables directly.

### Constraints and Indexes

- Scoped unique family identity and revision number.
- Valid non-empty release interval.
- Scoped unique occurrence path and operation position per released snapshot; scoped unique Site-assignment identity/ordinal per definition revision.
- Scoped composite foreign keys between definition, revision and all snapshot rows, including Work Centre/resource evidence.
- Indexed resolver key and released interval lookup.
- Scoped definition-family lock/upsert key so family creation and revision-number allocation are serialized for concurrent Sites.
- Locked executable-overlap query through the correction provider plus a database/provider exclusion-range guarantee or equivalent serialized transaction strategy. An adapter/provider combination without one of these guarantees cannot enable the release action.
- No cascade delete from source drafts to released snapshot rows.

### Canonical Hash

- Algorithm `sha256`; candidate schema starts at `manufacturing.production_definition.candidate.v1`, selected-resource digest schema at `manufacturing.production_definition.resources.v1` and final snapshot schema at `manufacturing.production_definition.snapshot.v1`.
- The candidate envelope is exactly `{ schemaVersion, scope, target, site, effectivity, selection, sourceVersions, snapshot }`. It contains the complete normalized BOM/routing/Site-assignment/warehouse/Work Centre/resource candidate but excludes release identity, actor, `releasedAt` and all `capturedAt` values. `sourceVersions` contains every Catalog, UoM, Site, Site assignment, warehouse, BOM, Routing, Work Centre, resource and attachment-reference token consumed by readiness.
- The final snapshot envelope has the same business projection plus the frozen released source identities and the single transaction timestamp used for `releasedAt` and every `capturedAt`. It produces `snapshotContentHash`; it is not required to equal `candidateHash`.
- Canonical UTF-8 JSON uses sorted object keys, explicit `null`, lower-case canonical UUIDs, RFC 3339 UTC timestamps with milliseconds, canonical exact-decimal strings and closed enum values. Arrays are sorted by the schema-defined keys: occurrences by path segments, nodes by path, lines by `(nodePath, position, sourceLineId)`, operations by `(sequence, sourceOperationId)`, Work Centres and resources by `(workCentreId, ordinal, resourceId)`, and source versions by `(resourceType, resourceId)`.
- `occurrencePath` is the compact API encoding of a canonical segment array: `root` for the top-level node and `root/<lowercase-uuid>/<lowercase-uuid>...` for nested produce occurrences, where each segment is the stable source BOM line ID. The same encoder/decoder is used by readiness, bounded preview pages, release, snapshot rows and hashing; non-UUID segments, malformed paths and non-canonical casing are rejected.
- `selectedResourceDigest` hashes the versioned envelope `{ schemaVersion, resources }`, where `resources` is the ordered `{ resourceType, resourceId, versionKind, versionToken }` list, allowing the compact release request to commit to the full source set without carrying it. Candidate-only mutable draft tokens are replaced by frozen source revision identities and immutable revision numbers only in the final snapshot projection.
- Existing hashes are never recomputed when a future additive hash schema is introduced. Candidate, resource-digest and snapshot projections each ship golden input/output vectors and a field-inclusion test; `all future snapshot content` means all fields enumerated by the versioned envelope, not an open-ended implementation-defined set.
- Hashing runs over validated plaintext before encryption; encryption metadata and ciphertext are excluded.

## Commands and Events

### Command

- `manufacturing.production_definition.release`

The command uses Zod validation, trusted scope, CommandBus and mutation guards. Its concurrency contract is the server-reconstructed multi-resource digest, not one optimistic-lock header: every distinct selected source resource carries its owner-defined version token, and the handler rejects any stale resource before mutation. The route runs the standard guard registry separately for every draft the command will mutate; a top-level guard result never authorizes mutation of a child BOM or routing revision. Release is intentionally non-undoable: the registered handler declares `isUndoable: false`, omits `undo`, and `buildLog` never supplies an `undoToken`. Consequently audit queries with `undoableOnly` exclude the operation and first-party UI exposes no Undo affordance. Tests assert absence of a token/affordance rather than expecting an unreachable direct-undo error string. Correction/withdrawal belongs to the prerequisite lifecycle provider.

The command uses the stable `command_id = manufacturing.production_definition.release` in its idempotency key. Authorization is always rechecked. A completed identical replay is returned before the current capability-gate check because the row proves an earlier authoritative commit; the gate is rechecked before every new publication attempt. Replay returns the original authoritative result, `buildLog` marks an in-handler concurrent replay `skipLog: true`, and no replay creates another source copy, definition revision, callback or event attempt. The prerequisite CommandBus integrity seam rejects pre-handler input transformation, ignores/logs post-handler result transformation in favor of the stored authoritative result and preserves deliberate interceptor rejection semantics.

### Event

- `manufacturing.production_definition.released`

Payload:

```ts
{
  tenantId: string
  organizationId: string
  productionDefinitionId: string
  productionDefinitionRevisionId: string
  revisionNumber: number
  siteId: string
  validFrom: string
  validTo: string
  snapshotSchemaVersion: string
  snapshotContentHash: string
  occurredAt: string
}
```

The event contains no full structure, display snapshot, instructions or sensitive content. Fields are additive-only after publication.

The module declares the event in `manufacturing/events.ts` through `createModuleEvents({ moduleId: 'manufacturing', events })`; the `events` array is `as const` and the declaration includes the stable ID, translated label/description metadata, `category: 'lifecycle'` and `entity: 'production_definition'`. It emits after commit with trusted tenant/organization scope and explicit `{ persistent: true }`. Persistent subscribers remain consumer-owned, focused and idempotent. Publication does not rely on a subscriber side effect.

## API Contracts

Exact route filenames and generated IDs freeze only after prerequisite discovery facts exist.

Every route exports per-method `metadata` with `requireAuth` and the appropriate `requireFeatures`, plus an `openApi` contract. These immutable/read/action surfaces are intentionally custom routes rather than CRUD factory routes: released definitions have no generic create/update/delete contract, and release must pass the CommandBus and mutation-guard orchestration described below. All request schemas, query schemas and transformed guard payloads are validated with Zod.

Additive ACL features are `manufacturing.production_definition.view` for all reads/readiness/resolve and `manufacturing.production_definition.release` for publication. The release route requires both because it reconstructs the same protected evidence as readiness; `release` never silently implies `view`. BOM, Routing, Catalog, WMS Site and Work Centre/resource owner readers enforce their published view/release permissions unless their owner contract explicitly provides a narrowly scoped internal release reader. Such an internal reader must preserve tenant/organization/deletion checks, declare the exact caller authorization it relies on and record the caller in release audit evidence. The release route never grants or bypasses peer ACL. `setup.ts` grants both P1.7 features explicitly to administrators and neither to employees by default; existing tenants receive them through standard ACL sync. Page metadata and UI affordances use the same wildcard-aware checks, while API and peer authorization remain authoritative.

### Reads

List returns `{ items: ProductionDefinitionListItemDto[], nextCursor: string | null, hasMore: boolean }` with exactly one item per released definition revision, including multiple Sites or validity windows for the same family. Each item contains the family/revision IDs, output product/variant IDs plus bounded display evidence, Site ID plus bounded display evidence, revision number, validity, snapshot schema/hash and release actor/time. The default keyset order is `releasedAt DESC, productionDefinitionRevisionId ASC`; supported filters and sort values are closed and declared in OpenAPI, and the opaque cursor encodes the complete sort tuple. No total count is promised.

Family detail returns the immutable family identity and a keyset-paged released-revision summary. Revision detail returns only the immutable header and collection counts. Snapshot content is read through the discriminated subresource `GET .../snapshot/:collection`, where `collection` is one of `nodes | lines | operations | siteWarehouses | workCentres | workCentreResources | sourceVersions`; each response is `{ collection, items, nextCursor, hasMore }` with `limit <= 100`. The opaque cursor binds trusted scope, revision ID, collection, limit and the complete keyset tuple, and is rejected if replayed for another collection or scope. Detail DTOs expose source identities/revision numbers, immutable Site/warehouse and `WorkCenterSnapshotV1` evidence, and decrypted instructions only to authorized callers, never ciphertext or encryption metadata.

`ReadinessFinding` is `{ code: ReadinessFindingCode, severity: 'error' | 'warning', occurrencePath?: string, resourceType?: ReadinessResourceType, resourceId?: string, messageKey: string, params?: Record<string, string> }`. `ReadinessFindingCode` and `ReadinessResourceType` are closed unions generated from the documented stable error/finding registry; each code has a bounded parameter schema and a translated `messageKey`. No server-supplied HTML or foreign-scope label is rendered. Readiness returns HTTP 200 for an explainable candidate with findings, while malformed input uses 400 and provider failure uses 503. `truncated: true` means the candidate is not releasable; the release endpoint maps that state to `readiness_findings_truncated`.

- `GET /api/manufacturing/production-definitions` — keyset list with `limit <= 100` and filters by output, Site and effective date.
- `GET /api/manufacturing/production-definitions/:id` — family and released revision summaries.
- `GET /api/manufacturing/production-definitions/:id/revisions/:revisionId` — immutable header and bounded collection counts.
- `GET /api/manufacturing/production-definitions/:id/revisions/:revisionId/snapshot/:collection` — one discriminated keyset page for the selected snapshot collection.
- `GET /api/manufacturing/production-definitions/release-capability` — safe default-closed gate status and closed reason codes.
- `POST /api/manufacturing/production-definitions/release-readiness` — read-only recursive validation.
- `POST /api/manufacturing/production-definitions/release-readiness/selection-page` — read-only bounded occurrence preview for the same input and candidate hash.
- `POST /api/manufacturing/production-definitions/resolve` — authorized point resolution.

The readiness contract uses these closed registries:

```ts
type ReadinessResourceType =
  | 'bom_revision'
  | 'routing_revision'
  | 'catalog_product'
  | 'catalog_variant'
  | 'catalog_uom'
  | 'site'
  | 'site_warehouse_assignment'
  | 'warehouse'
  | 'work_centre'
  | 'resource'
  | 'attachment_reference'

type ReadinessFindingCode =
  | 'definition_cycle_detected'
  | 'definition_unresolved_child'
  | 'definition_child_revision_selection_required'
  | 'definition_routing_incompatible'
  | 'definition_work_centre_resources_required'
  | 'definition_site_eligibility_invalid'
  | 'catalog_provider_unavailable'
  | 'site_provider_unavailable'
  | 'work_centre_provider_unavailable'
  | 'source_scope_invalid'
  | 'source_revision_stale'
  | 'release_graph_limit_exceeded'
  | 'definition_applicability_overlap'
```

`ProductionDefinitionReleaseGateReason` is a closed safe union covering each missing/incompatible Gate B provider and `correction_provider_unavailable`. The capability endpoint never exposes DI keys, versions not intended for clients or internal exception text.

Readiness request:

```ts
{
  bomRevisionId: string
  routingRevisionId?: string
  siteId: string
  validFrom: string
  validTo: string
  childRevisionOverrides?: Array<{
    occurrencePath: string
    bomRevisionId: string
  }>
}
```

Readiness returns compact commitments and the first bounded preview page:

```ts
{
  candidateHash: string
  hashAlgorithm: 'sha256'
  candidateSchemaVersion: 'manufacturing.production_definition.candidate.v1'
  snapshotSchemaVersion: 'manufacturing.production_definition.snapshot.v1'
  resourceDigestSchemaVersion: 'manufacturing.production_definition.resources.v1'
  selectedResourceDigest: string
  selectionPreview: {
    items: Array<{
      occurrencePath: string
      bomRevisionId: string
      sourceStatus: 'draft' | 'released'
    }>
    nextCursor: string | null
    hasMore: boolean
  }
  summary: {
    bomOccurrences: number
    bomNodes: number
    bomLines: number
    routingOperations: number
    workCentres: number
    resources: number
  }
  findings: ReadinessFinding[]
  truncated: boolean
}
```

`selectionPreview.items` is ordered by canonical occurrence path, includes the root on the first page and contains at most 100 rows. Additional pages resubmit the identical readiness input, `candidateHash` and an opaque cursor bound to scope, hash and keyset; the server reconstructs the candidate and returns `release_candidate_stale` if it changed. The server-only selected-resource list is de-duplicated and ordered by `(resourceType, resourceId, versionKind, versionToken)` before producing `selectedResourceDigest`; it is never echoed in the release request. `childRevisionOverrides` is required whenever a resolved family has more than one eligible revision, regardless of statuses, and every override must match that occurrence's resolved family. The array is capped at 100 entries; a candidate needing more than 100 explicit ambiguity decisions fails `release_graph_limit_exceeded` and must be simplified or handled by a separately specified server-side candidate workflow. Findings are bounded; `truncated: true` blocks release.

Resolve accepts `{ outputProductId, outputVariantId?, siteId, businessEffectiveDate }` and returns `{ productionDefinitionId, productionDefinitionRevisionId, revisionNumber, snapshotSchemaVersion, snapshotContentHash }`. Zero or ambiguous matches return stable failures.

### Write

- `POST /api/manufacturing/production-definitions/release`

The compact request contains the readiness input (including every explicit `childRevisionOverride`) plus `selectedResourceDigest`, `candidateHash`, `hashAlgorithm`, `candidateSchemaVersion`, `resourceDigestSchemaVersion`, `snapshotSchemaVersion` and `idempotencyKey`. It never contains the complete occurrence or resource arrays. The server reconstructs the complete canonical candidate inside the release transaction and compares both commitments. Duplicate override paths, overrides for non-ambiguous/wrong families, missing required overrides, unknown schema versions and non-canonical paths are rejected rather than normalized.

Success or identical replay returns `{ replayed, productionDefinitionId, productionDefinitionRevisionId, revisionNumber, status: 'released', snapshotSchemaVersion, snapshotContentHash, releasedAt }`.

The action route exports per-method metadata and OpenAPI, applies the release guards and revalidates transformed payloads. Because platform `x-om-operation` metadata requires an undo token, this non-undoable release returns no operation header; its bounded action-log row remains an internal audit surface.

The client uses the guarded-mutation identity and resource kind supplied by the BOM owner contract; P1.7 must not hard-code it until discovery confirms the published identity. Before dispatch, the route reconstructs the candidate read-only, derives every draft resource that release would mutate and maps each to `update`. It runs the full guard set in deterministic order using a public per-resource context: optimistic-lock and record-lock headers are rebuilt for that resource, and a root token is never presented as a child token. Transformations are chained, trusted identities restored and the compact Zod schema reparsed after each transformation. Any transformation that changes the semantic request hash, overrides, candidate hash or resource digest fails closed. The command independently reconstructs the candidate and performs complete per-resource version validation and locking. Callbacks retain their resource identity, run only after a new commit, and are skipped on replay. Step 1 must confirm the public multi-resource helper; absence blocks P1.7 rather than permitting forged headers or private record-lock imports.

### Stable Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_release_window` | Invalid or empty interval |
| 400 | `release_graph_limit_exceeded` | Candidate exceeds a supported bound |
| 403 | `release_not_allowed` | ACL denies release |
| 404 | `production_definition_source_not_found` | Missing, foreign-scope or mismatched source |
| 404 | `production_definition_not_applicable` | Resolve found no definition in the selected precedence tiers |
| 409 | `release_candidate_stale` | Selected membership, token or semantic hash changed |
| 409 | `definition_applicability_overlap` | A released interval already overlaps the requested key |
| 409 | `definition_cycle_detected` | Direct or indirect BOM cycle |
| 409 | `definition_unresolved_child` | A manufacture occurrence has no releasable child |
| 409 | `definition_child_revision_selection_required` | A resolved child family has multiple eligible revision states and needs an explicit occurrence override |
| 409 | `definition_child_revision_selection_changed` | The submitted occurrence selection differs from the graph resolved inside release |
| 409 | `definition_routing_incompatible` | Routing scope or exact output target differs from the top-level BOM |
| 409 | `definition_site_eligibility_invalid` | Site is inactive or its required role/default/warehouse evidence is missing or changed |
| 409 | `definition_work_centre_resources_required` | A referenced Work Centre has no eligible active same-scope resource membership |
| 409 | `release_guard_payload_changed` | A guard transformation changes readiness-bound semantic input or selected membership |
| 409 | `release_command_payload_changed` | A CommandBus interceptor attempts to transform guarded input before the handler runs |
| 409 | `production_definition_resolution_ambiguous` | Resolve found multiple definitions in the selected precedence tier |
| 409 | `definition_reference_not_ready` | Site, Catalog, BOM, routing or Work Centre fails readiness |
| 409 | `idempotency_key_reused` | The key belongs to a different canonical request |
| 422 | `readiness_findings_truncated` | Release is attempted with a candidate whose readiness findings exceed the explainable bound |
| 503 | `catalog_provider_unavailable` | Required scoped Catalog reader is unavailable |
| 503 | `site_provider_unavailable` | Required scoped Site reader is unavailable |
| 503 | `work_centre_provider_unavailable` | Required scoped Work Centre eligibility reader is unavailable |
| 503 | `production_definition_disposition_unavailable` | Point resolution cannot obtain the correction provider's scoped executable-disposition view |
| 503 | `production_definition_release_disabled` | The default-closed release gate reports one or more safe prerequisite reason codes |

Errors expose safe occurrence paths and business identifiers where actionable, never foreign-scope identity, raw SQL, policy internals or secrets. A mutation-guard rejection is not remapped to a P1.7 error: the route returns the guard's existing safe body and status exactly as required by `runMutationGuards` (for example the standard record-lock conflict), so shared conflict UI and third-party guards retain their published semantics. Deliberate CommandBus interceptor rejection is extracted through `getCommandInterceptorHttpRejection`, Zod-validated against its safe 4xx contract and returned without degrading to 500. Attempted pre-handler input transformation uses the stable P1.7 error above; attempted post-handler result transformation is logged and discarded because the domain commit is already authoritative.

## UI/UX

- Server-rendered released-definition list and detail page roots. The list uses `DataTable` with stable `entityId` and `extensionTableId` values confirmed by generated facts; immutable detail sections use the shared backend detail primitives.
- One guarded release dialog launched from an eligible BOM draft only when the capability endpoint reports `enabled: true`; a closed gate renders a translated non-actionable prerequisite state and the server remains authoritative.
- The dialog selects Site, optional routing and validity, runs readiness, shows bounded findings and a paged selection summary, and requires an explicit choice for every occurrence whose child family has multiple eligible revisions. It never hydrates the full component tree. It explains that release is immutable and that selected drafts receive a new editable copy. Guard rejection uses the shared guarded-mutation/conflict surface and identifies the safe affected resource when the guard body permits it; the dialog never converts a child record-lock conflict into a generic release error.
- Before submit, the dialog explicitly warns that P1.7 cannot directly delete or edit the occupied validity window, links to the prerequisite correction/withdrawal flow and requires a deliberate confirmation distinct from ordinary form submission.
- Released detail shows header, source revision references, content hash and on-demand discriminated snapshot pages capped at 100 rows, including the captured Site warehouse-role/default evidence.
- No create/edit definition form, successor, withdrawal, approval timeline, bulk action, global search or full-tree client hydration.
- The dialog uses `useGuardedMutation`, `apiCallOrThrow`, shared conflict handling and `retryLastMutation`; it supports Cmd/Ctrl+Enter and Escape.
- Loading, missing-record, empty and error states use `LoadingMessage`, `RecordNotFoundState`, `EmptyState` and `ErrorMessage` respectively. Interactive controls use `Button`/`IconButton`; icon-only controls have translated `aria-label` values. Statuses use `StatusBadge`, findings use `Alert`, and page-body icons come from `lucide-react` with design-system sizes.
- All strings use module locale files. No raw `fetch`, raw `<button>`, unsafe HTML, hardcoded status colors, arbitrary Tailwind values or inline page-body SVG are introduced.

### Frontend Architecture Contract

| Route / surface | Server root | Client islands | Data owner | Notes |
|---|---|---|---|---|
| Released-definition list | `page.tsx` | DataTable's existing client boundary only | keyset list API | No page-root `"use client"` |
| Released-definition detail | `page.tsx` | bounded snapshot pager only | detail API | Server header/detail; pages of at most 100 rows |
| BOM draft release action | existing BOM server page | `ProductionDefinitionReleaseDialog` | readiness and release APIs | Dialog owns form state only; never receives the full tree |

| `"use client"` file | Reason | Imported by | Heavy dependencies | Cleanup / hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `ProductionDefinitionReleaseDialog` | dialog state, guarded mutation, keyboard handling and occurrence choices | eligible BOM draft action | none beyond existing UI/form primitives | stale readiness state is cleared when source selection changes or dialog closes | server-only UI cannot provide the required interactive validation flow |
| bounded snapshot pager, if the shared detail pager requires a wrapper | on-demand page navigation | released detail server page | none | request cancellation/late-response guard on page changes | full server navigation would degrade the bounded inspection flow |

No new page or layout root may add `"use client"`; no route-specific provider/bootstrap registration is introduced; no new client file may exceed 300 LOC without being split and reviewed; and no heavy editor, graph, table duplicate or browser SDK may be added. Before merge, `yarn check:client-boundaries`, a hydration smoke test for each changed route, dialog interaction tests and one production build/bundle signal must pass. The released detail must prove that payload and hydration size remain bounded as the stored snapshot approaches supported limits.

## Failure Scenarios

- Any validation, scope or peer-read failure before commit writes no released state.
- A mutation or record-lock guard on the root BOM, any selected child BOM draft or the routing draft rejects the whole release before publication locks or writes; no sibling resource is frozen. Guard payload transformations are revalidated against the compact candidate commitments, and any readiness-bound semantic rewrite fails closed.
- A source revision changed after readiness returns `release_candidate_stale` and preserves the selection for refresh/retry.
- Any changed child-family resolution or occurrence-to-revision selection returns `definition_child_revision_selection_changed`; release never substitutes a revision.
- A Catalog, UoM, Site, Site assignment, warehouse, Work Centre, resource or attachment-reference version changes before its shared-transaction lock is held; the reconstructed digest changes, release returns `release_candidate_stale` and no source/snapshot row commits.
- A WMS mapping/default or warehouse-active change races release: both paths contend on the WMS owner locks, and the release either snapshots the complete committed eligibility state or fails stale; a Site timestamp alone is never accepted.
- Concurrent overlap attempts serialize under the applicability base key; at most one overlapping release commits. Concurrent non-overlapping Sites serialize family creation and revision allocation without duplicate family or revision numbers.
- A commit failure rolls back a newly created family, frozen source revisions, snapshots and idempotency result together.
- An identical retry after a committed response loss rechecks authorization and returns the stored result before the current release-gate check, without a second audit-log, callback or event attempt. Different-payload reuse, rollback reuse and cross-scope reuse follow their explicit idempotency contracts.
- A referenced Work Centre with an empty resource membership, or with any unresolved, inactive, deleted or foreign-scope resource, returns `definition_work_centre_resources_required` or `definition_reference_not_ready` and freezes nothing.
- Historical reads use immutable BOM, routing, Site/warehouse-role/default, Work Centre and resource evidence and do not require live peer data. New readiness/release fails closed when a required scoped reader is unavailable.
- Released list/detail/snapshot reads remain available without the correction provider. Point resolution fails explicitly with `production_definition_disposition_unavailable` rather than selecting a potentially withdrawn definition when the executable-disposition view is unavailable.
- A post-commit event enqueue or subscriber failure does not change the authoritative snapshot. Subscriber failures retry after enqueue; an enqueue omission is discoverable only through logs and consumer-owned polling/read comparison until a platform transactional outbox exists. P1.7 adds no reconciliation job.
- An operator discovers an erroneous committed release: P1.7 preserves the evidence and blocks an overlapping replacement; the UI routes to the prerequisite correction/withdrawal capability. The release gate cannot be enabled without that executable provider, and raw data correction is not presented as a supported path.
- On the normal CommandBus path, audit history records a newly committed release without an undo token. First-party history UI does not offer Undo and `undoableOnly` filters it out; replay creates no duplicate audit row. An injected post-handler action-log failure may omit that secondary row without invalidating the authoritative release and raises operational-repair telemetry.
- CommandBus fails after the domain handler commits: the route finds the completed idempotency result, records `command_post_commit_pipeline_failed`, runs only the route-owned pending callbacks/event attempt and returns the committed handler result. It does not resume or claim success for the failed CommandBus tail stage. Without a completed row it propagates the original failure.

## Security, Scale and Compatibility

- Every query and mutation filters trusted tenant and organization scope.
- Peer IDs are revalidated in scope and foreign-scope failures remain non-disclosing.
- ACL separates `view` and `release`; wildcard grants use the shared matcher.
- Initial server-side limits are depth 32, 1,000 nodes, 10,000 lines, 2,000 operations, 100 explicit ambiguity overrides, 100 Site assignments, 500 distinct Work Centres, 5,000 total Work Centre resource rows, 2,000 attachment references, 20,000 source-version rows, 50,000 total persisted snapshot rows, 32 MiB canonical plaintext and 500 readiness findings. The P1.6 per-Work-Centre limit of 100 resources still applies. Exceeding any bound returns `release_graph_limit_exceeded`. Every preview/detail page is at most 100 rows. The compact release request is capped at 256 KiB and contains no complete occurrence/resource arrays; its bounded override array contains at most 100 entries. Maximum-bound tests must prove the request stays below that cap with all 100 overrides at maximum canonical path length.
- Graph and peer reads are batched; no N+1 call per occurrence. Maximum-bound readiness uses at most 50 database queries plus one bounded batch call per distinct owner provider; release may add one lock/write batch per owner and the explicitly linear per-draft guard calls.
- Logs contain correlation/scope IDs, definition ID, candidate counts, duration and stable failure code, never full instructions or snapshot content.
- Persistence and overlap checks use ORM/query-builder parameters only; no identifier, date or occurrence path is interpolated into SQL. UI renders instructions and display fallbacks as text, never raw HTML, and uses framework JSON/URL encoding without treating user input as a file path.
- No read cache is introduced.
- Schema, ACL, route, command, event and DTO surfaces are additive and follow `BACKWARD_COMPATIBILITY.md` after publication.
- The spec introduces new additive contract surfaces and changes no published identifier. Once released, API URLs, ACL IDs, command/event IDs, DTO fields and snapshot schema versions follow the deprecation protocol; additive event/DTO evolution preserves existing fields. No `UPGRADE_NOTES.md` entry is required for the initial additive introduction.
- The migration has no backfill. Operational rollback disables readiness and new release while preserving released list/detail/snapshot/resolve reads and their immutable evidence for forward recovery.
- The synchronous command is retained because source freezing and snapshot publication require one database transaction. On the CI reference PostgreSQL environment, maximum-bound readiness must complete within 10 seconds and release within 20 seconds with the query/service-call ceilings above. If either budget fails, implementation lowers the supported graph limits before merge or separately specifies queued preparation; it does not ship aspirational limits.

## Testing Strategy

Self-contained fixtures create their tenant, organization, Catalog products/UoMs, active Site with required warehouse-role/default mappings, Work Centres, BOM/routing drafts, correction-provider fixture and users and clean them in `finally`.

- Unit: intervals, resolver precedence, exact decimals, occurrence paths, canonical selection ordering/deduplication, discriminated version tokens, separate candidate/resource/snapshot hashes, fixed `releasedAt/capturedAt` semantics and cycle detection.
- Command: atomic success/rollback, completed replay with authorization-before-gate ordering, new-attempt gate check, stale candidate, deterministic all-owner lock order, next-draft creation, released-child reuse, `isUndoable:false`/no-token/header behavior and domain-result recovery after each injected CommandBus tail failure.
- Mutation guards/interceptors: root, child-BOM and routing rejection; standard record-lock status/body passthrough; per-resource header identity; transformed-payload revalidation; guard semantic/membership rewrite rejection; deliberate CommandBus 4xx rejection passthrough; pre-handler input-transformation rejection; post-handler result-transformation discard/telemetry with stored-success recovery; per-resource post-commit callbacks and callback-failure isolation.
- Concurrency: overlapping releases, same-key idempotency contenders, same-family/different-Site releases, nested draft mutation, child BOM/routing record locks, and Site mapping/default/warehouse changes racing the WMS lock boundary.
- Idempotency: identical replay with the gate subsequently closed, different-payload `idempotency_key_reused`, retry after first-transaction rollback, same key in another tenant/organization, concurrent waiter replay, one audit row on the normal tail path, injected audit-tail omission with recovery telemetry and no repeated callback/event.
- API/OpenAPI: every route, dual-feature release ACL, gate status, compact request cap, transformed payload, safe error, scope isolation, collection-bound cursors and bounded preview/detail pagination.
- Integration: multi-level duplicates, variant-over-product precedence, same-tier overlap rejection, explicit ambiguous-child selection, shared released-child reuse, optional/incompatible routing, unresolved child, inactive peers, full `SiteEligibilitySnapshotV1`, Site-independent Work Centre policy, empty Work Centre membership rejection, full `WorkCenterSnapshotV1`/source manifest, adjacent intervals, historical reads with peers unavailable and attachment references.
- Canonical-contract: occurrence-path vectors, decimal/timestamp normalization, `capturedAt` exclusion/inclusion, candidate/resource/snapshot golden vectors, closed gate/finding/resource registries and rejection of non-canonical identity/version tokens.
- Events: successful persistent enqueue, subscriber retry and an injected post-commit enqueue throw proving it is caught/logged, the committed success response remains successful and the release remains readable.
- UI: readiness, release, conflicts, released detail, pagination, i18n, keyboard and hydration.
- UI architecture: no page-root `"use client"`, client-file size guard, `yarn check:client-boundaries`, route hydration smoke tests and a production build/bundle signal.
- Compatibility: Manufacturing disabled, existing draft APIs unchanged, additive migration, released action absent from `undoableOnly`, no undo token/header and replay marked `skipLog` when it reaches the handler.
- Performance: every individual and aggregate graph/evidence/byte bound meets 10-second readiness, 20-second release, query/service-call, 32 MiB canonical-plaintext and 256 KiB compact-request budgets with all 100 maximum-length overrides and no full-tree hydration.

Test names remain traceable to AC-1 through AC-17 in the Acceptance Criteria section.

### Requirement Traceability

| Requirement | Technical sections |
|---|---|
| BR-1–BR-2 | Proposed Solution, Applicability, API Contracts |
| BR-3–BR-5 | Release Transaction, Data Model, Commands and Events, Failure Scenarios |
| BR-6 | API Contracts, UI/UX |
| BR-7 | Commands and Events, Security, Scale and Compatibility |
| AC-1–AC-17 | Failure Scenarios, Testing Strategy, Risks & Impact Review, Implementation Plan |

## Risks & Impact Review

| Risk | Severity | Detection | Mitigation | Residual risk |
|---|---|---|---|---|
| Historical reinterpretation | Critical | Hash verification and historical-read fixtures | Immutable normalized snapshot, source identities, display evidence and versioned hash | A defective release remains historical evidence; correction needs a later release |
| Concurrent overlap | Critical | Stable conflict metrics/log code and two-transaction test | Applicability lock, overlap constraint/query and two-transaction test | Contention on a hot output/Site key |
| Cross-tenant reference | Critical | Adversarial scope tests and safe not-found telemetry | Trusted scope, scoped readers, composite constraints and adversarial tests | None accepted |
| Partial or mixed snapshot | Critical | Transaction rollback tests and candidate/hash mismatch telemetry | Graph lock, deterministic row locks, token/hash verification and one transaction | Hot mutations may wait |
| Mutable peer changes during release | Critical | Shared-transaction lock/version tests | `REPEATABLE READ`, owner-defined locks held through commit, final source-version digest and full rollback | Providers unable to share the transaction cannot enable release |
| Site eligibility changes without `Site.updated_at` | Critical | Mapping/default/warehouse race tests and historical snapshot reads | Reuse WMS Site/warehouse locks and persist complete `SiteEligibilitySnapshotV1`; never rely on Site timestamp alone | WMS lock contention may delay release |
| Child BOM or routing guard bypass | Critical | Per-resource guard trace, locked-child/routing integration tests and guard coverage checks | Run the complete existing guard registry for every mutated draft with per-resource identity before any write; missing safe composition support blocks implementation | More guard calls increase synchronous release latency |
| Large graph or oversized client payload | High | Maximum-bound query/wall-time/request-size tests | Hard server bounds, compact hash/digest release request, preview/detail pages and numeric query/runtime budgets | Larger structures need a future queued capability |
| Event omitted after commit | High | Structured enqueue-failure log and consumer read comparison | Best-effort event is non-authoritative; consumer-owned polling/read comparison | Consumers may observe delay or omission until the platform gains a transactional outbox |
| Wrong child revision selected | Critical | Selection-change conflict code and occurrence-path integration tests | Explicit ambiguity overrides, bounded preview, candidate hash/resource digest and in-transaction graph reconstruction | Extra user decision for ambiguous families |
| Work Centre history loses resource meaning | High | Snapshot schema/type tests and historical reads with live providers unavailable | Persist the complete versioned `WorkCenterSnapshotV1` header and resource rows and include them in the canonical hash | Snapshot size grows with Work Centre membership |
| Empty Work Centre is released | High | Readiness finding metrics and empty-membership integration test | Wave 0 requires at least one active same-scope resource for every referenced Work Centre | Resource-free production models require a later explicit policy change |
| Authoring blocked after release | High | Post-release active-draft invariant and rollback tests | Call each prerequisite aggregate's transaction-aware release-and-copy operation | Copy cost is paid inside the release transaction |
| Prerequisite lifecycle contract cannot join the transaction | High | Discovery audit before implementation step 1 | Stop implementation and specify the missing BOM/Routing contract; do not bypass ownership | P1.7 schedule depends on prerequisite contract readiness |
| Definition family/revision allocation race | High | Same-family/different-Site two-transaction test | Target-key family lock/upsert and serialized revision allocator | Contention on a hot product family |
| P1.14, attachment or correction prerequisite drift | High | Cross-spec dependency and default-closed gate tests | Parent roadmap/backlog/execution plan remain authoritative; gate stays closed until compatible providers are present | Portfolio sequencing can delay release enablement |
| Erroneous released window cannot be corrected by P1.7 | Critical | Release confirmation, audit review and gate/provider tests | Release gate requires an executable correction/withdrawal provider; P1.7 links to it and never recommends raw data correction | Correction remains a separate operational flow |
| CommandBus fails after domain commit | High | Injected action-log/interceptor/cache-side-effect failures and recovery telemetry | Completed idempotency row proves only the domain commit; route returns the stored handler result, records recovery and runs only route-owned pending callbacks/event work | Action log or another CommandBus tail effect may be omitted and require platform operational repair |

## Phasing

### Phase 1 — Readiness and immutable data foundation

Add released-definition entities including Site/warehouse-role snapshots, deterministic candidate/resource/snapshot hashing, default-closed capability gate and bounded read-only readiness/preview surfaces.

### Phase 2 — Atomic release and resolution

Add the release command that coordinates prerequisite public shared-transaction owner readers/locks, applicability protection, post-commit recovery, snapshot writes, standard persistent event and resolver. P1.7 does not create peer-owner locking or guard-composition infrastructure.

### Phase 3 — Minimal released-definition UI

Add the guarded release dialog, released list/detail pages and complete integration evidence. P1.7 is enabled only after all phases pass the configured validation gate.

## Implementation Plan

1. Verify prerequisite code and generated facts, including P1.14 and attachment Gate B status; the correction provider's durable disposition plus transaction-aware applicability view; WMS `SiteEligibilitySnapshotV1` plus serialization shared by Site/assignment/warehouse-active writes; public transaction-aware BOM/Routing release-and-copy; routing target linkage; scoped Catalog/Work Centre readers; source lifecycle migrations; public multi-resource mutation-guard composition; and the public CommandBus input/result-integrity seam. Record exact evidence here and stop for work in the owning platform/module spec if any provider cannot share the transaction, physical lock order or scope/guard/interceptor semantics.
2. Add the default-closed `productionDefinitionReleaseGate`, family/revision, BOM/line/operation, Site/warehouse-role, Work Centre/resource, source-version-manifest and idempotency entities/contracts, constraints, migration and encryption-map entries with gate, snapshot and discriminated-version unit tests.
3. Implement bounded stateless candidate construction, explicit ambiguity overrides, paged selection preview, Site-independent Work Centre policy, complete Site/warehouse and peer evidence, canonical occurrence paths, separate candidate/resource/snapshot hashing and compact-request validation.
4. Consume the prerequisite public deterministic per-resource guard-composition helper and transaction-aware owner readers/locks to implement the atomic `REPEATABLE READ` release, fixed cross-owner lock order, serialized family/applicability keys, release-and-copy orchestration, released-child reuse, idempotency branches and rollback/concurrency tests. If any prerequisite contract is absent, stop for work in its owning platform/module spec rather than implementing it inside P1.7.
5. Add post-commit CommandBus recovery, one non-undoable/skip-on-replay audit contract and explicit `{ persistent: true }` event emission with injected-failure tests.
6. Add gate/list/family/revision/snapshot-collection/readiness/preview/resolve routes, OpenAPI, closed gate/finding/resource registries, stable errors, collection-bound cursors and API/ACL/performance evidence.
7. Add the minimal gated release dialog and released list/detail UI with Site/warehouse and Work Centre/resource evidence, accessibility, shared guard/conflict handling and hydration tests.
8. Run `yarn generate`, the smallest relevant checks and then the full configured validation gate; prove the gate remains closed without every named provider and the maximum-bound runtime/query/request budgets pass; do not run `yarn db:migrate` without approval.

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root + core | Tenant/organization scope and no cross-module ORM relations | Compliant | Trusted scope is mandatory; peer IDs are scalar IDs with snapshots and scoped DI readers |
| root + core | Writes use commands, Zod, guards and explicit concurrency | Compliant with prerequisite gate | One CommandBus release command runs the existing guard registry for every mutated draft and uses a complete multi-resource token/digest contract; Step 1 must confirm both the public per-resource guard-context helper and CommandBus input/result-integrity seam |
| core | Module-owned writes and guards must not be bypassed | Compliant with prerequisite gate | BOM/Routing freezing and copying use public transaction-aware aggregate operations, and root/child/routing drafts each pass their own guards; either missing contract blocks implementation |
| core | Every API route exports OpenAPI and per-method auth/feature metadata | Compliant | Required for every listed custom read/action route |
| root optimistic locking | New editable entities use `updated_at`; custom multi-record writes use correct record versions | Compliant with prerequisite gate | New snapshots are immutable; every selected editable source carries its own `updatedAt`, receives its own guard/header context and fails closed when stale or locked |
| WMS Site contract | Production consumers snapshot exact Site warehouse-role assignments and share owner locks | Compliant with prerequisite gate | `SiteEligibilitySnapshotV1`, Site/warehouse physical lock order, mapping/default/warehouse versions and race tests are mandatory |
| core encryption | Sensitive fields use the module encryption map and decryption-aware readers | Compliant | Operation instructions are encrypted and excluded from lists/events/logs/errors |
| events | Events use `createModuleEvents`; persistent consumers are idempotent | Compliant | The released event is typed, scoped, explicitly emitted with `{ persistent: true }` and non-authoritative |
| UI + backend UI | Canonical HTTP, guarded writes, DataTable/detail states, i18n and controls | Compliant | `apiCallOrThrow`, `useGuardedMutation`, retry context, stable DataTable IDs and shared states/primitives are specified |
| root design system | Semantic tokens, shared primitives, keyboard and accessible icon controls | Compliant | UI/UX explicitly prohibits raw/hardcoded alternatives and names required primitives |
| frontend architecture contract | Server/client map, client ledger, budgets and hydration/performance evidence | Compliant | Page roots remain server components; dialog/pager are bounded islands |
| cache | DI cache and tenant-scoped invalidation when caching is used | N/A | No cache is introduced; authoritative reads query immutable rows |
| compatibility | Published surfaces are stable; breaking changes use deprecation protocol | Compliant in design | Initial surfaces are additive and future evolution is constrained explicitly; exact provisional IDs still require the discovery gate |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass in design | Family/revision/BOM/line/operation/Site-warehouse/Work Centre/resource snapshots and discriminated source versions match compact readiness/release and collection-paged reads |
| API contracts match UI/UX | Pass | Capability gate, bounded preview, compact release and discriminated detail collections map to the gated dialog and audit pages |
| Risks cover all write operations | Pass | Release, WMS eligibility races, per-resource guards, source copy, idempotency, overlap and post-commit CommandBus failure have detection and mitigation |
| Commands defined for all mutations | Pass | Release is the only P1.7 mutation; the handler declares `isUndoable:false`, never emits a token and skips audit/event/callback duplication on replay |
| Cache strategy covers all read APIs | Pass | Explicit no-cache decision avoids invalidation and cross-tenant cache risk |
| Scope is one independently deployable capability | Conditional | P1.7 remains one publication capability and source lifecycle remains aggregate-owned, but P1.14/attachment contracts are Gate B sequencing prerequisites and correction/withdrawal is a production-enablement gate |

### Non-Compliant Items

No known Critical architectural-rule violation remains in the proposed design. Implementation readiness remains blocked until generated discovery confirms the named prerequisite IDs, the WMS owner-spec reader and serialization shared through warehouse-active mutations, routing target linkage, all shared-transaction scoped peer lock classes, source lifecycle migrations, the correction provider's disposition/applicability view, transaction-aware BOM/Routing release-and-copy, public multi-resource mutation-guard composition and the CommandBus input/result-integrity seam. P1.14, attachment and correction providers remain fail-closed Gate B prerequisites rather than procedural rollout assumptions.

### Verdict

**Conditionally approved as a design; implementation remains blocked until the expanded discovery gate passes.** The gate must evidence the WMS owner-spec snapshot/serialization contract, routing target linkage, every shared peer lock class, source lifecycle migrations, the correction provider's executable-disposition view, canonical candidate/resource/snapshot vectors, fixed cross-owner lock order, safe multi-resource guard composition and CommandBus input/result integrity. After those contracts pass review, P1.7 may be implemented and technically tested. The runtime capability gate remains default closed until every provider is compatible; no rollout decision or raw-data runbook substitutes for a missing contract.

## Changelog

### Second review remediation — 2026-08-30

- Expanded the global lock order to every mutable provider class and defined one owner `lockAndRead`/equivalent call at its assigned position, deterministic physical ordering, shared mutation serialization and stale abort for newly discovered identities.
- Corrected the WMS dependency to an explicit owner-spec prerequisite: the current owner has no public transaction-aware eligibility reader and does not yet serialize warehouse-active mutations with Site/assignment release evidence.
- Preserved the exact P1.6 `WorkCenterSnapshotV1` `updatedAt` fields and mapped them additively into P1.7 discriminated source-version evidence instead of silently changing the V1 DTO.
- Added `resourceDigestSchemaVersion` and a versioned resource-digest envelope to readiness, release, idempotency and golden-vector contracts.
- Bounded ambiguity overrides at 100 and added numeric Site-assignment, Work Centre, resource, attachment, source-version, total-row and canonical-byte limits so maximum synchronous/request budgets are testable.
- Required a prerequisite CommandBus integrity seam that preserves deliberate 4xx rejections, rejects pre-handler input transformation and discards/logs post-handler result transformation in favor of the stored success; added the stable error and interceptor mapping tests.
- Moved completed idempotent response recovery before the current capability-gate check, while retaining the gate for every new publication attempt.
- Narrowed post-commit recovery to the authoritative domain result and route-owned callback/event attempt; CommandBus tail effects are not falsely reported as resumed, enqueue errors are caught, and non-undoable responses carry no `x-om-operation` header.
- Required the correction provider to expose durable executable disposition and a transaction-aware applicability view used by overlap validation and point resolution, without moving correction writes into P1.7.
- Preserved released read/resolve surfaces during operational rollback and expanded failure/performance coverage for every corrected branch.

### Post-review contract remediation — 2026-08-30

- Added the WMS-owned `SiteEligibilitySnapshotV1` handoff, persisted Site warehouse-role/default evidence, WMS Site/warehouse lock reuse and mapping/default race coverage; `Site.updatedAt` alone is explicitly insufficient.
- Resolved the missing Work Centre/Site relationship by defining Wave 0 Work Centres as active same-organization and Site-independent, consistent with P1.6.
- Replaced unbounded occurrence/resource echoing with compact `candidateHash` plus `selectedResourceDigest` commitments and bounded stateless selection-preview pages, preserving the 256 KiB release-request cap at maximum server graph bounds.
- Split deterministic candidate/resource hashing from the final snapshot hash; readiness excludes `capturedAt`, while release uses one transaction timestamp for `releasedAt` and every final capture time.
- Corrected the global lock algorithm so the definition-family key is acquired and used before applicability, and removed unsafe one-time compare-and-lock fallbacks for mutable peers.
- Added default-closed `productionDefinitionReleaseGate` with safe reason codes and an executable correction/withdrawal provider prerequisite; procedural risk acceptance and raw data correction no longer enable release.
- Defined CommandBus post-commit recovery through the completed idempotency row, replay `skipLog`, no repeated callbacks/events and explicit persistent event emission.
- Replaced the unreachable direct-undo error expectation with `isUndoable:false`, no undo token, no affordance and audit-filter tests.
- Replaced ambiguous multi-collection detail pagination with discriminated collection subresources and scope/revision/collection-bound cursors; source versions now use discriminated tokens.
- Added idempotency branch coverage and numeric request/query/runtime budgets for the maximum supported graph.

### Follow-up architectural review corrections — 2026-08-30

- Reconciled P1.14 and attachment sequencing with the authoritative roadmap, backlog and execution plan: they remain Gate B prerequisites, while P1.7 owns no portability service, file content or document lifecycle.
- Added explicit owner-contract gates for routing product/variant linkage, WMS Site eligibility, Work Centre/resource authorization, peer source-version reads, source lifecycle migrations and public transaction-aware release-and-copy operations.
- Defined `REPEATABLE READ`, peer row-lock/compare-and-lock requirements, fixed lock order, transactional idempotency claims, applicability base-key serialization and definition-family allocation locking.
- Added an immutable peer source-version manifest and expanded readiness selection resources to cover Catalog, UoM, Site, Work Centre, resources and attachment references.
- Replaced the open-ended canonical hash description with a versioned envelope, exact ordering/normalization rules, canonical occurrence-path encoding and golden-vector requirements.
- Made source released immutability, status migrations, existing CRUD/undo/redo rejection and same-family revision allocation explicit.
- Added a production-enablement gate for the irreversible correction risk: a named governance acceptance or a separate correction/withdrawal capability is required before enabling release in production.

### Architectural review corrections — 2026-08-30

- Required the standard mutation-guard registry to run for every root BOM, child BOM and routing draft mutated by release, with deterministic per-resource identities, version headers, transformation composition and post-commit callbacks; missing public multi-resource composition support now blocks implementation.
- Preserved standard guard status/body semantics so record-lock conflicts continue through the shared conflict UI instead of being hidden behind a release-specific error.
- Added complete normalized persistence of the P1.6 `WorkCenterSnapshotV1`, including Work Centre and resource identities, active states, accepted versions, capture time and hash coverage.
- Resolved the P1.6 resource-free-policy handoff by failing closed when a referenced Work Centre has no active same-scope resource membership in Wave 0.
- Defined release as a standard CommandBus operation whose handler omits `undo`, produces no undo token, is absent from `undoableOnly` results and exposes no first-party Undo affordance.
- Added guard, locked-child/routing, empty-membership, full Work Centre snapshot, audit/non-undoable and historical-read coverage to acceptance criteria, risks and the implementation plan.
- Replaced the premature no-findings compliance wording with a conditional verdict that requires discovery evidence and re-review before implementation.

### Final re-review — 2026-08-30

- **Reviewer**: Agent, with fresh-context scope-cohesion review
- **Security**: Passed; explicit scope columns now cover every mutable and immutable row
- **Performance**: Passed with the existing maximum-bound implementation gate
- **Cache**: Passed — no cache is introduced
- **Commands**: Passed
- **Risks**: Passed; correction remains a documented residual rollout risk rather than a hidden P1.7 dependency
- **Scope cohesion**: Passed; P1.7 remains one publication capability, while P1.14 portability and correction/withdrawal are independent roadmap concerns
- **Remaining findings**: Public transaction-aware aggregate operations and safe multi-resource guard composition still require discovery evidence and re-review before implementation
- **Verdict**: Conditionally approved as a design after review corrections; not implementation-ready until every named public contract is evidenced

### Review — 2026-08-30

- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed with maximum-bound implementation gate
- **Cache**: Passed — no cache is introduced
- **Commands**: Passed
- **Risks**: Passed
- **Reversibility**: Conditional; immutable evidence is sound, but erroneous occupied windows have no P1.7 correction path
- **Scope cohesion**: Passed by fresh-context review
- **Verdict**: Conditionally approved as a design; implementation remains gated only by technical prerequisite discovery, while broader rollout policy is external

### 2026-08-30

- Separated P1.7 implementation completion from independent P1.14 portability and correction/withdrawal rollout governance; neither external capability is now presented as part of the P1.7 completion contract.
- Made tenant and organization scope columns explicit on every mutable and immutable P1.7 row.
- Added the required Overview, frontend architecture contract, canonical UI/API/event mechanisms, operational risk detection and full compliance matrix.
- Clarified that BOM/Routing lifecycle mutation remains aggregate-owned behind public transaction-aware operations; missing shared-transaction support blocks P1.7 instead of permitting private coupling.
- Replaced the premature fully-compliant verdict with evidence-based implementation and production-enablement gates.
- Added the missing correction-risk contract for erroneous immutable windows, precise ACL/idempotency/event metadata, bounded read DTO envelopes and a concrete readiness-finding schema.
- Clarified that ambiguous child selection applies to every multi-eligible family and aligned the truncated-findings error with the release action.

- Consolidated the formerly separate business-requirements companion into this single P1.7 source of truth and updated portfolio references.
- Closed the architecture review gaps for explicit occurrence-to-revision selection, released-child reuse, exact BOM/routing compatibility and multi-resource concurrency.
- Added atomic next-draft creation without introducing successor/supersession semantics.
- Corrected persistent-event guarantees to distinguish durable subscriber retry from the non-transactional post-commit enqueue window.
- Added provider-unavailable errors, event-failure tests, market-rationale linkage and consumer-owned polling/read-comparison recovery.
- Defined the Wave 0 atomic release and immutable-snapshot contract.
- Reduced scope to one publication capability: readiness, atomic release with mechanical next-draft continuity, released reads/resolution, a typed event contract and minimal operator UI.
- Removed persisted definition drafts, successor/withdrawal lifecycle, downstream claims and feature-specific dispatch infrastructure.
- Replaced derived supersession intervals with explicit non-overlapping released windows.
