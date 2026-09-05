# Manufacturing End-to-End MVP

## TLDR

The first Open Source Manufacturing release must deliver one narrow but complete production flow: define and inspect a bounded multi-level BOM, release its immutable occurrence tree, create and release a single-step production order, issue that order's direct components through a guarded WMS posting port, receive the finished output, and record compensating corrections for incorrect stock postings.

This MVP becomes the proposed active delivery focus. It does not require changes to Catalog UoM behavior, WMS quantity columns/arithmetic, WMS Site topology, or a new atomic posting-group contract. It requires one additive, typed WMS posting port and one partial unique correlation index over existing movement columns so Manufacturing does not depend on internal command payloads, bypass WMS mutation guards, or race incompatible intent replays. The accepted Manufacturing roadmap and P1 splits remain follow-on backlog, but no broader cross-module foundation refactor may block the first release.

## Overview

The current Wave 0 architecture correctly describes the contracts required for a broad discrete-manufacturing foundation, but implementing its full Gate A, Gate B, and Gate C scope before releasing anything would delay user validation. Shipping BOM authoring alone would shorten delivery but would expose only definition master data, not a usable Manufacturing outcome.

The MVP therefore takes a thin vertical slice through the existing P1 workstreams. It does not replace their ownership boundaries or detailed designs. It selects the smallest subset that lets an operator convert physical input stock into finished-goods stock through an auditable production order.

This is deliberately a **CRUD-first product slice**, not a complete manufacturing domain engine. The first release establishes understandable, extensible BOM and production-order records plus one manually driven stock-affecting happy path. It protects tenancy, authorization, concurrency, inventory integrity, and duplicate posting because those concerns are expensive to repair after adoption, but it does not attempt to encode every valid production policy or operational exception before users validate the workflow.

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

The primary job is to replace the disconnected spreadsheet-or-memory workflow in which a team keeps its BOM outside Open Mercato and then enters unrelated manual WMS adjustments after production. The expected improvement is one traceable record connecting what the team intended to make with the component and finished-stock movements it posted, reducing duplicate entry and making a posting mistake recoverable by the operator who made it.

### First user profile

The first intended user is a small or medium assembly-oriented team that already manages products and stock in Open Mercato, produces a discrete finished variant from stocked component variants, and can operate with one manually controlled production step. Its product structure includes at least one stocked subassembly reused by a parent product, so the team needs to inspect and freeze a bounded multi-level definition even though each order executes only one level. The team chooses existing warehouses and locations, issues all required direct materials explicitly, receives the full planned output, and does not require routing, Work Centers, scheduling, lots/serials, partial confirmations, automatic subassembly orders, costing, or regulatory genealogy for this first workflow.

### What the MVP must prove

- A user can complete the flow without maintaining routing, Work Centers, planning, or advanced manufacturing master data.
- Existing Catalog and WMS capabilities are sufficient for a deliberately restricted first operating profile.
- The BOM-to-order snapshot is understandable and trusted when master data later changes.
- A user can inspect a parent product and stocked subassembly in one bounded tree without requiring automatic child-order execution.
- Inventory effects are visible, repeatable without duplication, and operationally recoverable despite the current per-command WMS boundary.
- The module produces enough value that users return to create and execute additional orders rather than treating it as a one-time demo.
- Pilot users report less spreadsheet/manual-adjustment duplication and can identify the production order behind each tested stock movement.

### What the MVP is not trying to prove

- suitability for every manufacturing model or enterprise organization;
- full engineering change control, production planning, capacity optimization, shop-floor automation, quality, costing, or genealogy;
- that current Catalog/WMS limitations are the correct final platform contracts;
- the final priority or packaging of the remaining Wave 0 capabilities.
- exhaustive domain validation for production models and policies outside the declared first-user profile.

### Product-learning decision criteria

The MVP is successful enough to justify another Manufacturing increment when evidence shows all of the following during the agreed validation cohort or pilot period:

- at least three independent organizations complete the end-to-end scenario without a custom Manufacturing code fork;
- at least two organizations create and complete a second production order after their first successful order;
- at least 80% of validation orders that reach `in_progress` are completed through the supported UI during the pre-recorded pilot period, excluding only orders deliberately created as error fixtures;
- every deliberately exercised duplicate-call, posting-failure, and correction scenario is recoverable through the supported UI without database or custom-code intervention; and
- maintainers can identify the next investment from repeated observed blockers or requests rather than from roadmap numbering alone.

