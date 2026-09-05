# Pre-Implementation Analysis: Manufacturing Work Centers and Optional Resource Membership

**Reviewed specification:** `.ai/specs/2026-08-19-manufacturing-work-centres.md`  
**Audit date:** 2026-08-28  
**Audited against:** current repository conventions, `AGENTS.md` guidance, and relevant lessons  
**Recommendation:** **Needs spec updates first**

## Executive summary

The business boundary is sound: a Work Center is Manufacturing-owned master data and optional Resource membership is a bounded convenience, not a premature scheduling or capacity subsystem. The specification is also deliberately additive and keeps routing, costing, calendars, scheduling, execution, and snapshots in later capabilities.

It is not yet implementation-ready because its most important cross-module mechanism does not exist: `Resources` has no source-owned DI lookup provider through which an optional consumer may validate and enrich assigned resources. Direct ORM access or a call to the `Resources` HTTP API would violate current module-isolation rules. The optional `siteId` has the same problem at an earlier stage: this repository's WMS module owns Warehouses, not a Site entity or provider. Two further corrections are needed: the list contract must use the repository's page/pageSize CRUD pagination (or introduce an approved framework-level keyset facility), and the disabled-module test matrix must reflect that `resources` currently requires `planner`.

## Scope assessed

The audit covers the proposed Work Center aggregate, optional `resources` membership, routes and UI, ACL, undo/audit, organization scope, performance, and its declared P1.0a/P1.5/P1.7/P1.10 hand-offs. It does not design or add the missing provider; this report only identifies the decision that the specification must make before implementation.

## Backward-compatibility audit

| Surface | Result | Evidence / required clarification |
|---|---|---|
| 1. Auto-discovery | Pass | Proposed Manufacturing files and routes are additive. P1.0a must first establish the module's conventional discovery layout. |
| 2. Existing types / schemas | Pass | `manufacturing_work_centers` and `manufacturing_work_center_resources` are new tables; no change to an existing entity contract is proposed. |
| 3. Existing public functions | Pass | The specification does not rename or remove a public function. |
| 4. Imports / moved modules | Pass | No move or replacement of an existing module is proposed. |
| 5. Existing events | Pass | No existing event is repurposed. New audit/undo events remain Manufacturing-owned. |
| 6. Existing identifier contracts | Pass | New identifiers only; their generator and format are deferred to the canonical project mechanism. |
| 7. Public API | **Needs update** | New endpoints are additive, but the specified keyset pagination conflicts with the standard CRUD route contract, which exposes `page` and `pageSize`. See Gap 2. |
| 8. Database | Needs update | Work Center tables are additive, but an optional `siteId` cannot carry a valid foreign/lookup semantics until P1.2 Site exists as its own contract; WMS has no Site model. |
| 9. DI services | **Critical gap** | Optional resource validation/enrichment needs a new, source-owned Resources provider contract. It is not present in the repository or defined precisely by the spec. See Gap 1. |
| 10. ACL | Needs clarification | New Work Center permissions are additive. The missing provider must specify how `resources.view` is checked and what callers receive when it is absent. |
| 11. Jobs / workers | Pass | No new worker or schedule is introduced. |
| 12. Feature flags / module dependencies | **Needs update** | `resources` has a hard `planner` dependency, so `Resources enabled, Planner disabled` is not a valid normal composition. See Gap 3. |
| 13. Generator / generated artifacts | Pass with gate | New migration/entity identifiers must be generated according to P1.0a once the Manufacturing module is bootstrapped; no hand-authored replacement is proposed. |

No existing public contract needs a breaking change. The blocking issue is an unspecified new contract between two modules, not a need to modify an established one.

## Specification completeness

The specification covers all material headings needed for a feature: scope and non-goals, user outcomes, model, route/UI contract, commands and undo, authorization, operations, migration, implementation order, tests, hand-offs, and risks.

The following parts are incomplete enough to prevent a safe start:

