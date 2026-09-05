# P1.3a Catalog Quantity Normalization — Readiness Analysis

## TLDR

Current Catalog and Sales code persists useful UoM master data and immutable Sales evidence, but authoritative decisions still cross JavaScript `number`, use inconsistent rounding and expose non-atomic first-party configuration writes. The remediated P1.3a specification resolves those gaps with a Catalog-owned DI service, shared pure exact arithmetic, string-authoritative factor persistence, an atomic product-UoM aggregate command and an explicit Sales productless adapter.

**Readiness verdict:** specification-level remediation complete. No unresolved critical design finding remains. Product implementation is still gated by acceptance/merge of parent roadmap PR [#5256](https://github.com/open-mercato/open-mercato/pull/5256).

**Fresh-context scope review:** **KEEP** — Catalog foundation and Sales adoption are one release unit; WMS and Manufacturing remain excluded downstream capabilities.

**Tracker:** [#5390](https://github.com/open-mercato/open-mercato/issues/5390)  
**Primary owner:** `catalog`  
**Consumers in this capability:** `catalog`, `sales`  
**Audited repository state:** `1e9470e7d64bfbeec63402b429a7db48f9192157` plus documentation remediation dated 2026-08-28.

## Scope and Resolved Questions

| Question | Decision |
|---|---|
| Is this one deployable capability? | Yes after removing Manufacturing yield, exact division and BOM/released-definition persistence. Catalog foundation plus direct Sales adoption are one release unit because either behavior alone leaves the documented cross-surface contradiction unresolved. |
| Who owns product UoM policy? | Catalog. |
| Where does decimal arithmetic live? | Pure, domain-free helpers in `@open-mercato/shared`; Catalog owns policy resolution. |
| How do Sales lines without products behave? | Sales-owned factor-1 identity normalization; Catalog is not called. |
| Is the unit dictionary mandatory? | If the dictionary exists, its active entries are authoritative. If it is absent, Catalog's canonical-code fallback is preserved. |
| Is an HTTP normalization route needed? | No. The MVP publishes an in-process DI contract. |
| How is first-party UoM configuration saved? | Product create accepts additive nested conversions in its existing transaction; edit uses one Catalog aggregate command with optimistic locking and undo. |
| Can legacy numeric factors remain? | Yes as compatibility inputs/outputs; strings are authoritative and an additive exact response is published. |
| Is cross-request resolver caching required? | No. Request-local memoization only in MVP. |

## Current-State Audit

### Data and contracts

| Surface | Confirmed behavior | Evidence | Readiness implication |
|---|---|---|---|
| Product UoM policy | Product stores base/sales unit and rounding scale/mode. | `packages/core/src/modules/catalog/data/entities.ts`; `data/validators.ts` | Reuse Catalog ownership. |
| Conversion storage | `to_base_factor` is `numeric(24,12)` and represented as a string by the ORM entity. | `packages/core/src/modules/catalog/data/entities.ts` | Storage is sufficient for the declared factor envelope. |
| Conversion mutation | Validator coerces factor to `number`; command converts it back to string. | `catalog/data/validators.ts`; `commands/productUnitConversions.ts` | Precision is lost before persistence; string-authoritative path is required. |
| Conversion response | OpenAPI/API exposes `to_base_factor` as a number. | `catalog/api/product-unit-conversions/route.ts` | Preserve numeric field and add an exact string field. |
| Unit canonicalization | Shared trim/lowercase aliases include `qty -> pc`; Catalog dictionary resolution can fall back if dictionary is absent. | `packages/shared/src/lib/units/unitCodes.ts`; `catalog/lib/unitResolution.ts` | Freeze absent-vs-present dictionary semantics. |
| Sales evidence | Snapshot V1 and normalized scalar fields already exist. Product and units are nullable. | `sales/lib/types.ts`; `sales/data/validators.ts`; `sales/data/entities.ts` | Reuse without migration or historical recalculation. |
| Sales dependency | Sales requires Catalog and Dictionaries. | `packages/core/src/modules/sales/index.ts` | Direct DI consumption is allowed; reverse Catalog→Sales dependency remains prohibited. |

### Normalization call-site classification

| Call site | Current arithmetic | Classification and target |
|---|---|---|
| `catalog/api/products/route.ts` product-list pricing quantity | `Number(factor)` and multiplication, with fallback | Product-backed authoritative path → Catalog resolver. |
| `catalog/api/prices/route.ts` price filtering | `Number`, multiplication, `Math.round`, fallback | Product-backed authoritative path → Catalog resolver; explicit alternate-unit errors fail closed. |
| `sales/commands/documents.ts::normalizeLineUom` with product | ORM reads, `number`, hard-coded `half_up`/6 | Product-backed authoritative path → Catalog resolver. |
| `sales/commands/documents.ts::normalizeLineUom` without product | Factor-1 snapshot with nullable product | Deliberate Sales identity adapter; retain and make exact. |
| `sales/components/documents/LineItemDialog.tsx` preview | Client `number` multiplication and six-decimal rounding | Advisory product-backed preview → shared exact policy helper with loaded Catalog data. |
| `sales/commands/documents.ts::convertLineUnitPricesOnUnitChange` | Numeric price recalculation using UoM factors | Price arithmetic, not quantity normalization; preserve behavior with regression coverage. |
| Quote/order/invoice/return copy/read paths | Reuse stored normalized values/snapshots | Evidence consumers; never recalculate historical snapshots. |
| Catalog conversion CRUD/UI | Numeric validation/conversion before string DB write | Master-data boundary → exact string validation/persistence bridge. |

No successful product-backed normalization path remains intentionally independent in the target design.

### First-party aggregate write

The current product editor updates the product, then separately deletes/updates/creates conversions:

- `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/products/create/page.tsx`

A failure or concurrent request can expose a new product policy with an old/partial conversion set. The remediated spec adds optional nested `uomConversions` to the existing `catalog.products.create` transaction and requires `catalog.product_uom_configuration.save` plus `PUT /api/catalog/products/{id}/uom-configuration` for first-party edits. Legacy single-resource endpoints remain for backward compatibility.

## Exact-Decimal Helper Audit

| Candidate | Finding | Decision |
|---|---|---|
| `packages/core/src/modules/dashboards/lib/exactDecimal.ts` | BigInt-based exact representation with useful aggregation tests, but module-local and accepts exponent notation. | Evaluate/extract representation and applicable tests; do not import private Dashboard code from Catalog/Shared. |
| Module-local BigInt arithmetic in payments/EUDR/warranty | Specialized fixed-scale business rules. | Do not generalize or import; use only as implementation references. |
| Transitive decimal libraries in lockfile | Not approved as direct production dependencies and may disappear with dependency graph changes. | Do not import transitively. A new dependency needs separate approval. |
| New Shared helper | Can define the stricter syntax, canonical form, scale/range and rounding required by UoM. | Recommended upstream core mechanism at the frozen public path `@open-mercato/shared/lib/decimal`. |

Required shared operations for P1.3a are canonicalize, compare, multiply, negate, round and pure policy application with typed decimal error codes. P1.3b owns additive WMS add/subtract/minimum/zero helpers; P1.4b owns additive bounded division. Those additions do not change the P1.3a signatures.

## External Benchmark

Official Odoo documentation uses a reference unit inside a UoM category and restricts conversions to compatible units. ERPNext uses stock UoM/item conversion factors and exposes transaction UoM, conversion factor and stock quantity.

- Odoo: <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html>
- ERPNext UoM: <https://docs.frappe.io/erpnext/uom>
- ERPNext selling transaction: <https://docs.frappe.io/erpnext/Selling-in-different-UOM>

P1.3a adopts base/stock unit, explicit conversion and immutable transaction evidence. It does not add global dimensions/categories because current Open Mercato conversion data is product-scoped and no safe automatic dimension migration exists. Dictionary validation supplies the bounded operational guard.

## Mechanism and Ownership Decisions

| Requirement | Recommended mechanism | Ownership | Evidence/rationale |
|---|---|---|---|
| Exact decimal operations | Narrow public utility in `packages/shared/src/lib/` | `shared` upstream | Cross-cutting, pure and required by multiple core consumers; no domain dependency. |
| Product/variant/factor/policy resolution | DI service `catalogQuantityNormalizationService` | `catalog` | Catalog owns all current master data and Sales hard-depends on Catalog. |
| Coupled UoM configuration write | Existing product-create command extension plus update aggregate command/custom guarded API transaction | `catalog` | Business mutation requires validation, locking, audit, undo and atomicity. |
| Product-backed Sales normalization | Direct DI consumption from Sales command | `sales` glue, Catalog policy | Existing required dependency; no reverse import. |
| Productless Sales normalization | Sales-owned exact factor-1 adapter | `sales` | No product exists from which Catalog could resolve policy. |
| Sales snapshot | Existing scalar fields + JSON V1 mapping | `sales` | Historical document evidence must survive Catalog changes. |
| Client preview | Shared pure policy function using already loaded values | `sales` UI | Avoids new HTTP route and matches authoritative arithmetic. |
| Cross-request cache | None in MVP | N/A | Removes stale-policy risk; future cache must use DI/tags. |
| Manufacturing yield/division/persistence | Separate consumer specification | `manufacturing` | Independently deployable and outside Catalog master-data responsibility. |

## Compatibility Analysis

| Published behavior | Required preservation |
|---|---|
| Numeric `toBaseFactor` request | Continue accepting it and adapt deterministically. |
| Numeric `to_base_factor` response | Keep it; add `to_base_factor_exact` rather than replacing it. |
| Existing conversion/product endpoints | Keep URL/method and single-resource behavior. Use nested create conversions or the edit aggregate endpoint for coupled changes. |
| Sales snapshot V1 | Continue reading/copying without recalculation. |
| Productless Sales lines | Preserve nullable product/unit and factor-1 semantics. |
| Quote→order→invoice evidence | Copy existing snapshot; do not re-resolve. |
| Unit-price conversion on unit change | Preserve with regression tests; it is price math, not silently folded into quantity resolver. |
| New invalid master data | New/edited product-backed writes fail closed with documented error codes and operator remediation. |

## Findings and Remediation Status

| Finding | Original priority | Remediation in specification | Status |
|---|---|---|---|
| Resolver excluded valid Sales lines without products | High | Explicit Sales identity adapter and missing-product distinction | Resolved |
| Exact resolver consumed factors already rounded through `number` | High | String-authoritative validator/command/UI and additive exact response | Resolved |
| First-party product policy/conversions saved independently | High | Atomic aggregate command/API with locking, rollback and undo | Resolved |
| DI key/import/batch/error contract was only conceptual and unfrozen | High | Names and interfaces frozen | Resolved |
| Manufacturing yield/division/persistence expanded scope | High | Removed and assigned to Manufacturing consumer specs | Resolved |
| Dictionary absence/presence behavior ambiguous | Medium | Five-step operational dictionary rule | Resolved |
| Client preview could disagree under same policy | Medium | Shared exact policy helper and authoritative re-resolution on save | Resolved |
| Existing exact helper/benchmark not evaluated | Medium | Repository helper audit and official benchmark recorded | Resolved |

## P1.12 Evidence Mapping

| Evidence category | P1.3a mapping | Status |
|---|---|---|
| Tenant/organization isolation | Cross-scope product, variant and factor service/API tests; authenticated scope overrides body. | Required |
| Site isolation | No site field or WMS operation exists in P1.3a. | N/A |
| Disabled-module behavior | Catalog has no dependency on Sales/Manufacturing. Sales already hard-requires Catalog, so an optional-peer fallback is not introduced. Run module-decoupling coverage for the reverse boundary. | Required/N/A as noted |
| Conflict | Aggregate UoM save requires `updatedAt`, locks rows and returns `409` for stale state. | Required |
| Reversal/undo | Aggregate before/after snapshot restores complete policy+conversion state atomically; existing single-resource undo remains. | Required |
| Partial failure | Injected failure during conversion synchronization rolls back product policy and all conversions. | Required |
| Compatibility | Numeric request/response, legacy snapshot, productless line, quote-copy and unit-price conversion regressions. | Required |

## Test and Evidence Plan

### Unit/contract

- Exact canonicalizer and all rounding modes, signs, ties, scale/range and domain overflow.
- Exact 12-decimal conversion create/update/read/undo/redo.
- Dictionary absent, present-valid, present-missing and inactive entry.
- Resolver factor 1/direct factor, variant inheritance/mismatch and every failure code.
- Batch ordering, all-or-nothing return and at-most-three-query bound per scope/product group.
- Sales productless identity adapter and product-backed mapping.
- Client preview golden corpus against the shared policy helper.

### Integration

- Catalog product-create nested UoM success/rollback plus edit aggregate success, validation rejection, rollback injection, `409`, undo and redo.
- Catalog listing and price filtering convergence.
- Sales product-backed create/edit and immutable historical snapshot after factor change.
- Productless service/shipping/discount/adjustment lines.
- Cross-tenant/organization and cross-product variant denial.
- Quote→order→invoice snapshot and price-conversion regressions.

Executable tests live under Catalog/Sales `__integration__`, create fixtures via APIs and clean them in `finally`/teardown. Baseline unit suites passed before remediation: 3 suites, 47 tests. Those tests confirm the current baseline only and are not P1.3a acceptance evidence.

## Risks and Residual Decisions

No critical design finding remains. The two accepted residual risks are:

1. Legacy clients may continue sequencing old product/conversion endpoints and observe an intermediate committed state. Removing those endpoints would be breaking; nested atomic create, the edit aggregate endpoint and first-party migration are the additive remedy.
2. A numeric client may have lost precision before the server receives JSON. The server preserves the received numeric value, while exact clients and first-party UI use strings.

Both risks require release-note documentation and compatibility tests; neither justifies a breaking removal.

## Final Compliance Report — 2026-08-28

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/cache/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Evidence |
|---|---|---|
| One independently deployable capability | Compliant | Manufacturing yield/division/persistence removed. |
| Correct module ownership and isolation | Compliant | Shared pure arithmetic, Catalog policy, Sales glue/snapshot; no ORM link. |
| Scope, validation and security | Compliant | Auth-derived tenant/org, Zod and non-disclosing errors. |
| Atomicity, optimistic locking and undo | Compliant | Aggregate command contract and P1.12 tests. |
| API/public compatibility | Compliant | Additive exact fields/service/route; legacy fields and endpoints preserved. |
| Cache rules | N/A for MVP | No cross-request cache. |
| Integration coverage | Compliant | All affected API/UI paths mapped to self-contained tests. |
| Risk and operational evidence | Compliant | Failure scenarios, detection and residual risks recorded. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Current-state findings map to target tasks | Pass | Every classified gap maps to P1.3a phases A1–A10. |
| Data/API/UI contracts agree | Pass | Exact strings are authoritative, numeric bridge additive, UI uses aggregate save/preview helper. |
| Scope agrees with roadmap ownership | Pass | Catalog remains master; Manufacturing is a downstream future consumer. |
| P1.12 categories mapped | Pass | Required or explicitly N/A. |

### Non-Compliant Items

None at specification level.

### Verdict

**Fully compliant at specification level.** Product implementation starts only after the parent-roadmap acceptance gate is cleared.

## Changelog

- 2026-08-28: Created the P1.3a readiness artifact required by #5390; recorded current-state evidence, benchmark, resolved decisions, mechanism ownership, compatibility, P1.12 mapping and compliance verdict.
