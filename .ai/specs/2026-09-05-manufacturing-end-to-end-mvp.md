# Manufacturing End-to-End MVP

## TLDR

The first Open Source Manufacturing release must deliver one narrow but complete production flow: define a direct-level BOM, release it, create and release a single-step production order, issue its direct materials through the existing WMS commands, receive the finished output, and record compensating corrections for incorrect stock postings.

This MVP becomes the active delivery focus. It does not require changes to Catalog UoM behavior, WMS precision/schema, WMS Site topology, or a new atomic posting-group contract. The accepted Manufacturing roadmap and P1 splits remain follow-on backlog, but no cross-module foundation refactor may block the first release.

## Overview

The current Wave 0 architecture correctly describes the contracts required for a broad discrete-manufacturing foundation, but implementing its full Gate A, Gate B, and Gate C scope before releasing anything would delay user validation. Shipping BOM authoring alone would shorten delivery but would expose only definition master data, not a usable Manufacturing outcome.

The MVP therefore takes a thin vertical slice through the existing P1 workstreams. It does not replace their ownership boundaries or detailed designs. It selects the smallest subset that lets an operator convert physical input stock into finished-goods stock through an auditable production order.

## Problem Statement

A BOM-only release cannot answer whether Open Mercato can execute production. Conversely, the complete Wave 0 backlog includes several independently valuable capabilities that are not required to prove the first production transaction. Treating all of them as one MVP combines authoring, engineering control, shop-floor modelling, production accounting, and advanced stock orchestration into a release too broad for early OSS validation.

The programme needs one explicit release boundary that is both commercially understandable and operationally safe.

## Why We Changed the Delivery Strategy

The earlier analysis remains valuable, but it answers a different question: what architecture and capabilities may be required for a broad, durable discrete-manufacturing product. It does not prove which of those capabilities OSS users need first, which workflow variants they will accept, or where Open Mercato creates the most immediate business value.

Two tempting delivery strategies both postpone that learning:

- releasing BOM authoring alone validates data entry but not production execution or inventory impact;
- implementing the complete Wave 0 design validates a large architecture only after substantial cross-module investment.

The selected strategy reduces the time and cost required to validate the core product hypothesis. It deliberately accepts a smaller supported operating envelope and current Catalog/WMS limitations so the team can observe a real production transaction before changing shared platform contracts.

This is not a claim that Site, exact UoM normalization, atomic posting groups, routing, backflush, or the other roadmap capabilities are unnecessary. It is a sequencing decision: evidence from a working end-to-end flow should determine which of them creates the next highest-value increment.

## Business Hypothesis and Learning Goals

### Hypothesis

Small and medium discrete-production teams can obtain useful value from Open Mercato when they can define a product structure, release a simple production order, consume real component stock, receive finished stock, and recover from an operational error in one understandable workflow.

### What the MVP must prove

- A user can complete the flow without maintaining routing, Work Centers, planning, or advanced manufacturing master data.
- Existing Catalog and WMS capabilities are sufficient for a deliberately restricted first operating profile.
- The BOM-to-order snapshot is understandable and trusted when master data later changes.
- Inventory effects are visible, repeatable without duplication, and operationally recoverable despite the current per-command WMS boundary.
- The module produces enough value that users return to create and execute additional orders rather than treating it as a one-time demo.

### What the MVP is not trying to prove

- suitability for every manufacturing model or enterprise organization;
- full engineering change control, production planning, capacity optimization, shop-floor automation, quality, costing, or genealogy;
- that current Catalog/WMS limitations are the correct final platform contracts;
- the final priority or packaging of the remaining Wave 0 capabilities.

## Expected Business Outcome

The release should create a complete, demonstrable result: physical component stock is converted into finished stock through a production order with readable evidence. This gives maintainers and adopters something they can evaluate in operational terms rather than reviewing isolated master-data screens or architecture documents.

The intended programme outcomes are:

- earlier feedback from real users and implementation partners;
- lower initial delivery risk and fewer simultaneous module changes;
- a smaller migration and compatibility surface before product-market evidence exists;
- concrete usage data and support questions that inform the next investment;
- preservation of the larger roadmap without prematurely committing to its delivery order.