These are product-learning thresholds, not a public service-level objective or a permanent product KPI. Before release validation starts, maintainers may record a different cohort size or period, but they must not retrospectively redefine success after seeing the result.

### Delivery classification

| Class | Included in the first release | Rationale |
|---|---|---|
| User-visible pilot minimum | BOM and order CRUD, bounded tree inspection, release, manual full issue, manual full receipt, evidence view, and operator-triggered correction | This is the smallest flow that replaces the spreadsheet plus unrelated WMS-adjustment workaround. |
| Day-one integrity floor | Tenant/organization scope, ACL, optimistic locking, WMS mutation guards, stable action idempotency, persisted posting references, retry of only missing issue lines, and reconciliation of the WMS-commit/local-save crash window | A pilot that can silently duplicate or orphan real stock movements cannot produce trustworthy business learning. These are stock-integrity safeguards, not broader manufacturing-domain modelling. |
| Post-MVP reliability and policy | Automatic background retry, scheduled reconciliation, alerts, generic sagas/posting groups, configurable transition policy, partial production, and every deferred production option listed below | These improve scale or operating breadth but are not required for the manually supervised pilot. |

The day-one integrity floor stays mandatory because the walkthrough changes real inventory. It must be implemented narrowly for issue, receipt, and correction only; it is not permission to build a reusable workflow, policy, or reliability platform.

## Expected Business Outcome

The release should create a complete, demonstrable result: physical component stock is converted into finished stock through a production order with readable evidence. This gives maintainers and adopters something they can evaluate in operational terms rather than reviewing isolated master-data screens or architecture documents.

The intended programme outcomes are:

- earlier feedback from real users and implementation partners;
- lower initial delivery risk and fewer simultaneous module changes;
- a smaller migration and compatibility surface before product-market evidence exists;
- concrete usage data and support questions that inform the next investment;
- preservation of the larger roadmap without prematurely committing to its delivery order.

## Proposed Solution

Deliver one single-step production flow over existing Catalog and WMS behavior, backed by a bounded multi-level BOM definition. Reuse the existing P1 ownership boundaries, but implement only the Manufacturing-owned MVP profiles defined here. Keep all cross-module foundation changes and broader P1 specifications as additive follow-on work after MVP acceptance.

The MVP is one product outcome even though implementation crosses several module-owned contracts. BOM authoring supplies the order definition, the order supplies production intent, and WMS postings supply the physical result. Intermediate work may merge behind disabled or incomplete capability boundaries, but the OSS Manufacturing MVP is announced only after the complete acceptance scenario passes.

The implementation bias is intentionally simple: use conventional CRUD resources for editable master and order data, keep the first state model small, and add action commands only where a stock effect or immutable release boundary requires one. Models and APIs should remain additively extensible, but the MVP must not pre-build generalized policy engines, configurable transition frameworks, routing abstractions, automatic orchestration, or option matrices for deferred production modes.

### Design decisions

| Decision | MVP rule | Why |
|---|---|---|
| Release boundary | One end-to-end production transaction | A definition-only release does not validate Manufacturing value. |
| Production model | Discrete, selected existing warehouses, single step | Proves production without Site, routing, scheduling, or capacity modelling. |
| Material model | Multi-level definition and snapshot; each order executes only its own revision's direct occurrences | Represents real subassemblies without recursive execution or automatic child-order orchestration. |
| Quantity model | Current Catalog/WMS behavior with a deliberately restricted compatibility profile | Avoids changing shared UoM and precision contracts for MVP. |
| Inventory model | Additive typed WMS posting port implemented over current inventory commands | Reuses working WMS behavior while preserving WMS guards, production semantics, and compile-time contract checks. |
| Correction model | Correlated compensating movements through the same typed WMS port | Enables operational recovery without requiring a generic atomic posting-group or reversal framework. |
| Delivery model | Existing P1 workstreams provide profiled inputs | Preserves reviewed ownership and avoids a competing architecture. |
| Domain depth | Extensible CRUD plus one explicit manual workflow | Validates usefulness before encoding broader production policy. |

### Alternatives considered