1. **Resource provider contract — critical.** The text requires an authorized, bounded resource lookup/enrichment seam but names neither the owning `Resources` service nor its DI token, returned projection, organization-selection behavior, ACL behavior, error taxonomy, or disabled-module behavior. `packages/core/src/modules/resources` currently has APIs and entities but no `di.ts` or equivalent lookup provider. The implementation must not compensate by importing Resource entities/querying peer tables or by calling a peer HTTP route.
2. **Pagination contract — high.** Section "API Contracts" requires keyset pagination, while the canonical `makeCrudRoute` path and the existing Resources API use offset pagination (`page`, `pageSize`, capped at 100). The repository query engine also applies `limit(...).offset(...)`. One canonical choice is required.
3. **Module-composition matrix — medium.** The matrix treats Resources as independently enabled while Planner is disabled. In the actual manifest, `packages/core/src/modules/resources/index.ts` declares `requires: ['planner']`; the stated composition is therefore not a supported application composition.
4. **Request-derived organization selection — medium.** The spec says tenant/organization must come from the caller, but the hand-written provider and any non-factory route must explicitly use `resolveOrganizationScopeForRequest` and reject a rejected selection. This is necessary to avoid silently trusting `auth.orgId` or an arbitrary client-supplied organization ID.
5. **Optional Site contract — high.** P1.6 reserves `siteId` and describes optional Site lookup/ACL, but the current WMS module has `Warehouse`, `WarehouseZone`, and `WarehouseLocation`; it exposes no Site entity, DI provider, or Site permission. The scalar must not silently be interpreted as a Warehouse ID.

## `AGENTS.md` / repository-convention compliance

| Rule or convention | Finding | Status |
|---|---|---|
| Module owns its entities; peer-module access goes through a narrow source-owned DI service | The intended outcome is stated, but the provider does not exist or have a precise contract. | **Violation to resolve before code** |
| Optional dependency must fail soft | The intended fallback summary is correct, but it cannot be verified until the provider defines disabled/unavailable and unauthorized outcomes. | Needs update |
| Organization scope is resolved from request selection | Factory routes do this; any custom resource provider/route needs the same explicit rule. | Needs update |
| Canonical CRUD list contract and sorting | The spec asks for keyset pagination rather than the established `page`/`pageSize` factory contract. | Needs update |
| Optional peer Site reference has a source-owned contract | No Site source/provider exists yet; WMS Warehouse is not a substitute. | **Violation to resolve before code** |
| Additive ACL, migrations, audit, and undo | The proposed Work Center capability follows these patterns. | Pass |
| Do not use cross-module precedent as permission for direct table reads | Direct peer table access is not permitted even though other legacy code may contain it. | Pass only if Gap 1 is fixed |

Relevant lessons applied:

- `.ai/lessons/cross-module-query-precedent-is-not-permission-to-copy.md`
- `.ai/lessons/organization-scoped-routes-must-resolve-request-selection.md`
- `.ai/lessons/makecrudroute-sortfield-is-a-string-with-a-sortfieldmap.md`
- `.ai/lessons/always-propagate-structured-conflict-payload-from.md`
- `.ai/lessons/decryption-scope-argument-is-not-a-where-filter.md`

## Findings and remediation

### Gap 1 — source-owned Resources lookup provider

**Severity:** Critical  
**Why it matters:** Resource assignment is the only deliberate cross-module behavior in P1.6. Without a source-owned provider, the implementation has only unsafe choices: direct import/query of Resources data, internal HTTP calls, or no validation at all. Each would make optional modules, authorization, and tenant/organization isolation unreliable.

**Evidence:** `packages/core/src/modules/resources/index.ts` exposes the module manifest and `packages/core/src/modules/resources/api/resources.ts` exposes HTTP CRUD, but the module has no `di.ts` or documented lookup service. The repository lesson requires the source module to own the narrow DI seam.

**Required specification decision:** Add a small prerequisite owned by `Resources`, with an exact DI token/interface (or an approved existing provider if one is found during implementation). Define a batch operation such as "resolve active resources by IDs for the resolved tenant and selected organization" and specify:

- the minimal returned projection (`id`, `name`, active status; no scheduling/capacity data);
- caller-supplied resolved scope, with provider-side explicit tenant, organization, and soft-delete filters;
- treatment of missing IDs, inactive resources, cross-organization IDs, unavailable `Resources`, and missing `resources.view`;
- whether a caller without `resources.view` may retain existing snapshots while receiving no current summary;
- registration/lifecycle, unit/integration tests, and proof that Manufacturing has no static runtime dependency on Resources.

This is intentionally not a proposal to make Manufacturing depend on Resources. It is the minimum contract needed to keep Resources optional.