## Proposed Solution

Deliver one single-step, direct-material production flow over existing Catalog and WMS behavior. Reuse the existing P1 ownership boundaries, but implement only the Manufacturing-owned MVP profiles defined here. Keep all cross-module foundation changes and broader P1 specifications as additive follow-on work after MVP acceptance.

The MVP is one product outcome even though implementation crosses several module-owned contracts. BOM authoring supplies the order definition, the order supplies production intent, and WMS postings supply the physical result. Intermediate work may merge behind disabled or incomplete capability boundaries, but the OSS Manufacturing MVP is announced only after the complete acceptance scenario passes.

### Design decisions

| Decision | MVP rule | Why |
|---|---|---|
| Release boundary | One end-to-end production transaction | A definition-only release does not validate Manufacturing value. |
| Production model | Discrete, selected existing warehouses, single step | Proves production without Site, routing, scheduling, or capacity modelling. |
| Material model | Direct BOM lines only for execution | Avoids recursive explosion and child-order orchestration in the first flow. |
| Quantity model | Current Catalog/WMS behavior with a deliberately restricted compatibility profile | Avoids changing shared UoM and precision contracts for MVP. |
| Inventory model | Existing `wms.inventory.adjust` and `wms.inventory.receive` commands | Reuses working WMS behavior without adding production vocabulary or APIs to WMS. |
| Correction model | Correlated compensating movements using existing WMS commands | Enables operational recovery without requiring a new WMS reversal contract. |
| Delivery model | Existing P1 workstreams provide profiled inputs | Preserves reviewed ownership and avoids a competing architecture. |

### Alternatives considered

| Alternative | Decision |
|---|---|
| Release BOM authoring first | Rejected as the MVP product boundary. It remains implementation work feeding the vertical slice. |
| Deliver all existing Wave 0 Gate A-C capabilities | Deferred until after the MVP. It is coherent but too broad for the first OSS validation. |
| Add generic atomic WMS posting groups first | Deferred. Manufacturing invokes current WMS commands through the command bus and owns retry/compensation orchestration. |
| Model a routing with one synthetic operation | Rejected. The MVP order is explicitly single-step and creates no fake Work Center or routing contract. |

## MVP Outcome

An authorized user can:

1. create a direct-level BOM for a concrete Catalog variant; product-only BOM targets cannot execute in this MVP because current WMS mutations require `catalogVariantId`;
2. release an immutable BOM definition;
3. create and release a production order for a requested quantity using selected existing WMS warehouses and locations;
4. issue the calculated direct materials from WMS;
5. receive the full finished quantity into WMS;
6. inspect the persisted production and WMS evidence; and
7. compensate an incorrect issue or receipt from persisted Manufacturing and WMS evidence.

## MVP Scope

### Included capability profiles

| Existing work item | MVP profile |
|---|---|
| P1.0a | One opt-in `@open-mercato/manufacturing` package and `manufacturing` runtime module. |
| P1.4a-MVP amendment | Direct-level variant-targeted BOM authoring with stable occurrences, current Catalog/WMS inventory-unit evidence, draft integrity, optimistic locking, scope, and release readiness. It supersedes the P1.3a readiness gate for this restricted profile only. |
| P1.7 | `draft -> released` definition lifecycle and immutable direct-level snapshot; no routing or recursive child-revision selection. |
| P1.8b-MVP profile | Manufacturing-only adapter invoking existing `wms.inventory.adjust` and `wms.inventory.receive`; no WMS contract or schema change. |
| P1.9 | Minimum append-only accepted/corrected fact evidence, persistent idempotency, correlation, timestamps, and WMS posting reference. |
| P1.10 | Single-step production-order lifecycle and immutable execution snapshot; no operation entities or partial confirmation model. |
| P1.11-MVP profile | Explicit material issue through current adjustments, full finished-output receipt, retry of missing lines, and compensating correction. |
| P1.12 | End-to-end, isolation, conflict, idempotency, partial-failure recovery, disabled-module, and compensation evidence. |