| Alternative | Decision |
|---|---|
| Release BOM authoring first | Rejected as the MVP product boundary. It remains implementation work feeding the vertical slice. |
| Deliver all existing Wave 0 Gate A-C capabilities | Deferred until after the MVP. It is coherent but too broad for the first OSS validation. |
| Add generic atomic WMS posting groups first | Deferred. Manufacturing invokes the narrow typed WMS posting port and owns retry/compensation orchestration. |
| Model a routing with one synthetic operation | Rejected. The MVP order is explicitly single-step and creates no fake Work Center or routing contract. |

## MVP Outcome

An authorized user can:

1. create a direct-level normalized BOM revision for a concrete Catalog variant, link `produce` occurrences to child BOMs, and inspect the bounded multi-level tree; product-only executable targets remain unsupported because current WMS mutations require `catalogVariantId`;
2. release an immutable multi-level BOM definition with the selected child revisions and occurrence paths frozen;
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
| P1.4a/P1.4b-MVP profile | Direct-level normalized, variant-targeted BOM authoring plus bounded multi-level preview, stable occurrences, child resolution, cycle safety, current Catalog/WMS inventory-unit evidence, optimistic locking, and scope. It supersedes the P1.3a readiness gate for this restricted profile only. |
| P1.7 | `draft -> released` definition lifecycle and immutable multi-level occurrence snapshot with deterministic child-revision selection; no routing. |
| P1.8b-MVP profile | Manufacturing adapter resolving an additive typed WMS posting port. WMS owns the guarded physical posting implementation; existing quantity columns and arithmetic stay unchanged, with one additive partial unique correlation index for intent safety. |
| P1.9 | Minimum append-only accepted/corrected fact evidence, persistent idempotency, correlation, timestamps, and WMS posting reference. |
| P1.10 | Single-step production-order lifecycle, optional explicit parent-order reference, and immutable multi-level execution snapshot; each order executes only its top-level revision's direct occurrences, with no operation entities or partial confirmation model. |
| P1.11-MVP profile | Explicit material issue through current adjustments, full finished-output receipt, retry of missing lines, and compensating correction. |
| P1.12 | End-to-end, isolation, conflict, idempotency, partial-failure recovery, disabled-module, and compensation evidence. |

P1.1, P1.2, P1.3a-c, and P1.8a do not block this MVP. This MVP baseline explicitly supersedes their prerequisite role for its restricted variant-only, same-inventory-unit execution profile. The broader contracts remain roadmap work and become prerequisites again when their wider behaviors are selected.

### Explicitly deferred until after MVP

- P1.4c-h list perspectives, identity, collaboration history, comparison/where-used, copy, customisation, and document control;
- P1.5 routing drafts, operation definitions, instructions, and setup/run time;
- P1.6 Work Centers, resource applicability, capacity, and calendars;
- WMS Site/warehouse-role modelling, Catalog UoM normalization redesign, WMS precision/evidence migrations, and generic atomic posting groups beyond the narrow typed MVP port;
- recursive descendant execution inside one order, automatic child-order creation, MRP-driven order networks, phantom flattening, and direct issue between orders;
- partial issue/output, cumulative confirmation, backflush, separate material return, scrap, `complete_short`, and over/under-production policy;
- reservation automation, MRP, finite scheduling, MES/offline replay, QMS, costing, advanced traceability, and advanced numbering;
- import/export, search, saved views, bulk actions, analytics, approvals, and segregation-of-duties policy.

Existing code or reviewed contracts for a deferred capability are preserved. They must not expand the MVP acceptance gate, UI promise, or implementation critical path.

### Deliberate operating constraints

The following constraints are part of the MVP offer, not defects to hide with speculative domain logic:

- one production order represents one manually controlled production step;
- the operator issues the complete direct material set and receives the complete planned output;
- subassemblies are consumed as stocked variants; producing them requires a separate manually created order;
- no partial production, automatic child-order network, routing, capacity, lot/serial, scrap, backflush, substitution, or cross-unit conversion is inferred;
- the operator selects valid existing warehouses and locations and controls when each action is invoked; and
- unsupported cases fail with a clear boundary message rather than activating a generalized policy or configuration mechanism.

Only invariants required to prevent cross-scope access, stale overwrites, duplicate stock postings, or unrecoverable inventory corruption are first-release blockers. Richer business-policy validation is deferred until real usage demonstrates which rule is needed.

## Architecture