### Gap 2 — list pagination conflicts with canonical CRUD

**Severity:** High  
**Why it matters:** The API section promises clients a cursor/keyset contract that existing route and query primitives do not implement. Building it locally would create a one-off list protocol and duplicate framework responsibility.

**Evidence:** `packages/shared/src/lib/crud/factory.ts` parses `page` and `pageSize`; `packages/shared/src/lib/query/engine.ts` uses offset pagination. `packages/core/src/modules/resources/api/resources.ts` uses the same page/pageSize shape and caps page size at 100.

**Required specification decision:** Prefer the existing canonical contract for P1.6: `page`, `pageSize <= 100`, `sortField`, `sortDir`, and a `sortFieldMap` with stable deterministic defaults. If keyset pagination is a true product requirement, split framework support into an explicit prerequisite and define the cursor encoding, ordering, response metadata, and broad compatibility impact before P1.6 begins.

### Gap 3 — Resources/Planner composition is impossible as written

**Severity:** Medium  
**Why it matters:** The current test matrix could request a runtime composition that the module manifest rejects, creating an invalid acceptance test rather than useful optional-module coverage.

**Evidence:** `packages/core/src/modules/resources/index.ts` declares `requires: ['planner']`.

**Required specification decision:** Replace the invalid row with these supported cases:

| Composition | Expected P1.6 behavior |
|---|---|
| Manufacturing only | Work Centers and scalar memberships operate; no Resource validation/enrichment is attempted. |
| Manufacturing + WMS | Same P1.6 behavior; no WMS coupling is introduced. |
| Manufacturing + Resources + Planner | Resource IDs are validated/enriched through the new Resources provider, subject to `resources.view`. |

"Manufacturing with Resources but without Planner" should not be a P1.6 acceptance scenario unless the Resources manifest itself is changed in a separate, explicitly approved dependency change.

### Gap 4 — organization selection needs an implementation-grade rule

**Severity:** Medium  
**Why it matters:** Work Centers are organization-scoped and the optional provider is a new custom boundary. Generic wording about caller scope can become an accidental tenant-only query or a trust in stale authentication context.

**Required specification decision:** State that every non-factory handler and the Resources provider derives the organization with `resolveOrganizationScopeForRequest`, stops on `selectionRejected`, and applies explicit tenant, organization, and `deletedAt` predicates. Include a negative test for a valid resource from another organization and a rejected selected organization.

### Gap 5 — `siteId` points to no existing Site owner

**Severity:** High  
**Why it matters:** A scalar future-facing ID is acceptable only when its owning aggregate and validation boundary are explicit. WMS currently owns `Warehouse`, `WarehouseZone`, and `WarehouseLocation`; treating any of them as Site would change business meaning and create an unannounced dependency.

**Evidence:** `packages/core/src/modules/wms/data/entities.ts` defines the WMS warehouse hierarchy and `packages/core/src/modules/wms/di.ts` exposes its related DI tokens. There is no `Site`, `site_id`, or Site provider in the current repository.

**Required specification decision:** Choose one of the following before implementation:

- remove writable `siteId` from P1.6 and leave no Site field until P1.2 is delivered; or
- keep a nullable reserved scalar explicitly unmanaged in P1.6 (no UI edit, no lookup, no ACL, no foreign key); or
- make P1.2 Site an upstream prerequisite that defines its owner, provider, ACL, migration/ID contract, and optional-consumer behavior.

The third option is necessary if P1.6 must validate or display a current Site name. Do not map `siteId` to WMS Warehouse ID.

## Upstream readiness

P1.0a has not yet produced a Manufacturing module in this repository (`packages/manufacturing` is absent), and the application currently activates only the existing `planner` and `resources` modules. The specification already correctly makes P1.0a an implementation gate, but its final readiness wording must not be read as approval to start P1.6 now. P1.0a must establish the module manifest, migration/generator, ACL, navigation, and test conventions first. P1.2 is also an upstream gate if the product wants a validated or displayed Site reference rather than an unmanaged reserved scalar.

## Recommended next step

Amend P1.6 before implementation to resolve Gaps 1–5, then run this audit again. The scope itself should remain unchanged: **one Work Center capability with optional Resource membership**, not capacity, calendar, scheduling, costs, or execution. No production code or specification was changed and no commit was created by this audit; this analysis report is the only new audit artifact.