P1.1, P1.2, P1.3a-c, and P1.8a do not block this MVP. This MVP baseline explicitly supersedes their prerequisite role for its restricted variant-only, same-inventory-unit execution profile. The broader contracts remain roadmap work and become prerequisites again when their wider behaviors are selected.

### Explicitly deferred until after MVP

- P1.4b recursive BOM preview/explosion and its large-tree UI/performance contract;
- P1.4c-h list perspectives, identity, collaboration history, comparison/where-used, copy, customisation, and document control;
- P1.5 routing drafts, operation definitions, instructions, and setup/run time;
- P1.6 Work Centers, resource applicability, capacity, and calendars;
- WMS Site/warehouse-role modelling, Catalog UoM normalization redesign, WMS precision/evidence migrations, and generic atomic posting groups;
- multi-level execution, `produce` child resolution at release, child orders, and automatic child-order creation;
- partial issue/output, cumulative confirmation, backflush, separate material return, scrap, `complete_short`, and over/under-production policy;
- reservation automation, MRP, finite scheduling, MES/offline replay, QMS, costing, advanced traceability, and advanced numbering;
- import/export, search, saved views, bulk actions, analytics, approvals, and segregation-of-duties policy.

Existing code or reviewed contracts for a deferred capability are preserved. They must not expand the MVP acceptance gate, UI promise, or implementation critical path.

## Architecture

The existing ownership laws remain unchanged, while the MVP prerequisite gates are narrowed as an explicit release-profile exception:

- Catalog owns product, variant, and current UoM identity. Manufacturing reads existing Catalog data and adds no Catalog resolver or API.
- Manufacturing owns BOM definitions, released snapshots, production-order intent, execution snapshots, semantic commands, and production facts.
- WMS owns existing warehouses, locations, stock balances, lots/serials, movements, and posting evidence.
- Cross-module references use scalar IDs plus immutable snapshots where history must survive master-data changes. No cross-module ORM relationship is introduced.
- Manufacturing invokes existing WMS commands through the command bus and fails stock actions closed when WMS is unavailable. It adds no route, entity, migration, enum, command, or configuration to WMS.

```text
Catalog product/UoM
        |
        v
Manufacturing released direct BOM
        |
        v
Manufacturing production order + execution snapshot
        |
        +---- per-line issue intent ----> wms.inventory.adjust (negative)
        |
        +---- output receipt intent ----> wms.inventory.receive
        |
        +---- correction intent --------> existing WMS adjust/receive-compatible compensation
                                          |
                                          v
                          WMS movements + Manufacturing correlated facts
```

### State boundaries

```text
BOM definition: draft -> released
Production order: draft -> released -> in_progress -> completed
                                  \-> cancelled before output receipt
```

- A released BOM is immutable. A later change creates a new draft revision through the existing revision contract.
- Order release freezes the BOM, quantities/UoM evidence, and selected warehouse/location IDs.
- `in_progress` begins with accepted material issue or an explicit start immediately preceding it in guarded orchestration.
- `completed` requires accepted full output receipt evidence.
- Correction creates compensating WMS movements and Manufacturing evidence and changes operational state only through a command; it never edits history.

### Commands and evidence

Every mutation uses canonical commands and mutation guards. Before each WMS call, Manufacturing persists one stable UUID intent/fact per BOM occurrence and action. That UUID is passed as the existing WMS `referenceId`, with `referenceType: 'manual'`; Manufacturing correlation remains authoritative and may be repeated in WMS `metadata`. This avoids collisions when the same variant appears more than once because current WMS idempotency includes `referenceId` but has no Manufacturing reference type. Manufacturing records progress per line, retries only missing lines after partial failure, and never marks an issue or receipt complete until all required commands succeeded.

Manufacturing command names and payloads belong to dedicated MVP implementation specifications. The WMS calls are fixed here to existing `wms.inventory.adjust` and `wms.inventory.receive`, concrete `catalogVariantId`, `referenceType: 'manual'`, a persisted unique intent UUID as `referenceId`, and existing metadata. No public WMS surface is changed.