The existing ownership laws remain unchanged, while the MVP prerequisite gates are narrowed as an explicit release-profile exception:

- Catalog owns product, variant, and current UoM identity. Manufacturing reads existing Catalog data and adds no Catalog resolver or API.
- Manufacturing owns BOM definitions, released snapshots, production-order intent, execution snapshots, semantic commands, and production facts.
- WMS owns existing warehouses, locations, stock balances, lots/serials, movements, and posting evidence.
- Cross-module references use scalar IDs plus immutable snapshots where history must survive master-data changes. No cross-module ORM relationship is introduced.
- Manufacturing resolves the typed WMS posting port through DI and fails stock actions closed when WMS or the port is unavailable. The WMS-owned adapter applies the same pre-command mutation guards as WMS API writes, delegates to an existing inventory command, and runs requested `afterSuccess` callbacks only after that command commits. The MVP adds no WMS route, entity, column, arithmetic change, or configuration. Its WMS additions are the typed port, production posting discriminator, and one partial unique correlation index over existing movement columns.

```text
Catalog product/UoM
        |
        v
Manufacturing released multi-level BOM occurrence tree
        |
        v
Manufacturing production order + execution snapshot
        |
        +---- per-line issue intent ----> typed WMS posting port -> adjust (negative)
        |
        +---- output receipt intent ----> typed WMS posting port -> receive
        |
        +---- correction intent --------> typed WMS posting port -> compensation
                                          |
                                          v
                          WMS movements + Manufacturing correlated facts
```

### State boundaries

```text
BOM definition: draft -> released
Production order: draft -> released -> in_progress -> completed
                    \-> cancelled     \-> correction_pending -> in_progress
                    in_progress/completed -> cancellation_pending -> cancelled
```

- A released BOM is immutable. A later change creates a new draft revision through the existing revision contract.
- Order release freezes the BOM, quantities/UoM evidence, and selected warehouse/location IDs.
- `in_progress` begins with the first accepted material issue. The MVP has no separate start command or start endpoint.
- `completed` requires a complete accepted, uncompensated direct-material issue set plus accepted full-output receipt evidence that has not been compensated.
- Cancellation from `draft` or `released` is immediate. Cancellation after any accepted stock effect first enters `cancellation_pending`; the command reaches `cancelled` only after every uncompensated issue and receipt has an accepted compensating movement. A failed compensation leaves the order non-terminal and visibly recoverable.
- Receipt is allowed only after every required direct occurrence in the current issue attempt has an accepted, uncompensated issue fact. Correcting material is forbidden while an uncompensated output receipt exists. After output compensation, an issue attempt may be compensated line by line, but replacement issue and receipt remain blocked until the entire attempt is compensated and the order returns to `released`; the next full issue uses a new attempt and new intents. Correcting the completed output receipt moves the order through `correction_pending` to `in_progress`; it may be received again with a new intent. Correction never edits history.

### Commands and evidence

Every mutation uses canonical commands and mutation guards. Before physical posting, Manufacturing persists a stable issue intent per BOM occurrence and issue-attempt number, one output-receipt intent per order receipt attempt, or one correction intent per original WMS movement. A new full issue after compensation creates a new attempt and new intent UUIDs. The typed WMS port accepts that UUID as its idempotency/correlation key and records a production-specific reference discriminator; normal production movements must never be classified as `manual`. Manufacturing records progress per intent, retries only missing intents after partial failure, and never marks an issue, receipt, cancellation, or correction complete until all required postings succeeded.

The WMS-owned port is an additive public contract with typed issue, receipt, and compensation inputs and a typed result containing the stable movement ID, accepted quantity, posting timestamp, idempotent-replay flag, and correlation key. It validates tenant/organization scope, warehouse/location eligibility, inventory-profile restrictions, mutation guards, and incompatible replay before delegating to current `wms.inventory.adjust` or `wms.inventory.receive` handlers. Manufacturing resolves it softly through DI and does not import WMS business logic. Exact names, schemas, and the production reference discriminator are frozen by the inventory-execution child specification before implementation.

If WMS commits but Manufacturing fails before persisting the result, retry uses the same intent UUID. The port returns the original movement, and Manufacturing reconciles it into the pending fact before changing order state. It must never create a second movement merely because local result persistence failed.

## Data Models