## Data Models

This document introduces no parallel data model. P1.4a remains the BOM authoring source. Dedicated MVP specifications must define the smallest additive entities or profiles for:

- a released direct-level definition snapshot;
- a single-step production order and immutable execution snapshot;
- append-only Manufacturing fact evidence; and
- correlation to existing WMS movement evidence.

Every user-editable aggregate has `updated_at` and optimistic locking. Every scoped row carries `tenant_id` and `organization_id`. Orders store selected existing `materialWarehouseId`, `materialLocationId`, `outputWarehouseId`, and `outputLocationId` as scalar cross-module UUIDs plus readable snapshots where required. Quantity values must fit the current WMS accepted precision; the MVP does not widen or reinterpret it.

The MVP introduces no PII, credentials, or free text about people. Basic labels or instructions already present in BOM authoring retain their existing security decision; the MVP adds no sensitive field category.

## API Contracts

Dedicated implementation specifications must expose the minimum authenticated and feature-guarded APIs for:

- direct BOM create/read/update and line maintenance;
- definition release and released-definition read;
- production-order create/read/release/start/cancel with existing warehouse/location selection;
- explicit full material issue;
- full output receipt and completion;
- compensating issue or receipt correction; and
- correlated fact/evidence read.

All inputs use zod, routes export `metadata` and `openApi`, and reads/writes are tenant- and organization-scoped. Manufacturing validates referenced warehouse/location records through available WMS read contracts before mutation. CRUD-compatible resources use `makeCrudRoute`; aggregate/action routes use commands, mutation guards, optimistic-lock headers where applicable, and stable errors.

Required error classes include invalid state, stale version, insufficient eligible stock, unsupported current-WMS quantity/UoM, invalid warehouse/location selection, duplicate incompatible intent, partial issue failure, posting failure, already compensated evidence, and non-disclosing not-found/out-of-scope responses.

## UI and Internationalization

The MVP UI contains only:

- BOM list, create, and direct-level editor;
- released-definition read state and Release action;
- production-order list, create, detail, Release, Start/Issue, Receive output, Cancel, and Correct actions; and
- visible stock-posting and correction evidence.

There is no routing editor, Work Center setup, recursive preview, planning board, shop-floor terminal, bulk action, saved perspective, or analytics dashboard.

Backend pages use canonical `Page`, `DataTable`, `CrudForm`, guarded mutations, `StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `LoadingMessage`, `ErrorMessage`, `EmptyState`, and confirmation-dialog patterns. HTTP uses `apiCall` helpers. Dialogs support Cmd/Ctrl+Enter and Escape, icon-only controls have accessible labels, and all user-facing strings use module locale files.

## Delivery Plan

The MVP is implemented as testable internal increments but released as one outcome.

### Increment 1 - definition input

1. Complete P1.0a and document the current Catalog/WMS quantity compatibility envelope.
2. Finish the P1.4a variant-only, current-inventory-unit MVP profile and its isolation/concurrency evidence without waiting for P1.3a.
3. Keep P1.4b, P1.4c-h, P1.5, and P1.6 off the critical path.

### Increment 2 - release and order

1. Specify and implement the direct-only P1.7 release snapshot profile.
2. Implement the minimal P1.9 fact writer and single-step P1.10 order lifecycle.
3. Reuse current WMS warehouse/location lookup and selection without Site work.

### Increment 3 - physical execution

1. Implement the Manufacturing adapter over current `wms.inventory.adjust` and `wms.inventory.receive` commands.
2. Implement explicit per-line issue, full receipt, deterministic retries, and compensating correction.
3. Test and document partial-failure behavior without changing WMS.

### Increment 4 - acceptance and OSS release

1. Pass the complete production scenario and all P1.12 safety evidence.
2. Verify current WMS compatibility, disabled-module behavior, API/OpenAPI, UI, Manufacturing-only migrations, build, and integration tests.
3. Publish the first Manufacturing OSS MVP only when the whole flow passes.

## Acceptance Scenario

Given eligible WMS stock of `10` units of component A and `20` units of component B:

1. The user creates and releases a BOM stating that `1` output variant X requires `1` variant A and `2` variant B, all in the current WMS inventory units.
2. The user creates and releases an order for `5` X with existing material/output warehouses and locations.
3. The order snapshot preserves the BOM, current quantity/UoM values, and warehouse/location selections.
4. Explicit issue creates idempotent negative WMS adjustments totaling `5` A and `10` B and records each result.
5. Repeating the same request with the same idempotency key does not consume stock again.
6. One idempotent WMS receipt adds `5` X; after its movement ID is persisted, Manufacturing marks the order completed. A failure between those steps is recovered by retrying correlation, not by receiving stock again.
7. Repeating the receipt does not add output again.
8. An authorized correction derives compensating movements from persisted evidence; it does not recalculate from the current BOM.
9. If one material line fails after earlier lines succeeded, the order remains visibly incomplete and retry posts only missing lines.
10. Cross-tenant, cross-organization, stale-version, invalid-state, and insufficient-stock attempts fail without disclosing foreign records.

The scenario supports only quantities normalized into the same unit used by the current WMS inventory profile and demonstrably representable by its current storage/arithmetic envelope. Cross-unit execution conversion, unsupported fractional precision or magnitude, and lot/serial-controlled products are explicitly excluded. Release rejects an order outside this envelope instead of rounding or changing Catalog/WMS.

## Testing and Readiness Evidence

- Unit tests cover supported quantity calculation, lifecycle transitions, snapshot immutability, idempotency comparison, and compensation derivation.
- Integration tests create their own Catalog, warehouse, location, stock, BOM, and order fixtures and clean them up in teardown or `finally`.
- API tests cover auth, ACL, scope isolation, stale versions, invalid states, insufficient stock, duplicate calls, partial failure/retry, and correction.
- UI tests cover the happy path plus conflict, posting error, correction confirmation, loading, empty, and permission states.
- Packaging tests prove the module is opt-in and disabled routes/UI disappear.
- Integration tests use current WMS commands as-is and prove resulting balances/movements; no WMS production change or seeded data is required.
- Cache is omitted unless measured need proves otherwise. Lists remain bounded with `pageSize <= 100`; no bulk or greater-than-1,000-row foreground operation exists.

## Migration and Backward Compatibility

This roadmap change is additive and changes delivery priority, not a published contract. Existing P1 identifiers, specifications, implementation, package exports, entity IDs, routes, ACL features, event IDs, and generated registries remain intact.

Dedicated implementation specs classify every new Manufacturing contract under `BACKWARD_COMPATIBILITY.md`. New Manufacturing structures use additive migrations and reviewed snapshots. Catalog and WMS receive no MVP migration or public-contract change. Deferred, already implemented BOM behavior is preserved.

## Post-MVP Sequence

After the MVP passes, the team does not automatically resume the old roadmap in its current numerical or dependency order. It first reviews evidence from real usage and then selects the next smallest coherent capability. The earlier Wave 0 analysis remains the long-term option map and architectural guardrail, not a precommitted release queue.

The following list is illustrative, not an approved sequence:

1. partial confirmations, returns, scrap, and backflush;
2. multi-level execution and bounded recursive preview;
3. routing, operations, Work Centers, and instructions;
4. BOM usability/control P1.4c-h;
5. planning, capacity, traceability, quality, costing, MES, and specialist models.

Each selected item retains its dedicated readiness gate and receives detailed specification work only when selected.

## Post-MVP Decision Gate

Before starting the next capability, maintainers review:

- which steps block users from completing or repeating production orders;
- which manual workarounds consume the most time or create the most errors;
- whether users need multi-level production, routing, partial confirmation, backflush, planning, traceability, or another capability first;
- whether current Catalog/WMS limitations caused real failures or only theoretical constraints;
- adoption signals such as activated installations, repeated orders, completion rate, support requests, and contributor/partner demand;
- implementation cost, migration risk, cross-module blast radius, and compatibility impact.

The next capability is chosen by demonstrated business impact and risk reduction. For example:

- frequent manual material posting favors backflush or atomic posting work;
- inability to represent subassemblies favors multi-level release/execution;
- inability to coordinate shop-floor steps favors routing and Work Centers;
- shortages and late orders favor reservations or planning;
- audit/customer requirements favor traceability, quality, or costing.

If evidence is weak or contradictory, the team runs a smaller discovery experiment rather than beginning a large roadmap workstream. The decision and its evidence are recorded as a new dated roadmap update before detailed specification begins.

## Risks & Impact Review

### MVP profile diverges from broader P1 contracts

- **Scenario**: Narrow implementation invents incompatible entities or actions instead of a valid subset of accepted workstreams.
- **Severity**: High.
- **Affected area**: Definitions, orders, facts, WMS adapter, future routing and partial execution.
- **Mitigation**: Map every MVP field/action to its P1 owner, use additive evolution seams, and run adjacent-contract consistency review.
- **Residual risk**: Follow-on migrations may remain when multi-level and partial execution are selected.

### Existing WMS commands allow partial multi-line completion

- **Scenario**: One component adjustment succeeds and a later component adjustment fails because current WMS has no Manufacturing atomic posting group.
- **Severity**: Critical.
- **Affected area**: WMS balances, order state, reconciliation, customer inventory.
- **Mitigation**: Persist deterministic per-occurrence intent before calls, use existing WMS idempotency, record each returned movement, expose partial failure, retry only missing lines, and provide evidence-derived compensation. Never mark issue complete early.
- **Residual risk**: Stock may be temporarily partially issued until retry or compensation. This limitation is explicit in MVP and removed by later P1.8a atomic posting groups.

### Single-step model becomes a permanent routing shortcut

- **Scenario**: Future routing is forced into synthetic operations or existing orders cannot coexist with operation-based orders.
- **Severity**: High.
- **Affected area**: P1.5, P1.6, P1.10, confirmations, facts, reporting.
- **Mitigation**: Create no fake routing or Work Center. Keep operation correlation additive/optional and version the later execution snapshot shape.
- **Residual risk**: Mixed historical reporting will need a clear `single_step` versus routed execution-mode discriminator.

### Direct-only BOM is mistaken for multi-level support

- **Scenario**: Users expect recursive requirements or child production from draft `produce` links.
- **Severity**: Medium.
- **Affected area**: Release UI, order calculation, documentation, issue.
- **Mitigation**: Accept direct material lines only for MVP execution and label unsupported `produce` execution clearly; never silently flatten it.
- **Residual risk**: Early adopters with multi-level products must stock subassemblies manually.

### Current UoM and precision limitations

- **Scenario**: BOM quantity or conversion is valid for authoring but cannot be represented consistently by current WMS storage/arithmetic.
- **Severity**: High.
- **Affected area**: Order release and stock execution.
- **Mitigation**: Define a measured compatibility envelope, validate it before order release, reject unsupported cross-unit or fractional execution, and snapshot accepted values. Do not silently round.
- **Residual risk**: Some legitimate manufacturing quantities remain unsupported until P1.3a-c follow-on work.

### Cross-scope or stale-master interpretation

- **Scenario**: An order references a foreign warehouse/location or current Catalog/BOM data reinterprets historical postings.
- **Severity**: Critical.
- **Affected area**: All Manufacturing and WMS reads/writes.
- **Mitigation**: Scope every query, fail closed, snapshot release/execution evidence, use optimistic locking, and compensate from persisted evidence.
- **Residual risk**: Master-data deletion policy must preserve readable historical snapshots.

### Programme status becomes inconsistent

- **Scenario**: Older documents keep describing all Gate A-C capabilities as immediate MVP and teams restart deferred work.
- **Severity**: Medium.
- **Affected area**: Planning, trackers, contributor expectations, release communication.
- **Mitigation**: Link this baseline from all Manufacturing roadmap/index documents and mark existing decompositions follow-on unless included here.
- **Residual risk**: GitHub trackers require a separate maintainer-authorized update outside this documentation change.

## Final Compliance Report - 2026-09-05

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/core/AGENTS.md`
- `.ai/docs/module-development.md`
- `om-module-capability-audit` native mechanism catalogue
- `om-spec-writing` checklist and compliance guide

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root `AGENTS.md` | Preserve ownership and avoid cross-module ORM relations | Compliant | Catalog, Manufacturing, and WMS ownership is unchanged; links use IDs and snapshots. |
| Root `AGENTS.md` | Scope and optimistic locking | Compliant | Required for scoped/editable MVP records and tests. |
| Root `AGENTS.md` | Commands, guards, compensation, and canonical HTTP/UI | Compliant | Required as implementation constraints; exact contracts stay in capability specs. |
| `.ai/specs/AGENTS.md` | Explicit MVP/future scope, risks, compatibility, tests | Compliant | Existing workstreams remain post-MVP backlog. |
| `BACKWARD_COMPATIBILITY.md` | No incompatible removal/rename | Compliant | This planning change removes no surface. |
| Module capability audit | Reuse native owners and smallest safe mechanisms | Compliant | Uses current Catalog values and existing WMS commands; new behavior stays in Manufacturing. |
| Spec-writing checklist | Independently deployable capabilities are split | Compliant after review | This file is a release umbrella; implementation remains in three cohesive child contracts. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Outcome matches included P1 profiles | Pass | Every included profile supports the acceptance scenario. |
| Deferred scope is off the critical path | Pass | Routing, Work Centers, preview, partial/backflush/scrap, and usability extensions are excluded. |
| Ownership matches the roadmap | Pass | Manufacturing owns intent/facts; WMS owns stock; Catalog owns identity/UoM. |
| Risks cover stock writes | Pass | Idempotency, partial-failure state, retry, compensation, scope, and current precision limits are mandatory. |
| Compatibility with detailed specs | Pass | Existing IDs/specs remain; the MVP selects profiles rather than replacing contracts. |