This document introduces no parallel data model. P1.4a remains the BOM authoring source. Dedicated MVP specifications must define the smallest additive entities or profiles for:

- a released multi-level definition snapshot with selected child revisions and occurrence paths;
- a single-step production order and immutable execution snapshot;
- append-only Manufacturing fact evidence; and
- correlation to existing WMS movement evidence.

Every user-editable aggregate has `updated_at` and optimistic locking. Every scoped row carries `tenant_id` and `organization_id`. Orders store selected existing `materialWarehouseId`, `materialLocationId`, `outputWarehouseId`, and `outputLocationId` as scalar cross-module UUIDs plus readable snapshots where required. Quantity values must fit the current WMS accepted precision; the MVP does not widen or reinterpret it.

The MVP introduces no PII, credentials, or free text about people. Basic labels or instructions already present in BOM authoring retain their existing security decision; the MVP adds no sensitive field category.

## API Contracts

Dedicated implementation specifications must expose the minimum authenticated and feature-guarded APIs for:

- direct-line BOM create/read/update and line maintenance plus bounded multi-level preview;
- definition release and released-definition read;
- production-order create/read/release/cancel with existing warehouse/location selection;
- explicit full material issue;
- full output receipt and completion;
- compensating issue or receipt correction; and
- correlated fact/evidence read.

All inputs use zod, routes export `metadata` and `openApi`, and reads/writes are tenant- and organization-scoped. Manufacturing validates referenced warehouse/location records through available WMS read contracts before mutation. The WMS posting port revalidates trusted scope, location ownership, inventory-profile eligibility, and active mutation guards at the physical-write boundary. CRUD-compatible resources use `makeCrudRoute`; aggregate/action routes use commands, mutation guards, optimistic-lock headers where applicable, and stable errors.

Required error classes include invalid state, stale version, insufficient eligible stock, unsupported current-WMS quantity/UoM, invalid warehouse/location selection, duplicate incompatible intent, partial issue failure, posting failure, already compensated evidence, and non-disclosing not-found/out-of-scope responses.

## UI and Internationalization

The MVP UI contains only:

- BOM list, create, direct-line editor, and bounded multi-level preview;
- released-definition read state and Release action;
- production-order list, create, detail, Release, Start/Issue, Receive output, Cancel, and Correct actions; and
- visible stock-posting and correction evidence.

There is no routing editor, Work Center setup, automatic order-network view, planning board, shop-floor terminal, bulk action, saved perspective, or analytics dashboard.