### Non-Compliant Items

None at roadmap-scope level. This document does not authorize implementation: its three Manufacturing-owned child contracts still require dedicated specifications or accepted amendments and readiness evidence.

### Verdict

**Approved as the active product-scope baseline.** Not implementation-ready by itself; implementation remains gated by dedicated capability contracts and evidence.

## Relationship to the Existing Roadmap

This document is the active first-release roadmap umbrella, not one independently implementable capability specification. The existing product roadmap remains the normative long-term architecture, but this document supersedes its Site, P1.3a-c, P1.8a, atomic-posting, and exact-reversal prerequisites for the restricted MVP profile only. Existing P1 identifiers and detailed specs remain intact as inputs or post-MVP capability work; they are not deleted or renumbered.

Implementation remains split into cohesive Manufacturing-owned specifications or amendments for: direct BOM/release; single-step order and facts; and the adapter/execution/correction flow over current WMS commands. These children compose into one release acceptance scenario, but none may broaden its scope to refactor Catalog or WMS.

## Changelog

- 2026-09-05: Created the active end-to-end OSS MVP boundary after product-scope review concluded that BOM-only delivery was not a usable Manufacturing module and full Wave 0 was too broad for the first release.
- 2026-09-05: Added the business hypothesis, learning goals, expected outcomes, and evidence-based post-MVP decision gate; clarified that the earlier Wave 0 analysis is a long-term option map rather than a committed delivery sequence.

### Review - 2026-09-05

- **Reviewer**: Codex self-review plus fresh-context scope review.
- **Security**: Passed at roadmap level; stock specs must prove scoped calls, deterministic retry, and compensation.
- **Performance**: Passed; recursive preview, bulk work, caching, and large foreground operations are outside MVP.
- **Cache**: N/A; omitted pending measured need.
- **Commands**: Passed at roadmap level; mutations are assigned to commands and guards.
- **Risks**: Passed; stock integrity, profile divergence, future routing, direct-only expectations, scope, and programme drift are covered.
- **Verdict**: **SPLIT for implementation, KEEP as the release-roadmap umbrella.** Three child contracts are required; no Catalog/WMS change is allowed in them.