Backend pages use canonical `Page`, `DataTable`, `CrudForm`, guarded mutations, `StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `LoadingMessage`, `ErrorMessage`, `EmptyState`, and confirmation-dialog patterns. HTTP uses `apiCall` helpers. Dialogs support Cmd/Ctrl+Enter and Escape, icon-only controls have accessible labels, and all user-facing strings use module locale files.

## Delivery Plan

The MVP is implemented as testable internal increments but released as one outcome.

### Increment 1 - definition input

1. Complete P1.0a and document the current Catalog/WMS quantity compatibility envelope.
2. Finish the P1.4a variant-only, current-inventory-unit MVP profile and its isolation/concurrency evidence without waiting for P1.3a.
3. Finish the bounded P1.4b multi-level preview profile and keep P1.4c-h, P1.5, and P1.6 off the critical path.

### Increment 2 - release and order

1. Specify and implement the P1.7 multi-level occurrence snapshot profile with deterministic child-revision selection.
2. Implement the minimal P1.9 fact writer and single-step P1.10 order lifecycle.
3. Reuse current WMS warehouse/location lookup and selection without Site work.

### Increment 3 - physical execution

1. Add the narrow typed WMS posting port and implement the Manufacturing adapter over it; the port delegates to current `wms.inventory.adjust` and `wms.inventory.receive` commands behind WMS guards.
2. Implement explicit per-line issue, full receipt, deterministic retries, and compensating correction.
3. Test and document partial-failure behavior without changing WMS.

### Increment 4 - acceptance and OSS release

1. Pass the complete production scenario and all P1.12 safety evidence.
2. Verify current WMS compatibility, disabled-module behavior, API/OpenAPI, UI, Manufacturing migrations, the additive WMS production-correlation index migration and snapshot, build, and integration tests.
3. Publish the first Manufacturing OSS MVP only when the whole flow passes.

## Acceptance Scenario

### Business walkthrough

An operator creates a BOM for finished variant X, reviews its component tree, releases it, creates an order for five units, issues the direct stocked components, receives five units of X, and can see both the production record and resulting WMS movements. Repeating an already accepted action does not duplicate stock. If the operator posts the wrong issue or receipt, the UI provides a visible compensating action without database intervention.

The scenario is accepted from the user's perspective only when the operator can complete it through the supported UI using ordinary business labels and without understanding intent UUIDs, command names, movement internals, or the wider Wave 0 architecture.

### Technical evidence fixture

Given eligible WMS stock of `5` units of stocked subassembly S and `20` units of component B:

1. The user creates and releases a child BOM stating that `1` subassembly S requires `2` units of component A, then creates a parent BOM stating that `1` output variant X requires `1` `produce` occurrence of S and `2` units of variant B, all in the current WMS inventory units.
2. The user inspects the bounded multi-level tree and releases the parent definition, freezing the selected S revision and complete occurrence paths.
3. The user creates and releases an order for `5` X with existing material/output warehouses and locations. The order snapshot preserves the complete tree, current quantity/UoM values, and warehouse/location selections, but its execution set contains only direct occurrences S and B.
4. Explicit issue creates idempotent negative WMS adjustments totaling `5` S and `10` B and records each result; it does not consume A through the parent order.
5. Repeating the same request with the same idempotency key does not consume stock again.
6. One idempotent WMS receipt adds `5` X; after its movement ID is persisted, Manufacturing marks the order completed. A failure between those steps is recovered by retrying correlation, not by receiving stock again.
7. Repeating the receipt does not add output again.
8. An authorized correction derives compensating movements from persisted evidence; it does not recalculate from the current BOM. A corrected output moves the order back to `in_progress`, while cancellation after any stock effect becomes terminal only after all required compensation succeeds.
9. If one material line fails after earlier lines succeeded, the order remains visibly incomplete and retry posts only missing lines.
10. Cross-tenant, cross-organization, stale-version, invalid-state, and insufficient-stock attempts fail without disclosing foreign records.

The scenario supports only canonical positive whole-number strings in the same inventory unit used by the current Catalog variant and WMS profile. Every input, calculated occurrence, existing affected WMS balance, posted delta, and resulting balance must be an integer from `0` through `999999999999` as appropriate for the operation. Manufacturing performs scaling and yield calculations with exact decimal-string operations, never JavaScript `number`, and accepts the result only when it is a whole number inside that envelope. Current WMS then performs only safe integer addition/subtraction within the same bound. The restricted MVP profile owns this current-unit validation and may reuse a shared exact-decimal helper, but it does not call or require the broader Catalog conversion/rounding resolver from P1.3a. Cross-unit conversion, fractional inputs or results, overflow, and lot/serial-controlled variants are rejected before definition release, order release, and physical posting.

## Testing and Readiness Evidence

- Unit tests cover supported quantity calculation, lifecycle transitions, snapshot immutability, idempotency comparison, and compensation derivation.
- Integration tests create their own Catalog, warehouse, location, stock, BOM, and order fixtures and clean them up in teardown or `finally`.
- API tests cover auth, wildcard-aware Manufacturing and WMS ACL, trusted actor provenance, scope isolation, stale versions, invalid states, quantity-envelope boundaries, insufficient stock, concurrent duplicate and incompatible calls, partial failure/retry, receipt blocked before complete issue, cancellation after issue and after receipt, mixed correction state transitions, and compensation failure.
- UI tests cover the happy path plus conflict, posting error, correction confirmation, loading, empty, and permission states.
- Packaging tests prove the module is opt-in and disabled routes/UI disappear.
- Integration tests prove the WMS port runs mutation guards and preserves production semantics. A dedicated crash-window test commits a WMS movement, fails Manufacturing result persistence, retries the same intent, and proves one movement plus one reconciled fact. No seeded data is required.
- Cache is omitted unless measured need proves otherwise. Lists remain bounded with `pageSize <= 100`; no bulk or greater-than-1,000-row foreground operation exists.

## Migration and Backward Compatibility

This roadmap change is additive and changes delivery priority, not a published contract. Existing P1 identifiers, specifications, implementation, package exports, entity IDs, routes, ACL features, event IDs, and generated registries remain intact.

Dedicated implementation specs classify every new contract under `BACKWARD_COMPATIBILITY.md`. New Manufacturing structures use additive migrations and reviewed snapshots. Catalog receives no MVP change. WMS receives one additive typed posting-port contract, production reference discriminator, and partial unique production-correlation index over existing movement columns, without a new table, column, arithmetic rule, route, or generic posting-group change. Deferred, already implemented BOM behavior is preserved.

## Post-MVP Sequence

After the MVP passes, the team does not automatically resume the old roadmap in its current numerical or dependency order. It first reviews evidence from real usage and then selects the next smallest coherent capability. The earlier Wave 0 analysis remains the long-term option map and architectural guardrail, not a precommitted release queue.

The following list is illustrative, not an approved sequence:

1. partial confirmations, returns, scrap, and backflush;
2. automatic child-order networks, phantom/direct-issue behavior, and broader multi-level execution;
3. routing, operations, Work Centers, and instructions;
4. BOM usability/control P1.4c-h;
5. planning, capacity, traceability, quality, costing, MES, and specialist models.

Each selected item retains its dedicated readiness gate and receives detailed specification work only when selected.

## Post-MVP Decision Gate

Before starting the next capability, maintainers review:

- which steps block users from completing or repeating production orders;
- which manual workarounds consume the most time or create the most errors;
- whether users need automatic multi-level production orchestration, routing, partial confirmation, backflush, planning, traceability, or another capability first;
- whether current Catalog/WMS limitations caused real failures or only theoretical constraints;
- adoption signals such as activated installations, repeated orders, completion rate, support requests, and contributor/partner demand;
- implementation cost, migration risk, cross-module blast radius, and compatibility impact.

The review also records the product-learning thresholds above: number of independent organizations completing the flow, repeat-order usage, completion/recovery rate, and whether database or custom-code intervention was required. Missing a threshold does not automatically cancel Manufacturing, but it prevents the roadmap from treating the MVP hypothesis as validated without an explicit maintainer decision.

The next capability is chosen by demonstrated business impact and risk reduction. For example:

- frequent manual material posting favors backflush or atomic posting work;
- excessive manual creation or coordination of subassembly orders favors automatic child-order or planning work;
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
- **Residual risk**: Follow-on migrations may remain when automatic order networks and partial execution are selected.

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

### Multi-level definition is mistaken for automatic multi-level execution

- **Scenario**: Users expect one parent order to execute descendant raw materials or create child production orders automatically.
- **Severity**: Medium.
- **Affected area**: Release UI, order calculation, documentation, issue.
- **Mitigation**: Show the full definition tree and gross requirements, but label the per-order direct-occurrence boundary clearly. A `produce` occurrence is issued as stocked subassembly inventory; making it uses a separate order with an optional parent reference. Never silently flatten it.
- **Residual risk**: Early adopters must create and coordinate subassembly orders manually.

### Current UoM and precision limitations

- **Scenario**: BOM quantity or conversion is valid for authoring but cannot be represented consistently by current WMS storage/arithmetic.
- **Severity**: High.
- **Affected area**: Order release and stock execution.
- **Mitigation**: Apply the whole-number current-unit predicate defined in the acceptance scenario at definition release, order release, and posting; reject cross-unit, fractional, or overflowing inputs, calculations, existing balances, and results, and snapshot accepted integer strings. Do not silently round.
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

### Posting port bypasses WMS policy

- **Scenario**: A direct command-bus call skips an inventory freeze or another registered WMS mutation guard.
- **Severity**: Critical.
- **Affected area**: Physical inventory integrity and policy enforcement.
- **Mitigation**: Manufacturing may call only the typed WMS posting port; the WMS implementation runs the canonical guard chain before delegating to an inventory command and runs requested post-success callbacks only after the command commits.
- **Residual risk**: A future WMS write policy must be added to the shared guarded seam rather than only to an HTTP route.

## Final Compliance Report - 2026-09-05

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/docs/module-development.md`
- `om-spec-writing` Frontend Architecture Contract
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
| Module capability audit | Reuse native owners and smallest safe mechanisms | Compliant | Uses current Catalog values and a narrow guarded WMS-owned port over existing inventory commands. |
| Spec-writing checklist | Independently deployable capabilities are split | Compliant after review | This file is a release umbrella; implementation remains in three cohesive child contracts. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Outcome matches included P1 profiles | Pass | Every included profile supports the acceptance scenario. |
| Deferred scope is off the critical path | Pass | The bounded preview is included in MVP-D; routing, Work Centers, broader BOM usability, partial/backflush/scrap, and generalized policy extensions are excluded. |
| Ownership matches the roadmap | Pass | Manufacturing owns intent/facts; WMS owns stock; Catalog owns identity/UoM. |
| Risks cover stock writes | Pass | Idempotency, partial-failure state, retry, compensation, scope, and current precision limits are mandatory. |
| Compatibility with detailed specs | Pass | Existing IDs/specs remain; the MVP selects profiles rather than replacing contracts. |

### Frontend architecture disposition

This umbrella introduces no route or component itself. Each UI-bearing child specification must provide its server/client boundary map, `"use client"` ledger, page-root and client-blob budgets, provider/bootstrap list, hydration smoke path, interaction coverage, and `check:client-boundaries` evidence. Until those child sections pass review, no UI path is implementation-ready.

### Non-Compliant Items

The three child contracts remain proposed and require maintainer acceptance plus readiness evidence. This umbrella does not authorize implementation or promote itself to an accepted baseline.

### Verdict

**Proposed as the active product-scope baseline — maintainer review pending.** Not implementation-ready by itself; implementation remains gated by accepted child contracts and evidence.

## Relationship to the Existing Roadmap

This document is the proposed first-release roadmap umbrella, not one independently implementable capability specification. Once accepted with linked maintainer evidence, it supersedes the existing roadmap's Site, P1.3a-c, P1.8a, atomic-posting, and exact-reversal prerequisites for the restricted MVP profile only. The existing product roadmap remains normative for ownership and post-MVP architecture. Existing P1 identifiers and detailed specs remain intact as inputs or post-MVP capability work; they are not deleted or renumbered.

Implementation remains split into cohesive specifications for [multi-level BOM/release](2026-09-05-manufacturing-mvp-definition-release.md), [single-step order and facts](2026-09-05-manufacturing-mvp-order-and-facts.md), and [guarded inventory execution/correction](2026-09-05-manufacturing-mvp-inventory-execution.md). Each child is independently reviewable and mergeable behind the opt-in module boundary; only the public product announcement waits for the composed acceptance scenario. None may broaden its scope into Catalog or general WMS refactoring.

## Changelog

- 2026-09-05: Closed MVP review gaps in direct stocked-`produce` execution, exact current-unit quantities, issue-before-receipt, correction/cancellation states, WMS authorization and actor provenance, callback ordering, and concurrent intent replay.
- 2026-09-05: Clarified the business-first strategy as extensible CRUD plus one manual stock-affecting happy path, defined the first user profile and product-learning thresholds, and made broader domain-policy validation explicitly post-MVP.
- 2026-09-05: Created the active end-to-end OSS MVP boundary after product-scope review concluded that BOM-only delivery was not a usable Manufacturing module and full Wave 0 was too broad for the first release.
- 2026-09-05: Added the business hypothesis, learning goals, expected outcomes, and evidence-based post-MVP decision gate; clarified that the earlier Wave 0 analysis is a long-term option map rather than a committed delivery sequence.
- 2026-09-05: Kept bounded multi-level BOM authoring, preview and immutable occurrence snapshots in MVP while limiting each production order to direct-occurrence execution. Subassemblies use separately created, optionally parent-linked orders; automatic order networks, MRP and phantom/direct-issue behavior remain deferred.

### Review - 2026-09-05

- **Reviewer**: Codex self-review plus fresh-context scope review.
- **Security**: Passed at roadmap level; stock specs must prove scoped calls, deterministic retry, and compensation.
- **Performance**: Passed at roadmap level; recursive preview is bounded by the existing P1.4b depth/node contract, while bulk work, caching, and unbounded foreground operations remain outside MVP.
- **Cache**: N/A; omitted pending measured need.
- **Commands**: Passed at roadmap level; mutations are assigned to commands and guards.
- **Risks**: Passed; stock integrity, profile divergence, future routing, definition-versus-execution expectations, scope, and programme drift are covered.
- **Verdict**: **SPLIT for implementation, KEEP as the proposed release-roadmap umbrella.** Three child contracts are required; Catalog stays unchanged and WMS changes are limited to the additive guarded posting port.
