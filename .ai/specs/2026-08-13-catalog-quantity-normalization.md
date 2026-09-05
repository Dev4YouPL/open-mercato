# Catalog Quantity Normalization Contract

**Revision:** v4 — 2026-08-28

## TLDR

P1.3a makes the existing Catalog UoM model authoritative and deterministic. It adds one Catalog-owned resolver over the existing base unit, product conversion, and rounding fields; moves exact decimal arithmetic into a pure shared utility; and makes Catalog pricing plus Sales normalization use the same result.

This capability does not change WMS storage or add inventory evidence. It is independently deployable and fixes current contradictions where configured rounding modes are ignored and successful normalization paths compute different results.

## Overview and Status

**Status:** Readiness remediation v4 complete; awaiting maintainer acceptance of this revision. Product implementation remains gated by both that acceptance and acceptance/merge of the parent roadmap PR [#5256](https://github.com/open-mercato/open-mercato/pull/5256), which remained open when v4 was prepared.

**Wave 0 capability:** P1.3a, first part of the quantity/UoM/precision gate.

**Predecessor:** `implemented/SPEC-034-2026-02-18-units-of-measure-conversions.md`.

**Consumers:** P1.3b WMS precision alignment, P1.3c WMS quantity evidence/reversal, P1.4 BOM authoring, P1.7 released definitions, the P1.8 generic WMS posting group and Manufacturing adapter, and P1.10 production orders.

## Problem Statement

Catalog already stores product base and sales units, `toBaseFactor numeric(24,12)`, rounding scale `0..6`, and rounding mode `half_up|down|up`. Sales already stores normalized quantities and immutable UoM snapshots. The runtime does not consistently honor that model:

- Catalog product-list pricing multiplies JavaScript numbers without applying the configured policy.
- Catalog price filtering applies `Math.round` and a scale but ignores the stored rounding mode.
- Catalog price filtering removes rows in `afterList`, after pagination/counting, so quantity filters can return incomplete pages and incorrect totals.
- Sales always normalizes with hard-coded scale `6` and `half_up`, then writes those values into its snapshot.
- A missing Sales `quantityUnit` currently means `defaultSalesUnit`, then base unit; an unqualified resolver default would silently change that behavior.
- Missing conversions can fall back to raw quantity in pricing paths.
- Exact database decimal strings are converted to IEEE-754 numbers before business decisions.
- Existing Sales and pricing input types expose only numeric quantities, so an additive exact ingress is required instead of narrowing those published fields.
- Variant inheritance and operational dictionary behavior are implicit.

The same product, quantity, and unit can therefore produce different results depending on the caller.

## Proposed Solution and Market Reference

Provide one Catalog-owned, scope-aware DI service for product-backed normalization, backed by pure shared exact-decimal primitives. Make exact strings authoritative at the conversion write boundary, save the first-party product UoM aggregate atomically, migrate Catalog pricing and Sales to the service, and preserve a deliberately separate factor-1 Sales adapter for lines that have no product.

Catalog foundation and Sales adoption are one release unit. Shipping only the resolver/Catalog migration would preserve two authoritative normalization behaviors, which is the defect this capability exists to remove. Implementation phases below are review/test checkpoints and must not be released or marked complete independently.

Official Odoo documentation models a product UoM relative to a category reference unit and restricts conversion to the same category. ERPNext documents a stock UoM plus item conversion factors, and carries UoM/conversion/stock quantity at transaction time. P1.3a adopts the stable base-unit + conversion + transaction-evidence pattern. It deliberately rejects a global category/dimensional engine for this capability because existing Open Mercato data is product-scoped and cannot be safely assigned dimensions without a separate migration and operator decision. The operational dictionary validation described below is the bounded guard; dimensional compatibility remains future work.

- Odoo: <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html>
- ERPNext UoM: <https://docs.frappe.io/erpnext/uom>
- ERPNext transaction conversion: <https://docs.frappe.io/erpnext/Selling-in-different-UOM>

## Scope

### In scope

- Pure exact-decimal canonicalize, compare, multiply, negate, and round operations in `@open-mercato/shared` required by product quantity normalization.
- A Catalog DI service that resolves product policy and returns a provider-neutral immutable normalization snapshot.
- Product-level UoM inheritance for variants.
- Convergence of every successful **product-backed** Catalog pricing and Sales line normalization path, including the Sales client preview.
- A Catalog aggregate command/API that persists product UoM policy and the complete conversion set atomically for the first-party product editor.
- Exact string persistence and additive `*Exact` request/response companions for conversion and default-sales quantities while retaining the types and behavior of published numeric inputs and responses.
- An explicit Sales identity-normalization contract for lines without a product.
- Compatibility adapters for existing numeric API inputs and existing Sales snapshots.
- Additive exact-quantity ingress for Sales and Catalog pricing while preserving their published numeric fields.
- Exact tier comparison before pagination/counting and preservation of Sales unit-price-reference evidence.
- Additive Shared helpers for typed coded CRUD errors and an unconditional optimistic-lock domain floor, plus Catalog/Sales translations for every public UoM failure.
- Unit, contract, integration, scope, and backward-compatibility tests.

### Out of scope

- WMS column precision, profiles, balances, reservations, movements, or reversal.
- Variant-specific UoM overrides.
- A global conversion graph or dimensional-analysis engine.
- Purchasing/supplier UoM, catch weight, density, potency, yield, process loss, exact division, BOM persistence, released-definition snapshots, or Manufacturing consumption semantics. Those belong to the consuming Manufacturing specification and may reuse or add pure decimal primitives without moving their policy into Catalog.
- New Catalog UoM configuration screens or layout. The existing editor remains the UI surface but changes its save orchestration and decimal handling.
- An HTTP normalization endpoint. P1.3a publishes an in-process DI contract; a future route requires a separate caller and additive API design.

## User Stories and Use Cases

- A Catalog administrator changes a product base unit, rounding policy and conversions as one operation so consumers never observe a partially saved first-party configuration.
- A Sales user enters a product quantity in an alternate unit and sees the same normalized value in preview, pricing and the persisted document snapshot.
- A Sales user adds a service/shipping/discount/adjustment line without a product and retains the published factor-1 behavior.
- A downstream module resolves product quantities through a stable DI/type contract without importing Catalog persistence internals.
- An API client can continue sending numeric factors with the same TypeScript shape, while an exact client can round-trip all 12 stored decimal places through an additive string companion.

## Current State Audit

| Surface | Existing behavior | Evidence | Decision |
|---|---|---|---|
| Product policy | `defaultUnit`, `defaultSalesUnit`, quantity `numeric(18,6)`, rounding scale/mode | `packages/core/src/modules/catalog/data/entities.ts`; `data/validators.ts` | Reuse |
| Conversions | Product star topology, factor `numeric(24,12)`, scoped CRUD and undo | `catalog/data/entities.ts`; `commands/productUnitConversions.ts` | Reuse |
| Unit codes | Shared lowercase/trim canonicalization and `qty -> pc`; dictionary lookup may fall back when dictionary is absent and currently returns entry `value` | `packages/shared/src/lib/units/unitCodes.ts`; `catalog/lib/unitResolution.ts` | Preserve entry `value` as the canonical output; use `normalizedValue` for lookup/collision detection; operational resolver fails closed without canonical base unit |
| Conversion wire precision | Create/update validation coerces `toBaseFactor` to JavaScript `number`; the API exposes `to_base_factor` as a number | `catalog/data/validators.ts`; `commands/productUnitConversions.ts`; `catalog/api/product-unit-conversions/route.ts` | Keep the required numeric property and its inferred type; add an optional authoritative `toBaseFactorExact` companion and exact response field |
| Product UoM editor save | Product is saved first, followed by independent conversion delete/update/create requests | `catalog/backend/catalog/products/[id]/page.tsx`; `catalog/backend/catalog/products/create/page.tsx` | Add nested conversions to atomic product create and use one aggregate command/API transaction for edits |
| Product pricing | Factor lookup and `quantity * factor`; no consistent policy rounding | `catalog/api/products/route.ts` | Delegate to resolver |
| Price filtering | Factor lookup plus `Math.round`; mode ignored; quantity filtering runs in `afterList` after pagination | `catalog/api/prices/route.ts` | Delegate to resolver and apply the exact tier predicate before count/pagination |
| Pricing contract | `PricingContext.quantity` and tier comparisons use JavaScript `number` | `catalog/lib/pricing.ts` | Keep the numeric field and add an optional exact companion used preferentially by native comparisons |
| Sales normalization | Fixed scale `6`, `Math.round`, snapshot states `half_up/6` | `sales/commands/documents.ts` | Delegate to resolver |
| Sales missing-unit behavior | Product-backed lines use `quantityUnit`, otherwise `defaultSalesUnit`, otherwise base unit | `sales/commands/documents.ts` | Preserve through an explicit resolver policy; do not inherit the Catalog operational default accidentally |
| Sales exact ingress | Published line `quantity` is validated/coerced as a JavaScript `number` | `sales/data/validators.ts`; `sales/lib/types.ts` | Keep it and add optional `quantityExact` for authoritative normalization |
| Sales productless lines | Service/shipping/discount/adjustment lines can have no `productId`; current behavior creates factor-1 evidence | `sales/data/validators.ts`; `sales/commands/documents.ts`; `sales/lib/types.ts` | Keep a Sales-owned identity path; do not call Catalog without a product |
| Sales unit-price evidence | Product-backed snapshots may include `unitPriceReference` derived from Catalog product policy | `sales/commands/documents.ts`; `sales/lib/types.ts` | Preserve through resolver policy evidence plus Sales-owned price enrichment |
| Sales client preview | UI multiplies `number` values and rounds to six decimals independently | `sales/components/documents/LineItemDialog.tsx` | Use the shared pure exact policy application and label the result as preview; save still re-resolves in Catalog |
| Conversion editor cardinality | Edit UI requests only the first 100 conversion rows and then performs independent mutations | `catalog/backend/catalog/products/[id]/page.tsx` | Load every page before aggregate editing and test a product with more than 100 conversions |
| Aggregate concurrency | Conversion CRUD/undo updates conversion rows without using the product row as the shared concurrency root | `catalog/commands/productUnitConversions.ts`; `catalog/commands/products.ts` | Make every UoM mutation lock and monotonically bump the product root |
| Action-log snapshot timing | The command bus calls `prepare` before `execute`; current conversion commands load `snapshotBefore` in `prepare`, before a future product-root lock can be acquired | `packages/shared/src/lib/commands/command-bus.ts`; `catalog/commands/productUnitConversions.ts` | Capture authoritative before/after aggregate snapshots inside the root-locked transaction and pass them to `buildLog` through the internal command result |
| Optimistic-lock error construction | The existing command helper is configurable through `OM_OPTIMISTIC_LOCK`, while aggregate edit requires an unconditional domain precondition; Shared rules prohibit callers from constructing `CrudHttpError` directly | `packages/shared/src/lib/crud/optimistic-lock-command.ts`; `packages/shared/AGENTS.md` | Add an unconditional Shared helper that owns the standard structured `409`; Catalog calls the helper after locking |
| Resolver batch cardinality | A batch-capable service has no existing cardinality contract | New public service | Limit one `normalizeMany` call to 1,000 requests and reject larger input before persistence reads, preserving the fixed per-scope query budget |
| New normalization failures | Existing Catalog/Sales i18n has no keys for the new public UoM error codes | `catalog/i18n`; `sales/i18n`; `packages/shared/AGENTS.md` | Add module-owned translations and deterministic code-to-message adapters; never expose raw codes as user copy |
| Sales evidence | Entered/base unit and quantity, factor, rounding, source, normalized result | `sales/lib/types.ts`; `sales/data/entities.ts` | Preserve and bridge |

### Existing exact-decimal code decision

`packages/core/src/modules/dashboards/lib/exactDecimal.ts` proves the repository already has a BigInt-based representation, but its parser accepts exponent notation and the module-local API is designed for dashboard aggregation. P1.3a does not import that private Catalog-unrelated path. Implementation extracts or reimplements only the reusable representation after comparing its tests and behavior against this contract. The new shared API rejects exponent notation and has no domain imports. A new production dependency is not approved by this specification.

## Architecture and Contract

### Ownership

- Catalog owns product base unit, direct product conversion factors, and product rounding policy.
- Variants inherit all UoM policy from their parent product in P1.3a.
- Sales consumes the Catalog resolver and owns its document snapshots.
- Pure decimal operations live in `shared`; they contain no product, tenant, persistence, or module logic.
- Cross-module links remain scalar IDs. No new ORM relationship is introduced.
- Sales has a hard module dependency on Catalog today, so product-backed Sales normalization resolves the Catalog DI service directly. Catalog never imports or resolves Sales or Manufacturing.
- Manufacturing is only a future consumer of the published Catalog snapshot. BOM/yield persistence and arithmetic are not deliverables of P1.3a.

### Canonical decimal

Authoritative service inputs and outputs are base-10 strings. The canonical form:

- accepts the lexical grammar `^-?\d+(?:\.\d+)?$`; at least one integer digit and, when a decimal point is present, at least one fractional digit are required;
- rejects exponent notation, locale separators, whitespace, infinity, and `NaN`;
- removes redundant leading integer zeroes and trailing fractional zeroes;
- serializes zero as `"0"` and never `"-0"`.

Existing routes continue accepting published JSON numbers, but compatibility adapters convert finite numbers to their shortest round-trippable plain base-10 representation and validate the same scale/range envelope before domain arithmetic. This preserves the numeric value received by JavaScript; it cannot recover decimal digits already lost by the external client. New and first-party callers use strings for exact values. Quantity persistence, normalization and tier comparisons do not use JavaScript `number`; existing monetary calculation contracts remain unchanged by P1.3a.

The shared parser rejects an operand containing more than 256 decimal digits before constructing any `BigInt` and throws `decimal.precision_limit`. Catalog and Sales adapters perform their tighter length/scale/range checks before calling the shared parser: the resolver envelope is non-negative `numeric(18,6)`, a factor is positive `numeric(24,12)` and `<= 1000000`, and the normalized result must fit non-negative `numeric(18,6)`. Each existing API retains any stricter published bound—Sales keeps `MAX_QUANTITY = 999999999`, and its exact companion must satisfy the same bound. Pure shared helpers continue supporting signed inputs for reversal/future consumers. A caller may impose a stricter business minimum, such as strictly positive pricing quantity, before normalization.

Implementation first evaluates existing repository exact-decimal code. A new production dependency requires separate approval.

The public import path is **`@open-mercato/shared/lib/decimal`**. P1.3a adds these stable string-oriented exports:

```ts
export type ExactRoundingMode = 'half_up' | 'down' | 'up'
export type ExactDecimalErrorCode =
  | 'decimal.invalid'
  | 'decimal.precision_limit'
  | 'decimal.scale_out_of_range'

export declare class ExactDecimalError extends Error {
  readonly code: ExactDecimalErrorCode
  constructor(code: ExactDecimalErrorCode, message?: string)
}

export function canonicalizeDecimal(value: string): string
export function compareDecimals(left: string, right: string): -1 | 0 | 1
export function multiplyDecimals(left: string, right: string): string
export function negateDecimal(value: string): string
export function roundDecimal(value: string, scale: number, mode: ExactRoundingMode): string
export function applyExactQuantityPolicy(input: {
  enteredQuantity: string
  toBaseFactor: string
  scale: number
  mode: ExactRoundingMode
}): string
```

Invalid syntax, excessive input length or a requested rounding scale outside the shared `0..18` arithmetic envelope throws the exported `ExactDecimalError` with one of the frozen codes above. The optional message is diagnostic only; consumers branch on `code`. Catalog maps invalid entered quantity syntax/range to `uom.invalid_quantity`, invalid factor syntax/range to `uom.invalid_factor`, invalid stored rounding policy to `uom.invalid_rounding_policy`, and arithmetic/result overflow to `uom.precision_overflow`. Future capabilities may add operations to this path without changing the published function signatures.

### Rounding

- The existing product scale `0..6` remains authoritative.
- `half_up`, `down`, and `up` are all implemented and tested.
- Normalization performs exact multiplication, then rounds once to product scale.
- For signed values, the rounding policy applies to magnitude before restoring the sign. This makes negation deterministic for downstream reversals.
- Already normalized values are not re-rounded by consumers.
- Intermediate multiplication retains sufficient digits for an `18,6` entered quantity and `24,12` factor; overflow is checked before and after rounding.

Catalog uses `applyExactQuantityPolicy` after resolving policy; the Sales UI may use the same function for preview with already loaded factor/policy data. The Catalog service remains authoritative and re-resolves on every write.

### Unit dictionary policy

Operational resolution follows one deterministic rule:

1. Derive lookup/collision keys for stored and entered codes with the shared trim/lowercase/alias rules.
2. Resolve at most one active, non-deleted dictionary from the accepted keys `measurement_units`, `units`, and `unit`; if multiple exist, choose deterministically by `createdAt ASC, id ASC`, matching the existing oldest-active-dictionary behavior.
3. `DictionaryEntry` has no independent active/delete lifecycle in the current data model. If the configured measurement-unit dictionary exists, every base and alternate code must resolve to a scoped entry in that selected dictionary. The returned dictionary code preserves legacy behavior: trimmed non-empty entry `value`, otherwise canonicalized `normalizedValue`. Alias/duplicate comparisons use a separate shared-canonicalized key and do not rewrite the returned entry value.
4. If the dictionary is absent for the requested tenant/organization scope, preserve the Catalog legacy fallback and use the shared canonical code directly.
5. If the dictionary exists but a required scoped entry is missing, fail with `uom.unit_not_found`. P1.3a does not invent entry lifecycle columns and therefore requires no dictionary migration.
6. Reject a conversion whose effective canonical alternate code equals the canonical base code or collides with another active alternate code, including case, alias and `normalizedValue` collisions.

This policy makes scoped dictionary absence backward compatible without allowing a partially configured selected dictionary to be silently bypassed.

### Catalog resolver

Catalog registers the additive DI key **`catalogQuantityNormalizationService`** from `packages/core/src/modules/catalog/di.ts` with **request scope**, because the implementation resolves the request-scoped entity manager and may memoize reads only for that request/container. The public service interface, request/snapshot types and error class are exported from **`@open-mercato/core/modules/catalog/services/quantityNormalization`**. The persistence-backed factory remains internal to Catalog and is not a public construction contract. The DI key and public type path become stable after release and follow `BACKWARD_COMPATIBILITY.md`.

The frozen public interface is:

```ts
export type QuantityNormalizationScope = {
  readonly tenantId: string
  readonly organizationId: string
}

export type QuantityNormalizationRequest = {
  readonly scope: QuantityNormalizationScope
  readonly productId: string
  readonly productVariantId?: string | null
  readonly enteredQuantity: string
  readonly enteredUnitCode?: string | null
  readonly missingEnteredUnitPolicy: 'base' | 'default_sales'
}

export type QuantityNormalizationSnapshotV1 = {
  readonly version: 1
  readonly productId: string
  readonly productVariantId: string | null
  readonly baseUnitCode: string
  readonly enteredUnitCode: string
  readonly enteredQuantity: string
  readonly toBaseFactor: string
  readonly normalizedQuantity: string
  readonly rounding: { readonly mode: 'half_up' | 'down' | 'up'; readonly scale: number }
  readonly unitPricePolicy: {
    readonly enabled: boolean
    readonly referenceUnitCode: 'kg' | 'l' | 'm2' | 'm3' | 'pc' | null
    readonly baseQuantity: string | null
  }
  readonly source: { readonly conversionId: string | null; readonly resolvedAt: string }
}

export type QuantityNormalizationErrorCode =
  | 'uom.product_not_found'
  | 'uom.unit_not_found'
  | 'uom.default_unit_missing'
  | 'uom.conversion_not_found'
  | 'uom.invalid_quantity'
  | 'uom.invalid_factor'
  | 'uom.invalid_rounding_policy'
  | 'uom.ambiguous_conversion'
  | 'uom.precision_overflow'
  | 'uom.variant_product_mismatch'
  | 'uom.batch_too_large'

export declare class QuantityNormalizationError extends Error {
  readonly code: QuantityNormalizationErrorCode
  readonly details?: Readonly<Record<string, string | number | boolean | null>>
  constructor(
    code: QuantityNormalizationErrorCode,
    details?: Readonly<Record<string, string | number | boolean | null>>,
  )
}

export const CATALOG_QUANTITY_NORMALIZATION_MAX_BATCH_SIZE = 1000 as const

export interface CatalogQuantityNormalizationService {
  normalize(request: QuantityNormalizationRequest): Promise<QuantityNormalizationSnapshotV1>
  normalizeMany(requests: readonly QuantityNormalizationRequest[]): Promise<readonly QuantityNormalizationSnapshotV1[]>
}
```

`QuantityNormalizationError` carries no HTTP concern. Details are optional, non-sensitive scalar diagnostics only; route/command adapters map `code` using the failure table below.

The service:

1. scopes every read by tenant and organization;
2. verifies that an optional variant belongs to the product;
3. applies the unit dictionary policy and requires a canonical product base unit;
4. applies the required missing-unit policy: `base` selects the base unit, while `default_sales` selects `defaultSalesUnit` and falls back to the base unit;
5. resolves the implicit base factor `1` or exactly one active direct factor;
6. applies exact multiplication and product rounding once;
7. rejects invalid configuration and overflow;
8. returns canonical strings, unit-price policy required by the existing Sales snapshot enrichment, and immutable normalization evidence.

Catalog operational callers, product listing and pricing pass `missingEnteredUnitPolicy: 'base'`. Sales product-backed callers pass `missingEnteredUnitPolicy: 'default_sales'`, preserving the current `quantityUnit ?? defaultSalesUnit ?? baseUnit` behavior. Requiring the policy prevents a new caller from inheriting an accidental default.

`normalizeMany([])` returns `[]`. A call accepts at most `CATALOG_QUANTITY_NORMALIZATION_MAX_BATCH_SIZE` (1,000) requests in total. It validates this cardinality before grouping or performing any persistence read; a larger call rejects with `uom.batch_too_large` and non-sensitive details `{ maxBatchSize, actualBatchSize }`. Callers with more work must split it into calls of at most 1,000 items; the service does not hide unbounded SQL `IN (...)` lists or memory growth behind its fixed read-count contract.

For an accepted non-empty batch, `normalizeMany` preserves input order and rejects the whole call on the first invalid item **by original input index**; it never returns a partial result. It groups requests by `(tenantId, organizationId)`, deduplicates product and variant IDs, and issues no per-request or per-product query. The contract test permits at most five persistence reads per distinct scope within one accepted batch: all product policies, all requested variants, all active conversions, the active measurement-unit dictionary selection, and all scoped entries of the selected dictionary. When no dictionary exists, the entries read may be skipped. Results may be computed in grouped order, but error selection and returned snapshots follow original input order.

The default service does not use a process-shared cache in P1.3a. Request/container-local memoization may deduplicate identical reads. Any later cross-request cache must resolve the `cache` DI token, scope keys/tags by tenant and organization, tag by product, invalidate after committed product/conversion writes, and receive a separate cache-consistency review.

### Failure contract

| Error | HTTP mapping when adapted | Meaning |
|---|---|---|
| `uom.product_not_found` | `404` | Product is unknown in the requested scope |
| `uom.unit_not_found` | `400` | Entered/base unit is not valid |
| `uom.default_unit_missing` | `422` | Product has no operational base unit |
| `uom.conversion_not_found` | `422` | No active direct factor exists |
| `uom.invalid_quantity` | `400` | Entered quantity has invalid syntax, sign, scale or range |
| `uom.invalid_factor` | `422` | Factor is outside the accepted envelope |
| `uom.invalid_rounding_policy` | `422` | Persisted scale/mode is outside the supported product policy |
| `uom.ambiguous_conversion` | `422` | More than one effective canonical conversion matches or configured aliases collide |
| `uom.precision_overflow` | `422` | Exact multiplication intermediate or normalized result exceeds the output contract |
| `uom.variant_product_mismatch` | `404` | Variant is unknown or not owned by the scoped product |
| `uom.batch_too_large` | `400` | `normalizeMany` received more than 1,000 requests; it fails before persistence reads |

HTTP/command ingress may reject before invoking the Catalog service with these adapter-owned codes:

| Error | HTTP mapping | Meaning |
|---|---|---|
| `uom.quantity_mismatch` | `400` | Numeric compatibility quantity and authoritative `quantityExact` do not describe the same JavaScript numeric value |
| `uom.exact_value_mismatch` | `400` | A numeric persistence compatibility field and its authoritative `*Exact` companion do not describe the same JavaScript numeric value; adapter details identify the field |
| `uom.variant_without_product` | `400` | A Sales line supplies a variant without a product |
| `uom.unit_without_product` | `400` | A Catalog pricing request supplies `quantityUnit` without a product or variant target that can own a conversion policy |

Operational resolution fails closed. A request carrying `productId` never degrades to the productless Sales identity path when the product is missing. A Catalog price-list request without `productId` and `variantId` uses exact identity quantity only when `quantityUnit` is absent. Supplying `quantityUnit` without either target fails with `uom.unit_without_product`; an explicit unit is never silently treated as raw quantity. Variant-only price queries remain supported and resolve the scoped parent product before normalization.

### Error adapters and localization

- `QuantityNormalizationError` remains transport-neutral. HTTP/command adapters preserve its stable `code`, select the status from the tables above, translate the user-facing `error` message with `resolveTranslations()`, and include only the allowlisted scalar diagnostics from `details`.
- Shared additively exports a typed `codedCrudError` helper from `@open-mercato/shared/lib/crud/errors` while retaining the existing `badRequest`, `notFound`, `conflict` and related exports:

  ```ts
  export type CodedCrudErrorStatus = 400 | 404 | 409 | 422
  export type CodedCrudErrorDetails = Readonly<Record<string, string | number | boolean | null>>

  export function codedCrudError(input: {
    readonly status: CodedCrudErrorStatus
    readonly code: string
    readonly message: string
    readonly details?: CodedCrudErrorDetails
  }): CrudHttpError
  ```

  The helper receives an already translated message and constructs `{ code, error: message, details? }`. Catalog and Sales adapters use it instead of directly instantiating `CrudHttpError`; module-specific codes and translations remain owned by the adapting module.
- Catalog owns translation keys for every service error surfaced through Catalog and for Catalog-owned adapter errors. Sales owns translation keys for every service error surfaced through a Sales command/UI plus `uom.variant_without_product` and other Sales-local validation copy. The stable code remains identical across adapters, while each user-facing module resolves its own localized message and never renders the raw code as copy.
- All locale files required by repository policy receive the new keys. Client validation/toasts use `useT()`, server adapters use `resolveTranslations()`, and no new user-facing English literal or error code is rendered directly.
- Adapter contract tests cover status, stable code, localized non-empty `error`, redacted details and the absence of raw quantities, customer data or document data. Translation checks cover every public UoM code in each required locale.

## Data Models

P1.3a adds no table or column. Existing `numeric(24,12)` conversion storage and Sales snapshot/version columns remain authoritative.

### Conversion/default-sales exact input and output

- Existing Catalog numeric request properties retain their published TypeScript types: conversion create still requires `toBaseFactor: number`, conversion update keeps it optional, and product create/update keep optional `defaultSalesUnitQuantity: number`.
- Existing conversion/product schemas add optional string companions `toBaseFactorExact?: string` and `defaultSalesUnitQuantityExact?: string`. No existing required property is widened to `string | number`. Newly introduced nested `uomConversions` and the aggregate edit route are exact-first and require string fields directly, because they have no legacy numeric contract to preserve.
- When an exact companion is present, it is validated against the appropriate decimal envelope and is the sole persistence operand. Its numeric sibling is compatibility evidence only. If both are present, `Number(exact)` must equal the finite numeric sibling or the adapter rejects the request with `uom.exact_value_mismatch` and field details.
- When an exact companion is absent, the numeric value follows the compatibility adapter and becomes the shortest round-trippable plain decimal before persistence. Digits already lost by a client cannot be recovered.
- Existing response fields `to_base_factor` and `default_sales_unit_quantity` remain JSON numbers. Responses add `to_base_factor_exact: string` and `default_sales_unit_quantity_exact: string`; first-party Catalog UI and new internal callers prefer the exact fields.
- Command snapshots and undo/redo retain the exact persisted strings.

The product form model keeps conversion factors and `defaultSalesUnitQuantity` as strings from load/input through submit. It reads the exact response fields preferentially. First-party aggregate edit and nested create submit exact strings directly and do not derive numeric duplicates. Calling `Number` is permitted only when adapting to an existing legacy route/property that requires or receives a numeric compatibility sibling and for its mismatch guard; the resulting number must never feed authoritative persistence, duplicate validation or exact preview arithmetic.

### Exact quantity ingress and pricing handoff

Published numeric fields remain intact. P1.3a adds an optional `quantityExact?: string` companion to Sales line create/update inputs, Catalog product-list quantity input, Catalog price-list quantity input, and `PricingContext`. It does not widen or replace the existing required `quantity: number` TypeScript field.

- When `quantityExact` is present, adapters validate it against the operational `numeric(18,6)` envelope and use it as the sole normalization/tier-comparison operand.
- When both fields are present, `Number(quantityExact)` must equal the finite compatibility `quantity`; disagreement fails with `uom.quantity_mismatch` (`400`) rather than allowing the pricing and normalization paths to use different quantities. This numeric conversion is a compatibility consistency guard, not a business calculation.
- When `quantityExact` is absent, the compatibility adapter derives the shortest round-trippable plain decimal from the numeric field. Digits already lost by the client cannot be reconstructed.
- First-party quantity inputs retain the raw decimal text, submit both fields, and never reconstruct `quantityExact` from the parsed number.
- `selectBestPrice` and native tier matching prefer `PricingContext.quantityExact` and compare it to integer tier bounds with `compareDecimals`; the existing numeric field remains available unchanged to third-party resolvers and event consumers.

`quantityExact` is an input/context companion, not a new database column or a newly required line-response field. Sales persists the authoritative value in the existing `uomSnapshot.enteredQuantity`; when editing an older line without snapshot evidence, the UI falls back to the shortest round-trippable decimal derived from the published numeric quantity. Catalog list-query companions are request-only. OpenAPI marks every exact companion optional and documents the mismatch rule.
- Quantity-sensitive Catalog list routes resolve the exact normalized quantity before database count/pagination and include the min/max tier predicate in the database query. They must not filter the paged result in `afterList` or recompute totals from the current page.

The exact guarantee in P1.3a covers quantity normalization, persisted quantity evidence and native tier comparisons. Existing monetary calculation inputs/outputs remain governed by the Sales calculation contract and are not silently changed to a new money arithmetic model here.

### Sales snapshot mapping

For product-backed lines, Sales maps the normalization fields from the Catalog snapshot losslessly into the existing `SalesLineUomSnapshot` V1 shape and duplicates its normalized quantity/unit scalar columns. When `unitPricePolicy.enabled` is true, Sales maps `referenceUnitCode` and `baseQuantity` into the existing optional `unitPriceReference` and performs the existing Sales-owned gross/net-per-reference enrichment. `baseQuantity` is a lossless string representation of the value already persisted by Catalog; P1.3a does not add an exact request companion to the existing monetary/unit-price configuration and does not claim to recover digits lost before that persistence. This preserves current snapshot evidence without moving monetary calculations into Catalog. Existing snapshots remain readable and are never recalculated.

For a Sales line without `productId`:

- Sales does not call `catalogQuantityNormalizationService`;
- it canonicalizes the optional entered unit with the shared unit-code helper;
- it obtains the authoritative entered quantity through the exact/compatibility ingress above, applies the existing Sales compatibility policy `half_up`/scale `6`, and uses factor `1`;
- `productId` and `productVariantId` remain `null`, and base/entered unit fields remain nullable as allowed by the published Sales snapshot;
- an alternate conversion is not inferred, because there is no product-owned conversion policy.

Supplying a non-null `productId` that cannot be resolved is an error and never selects this identity path.
Supplying `productVariantId` without `productId` fails Sales validation with `uom.variant_without_product` (`400`); it is not silently discarded or written as productless evidence.

## API and Command Contracts

### Atomic Catalog UoM configuration save

Product creation and existing-product editing use two compatible atomic paths:

1. The existing product-create schema accepts an additive optional exact-first `uomConversions` array with `{ unitCode, toBaseFactorExact, sortOrder?, isActive? }`; conversion IDs are server-assigned. When the property is present—even as an empty array—`catalog.products.create` validates the complete candidate and persists the product, UoM policy and conversion rows inside its existing transaction. The first-party create UI always sends the property and uses `defaultSalesUnitQuantityExact` for the existing optional product quantity. A legacy client that omits `uomConversions` retains the existing create behavior and is not subjected to new complete-set validation; such a product may later fail operational normalization until its configuration is repaired through a validated UoM mutation. This compatibility exception is explicit and does not apply to aggregate edit, conversion CRUD or a product update that touches UoM fields.
2. The existing-product editor submits UoM policy plus the complete desired conversion set through one Catalog command, `catalog.product_uom_configuration.save`, exposed by an additive custom write route:

```text
PUT /api/catalog/products/{id}/uom-configuration
```

Conceptual validated request after path/auth authority is restored:

```ts
type SaveProductUomConfigurationRequest = {
  defaultUnit: string | null
  defaultSalesUnit: string | null
  defaultSalesUnitQuantityExact: string
  uomRoundingScale: number
  uomRoundingMode: 'half_up' | 'down' | 'up'
  conversions: readonly {
    id?: string | null
    unitCode: string
    toBaseFactorExact: string
    sortOrder?: number
    isActive?: boolean
  }[]
  updatedAt: string
}
```

Successful edit returns the committed canonical aggregate so the UI can replace its local state and optimistic token without follow-up mutations:

```ts
type SaveProductUomConfigurationResponse = {
  id: string
  updatedAt: string
  defaultUnit: string | null
  defaultSalesUnit: string | null
  defaultSalesUnitQuantityExact: string
  uomRoundingScale: number
  uomRoundingMode: 'half_up' | 'down' | 'up'
  conversions: readonly {
    id: string
    unitCode: string
    toBaseFactorExact: string
    sortOrder: number
    isActive: boolean
  }[]
}
```

This new aggregate route is exact-first and has no duplicate numeric decimal fields. Existing product/conversion routes retain their published numeric properties and use the optional-companion/mismatch rules above. Conversion `metadata` is deliberately not editable through the first-party aggregate: a submitted existing row identified by `id` preserves its stored metadata byte-for-byte, a new row starts with `null`, and a removed row is deleted with the rest of its state. Snapshots include metadata so undo/redo remains complete. The update route exports `openApi` and per-method metadata, requires the existing `catalog.products.manage` feature, resolves scope from authenticated context, runs mutation guards, revalidates a guard-modified payload, restores path/scope authority, and executes the command.

The unconditional aggregate version floor reuses Shared ownership rather than constructing an HTTP error in Catalog. `@open-mercato/shared/lib/crud/optimistic-lock-command` additively exports a helper conceptually equivalent to:

```ts
export function assertRequiredOptimisticLock(input: {
  readonly expected: string | Date
  readonly current: string | Date
}): void
```

The caller schema must already have rejected a missing or invalid expected token, and a non-canonical stored current value is an internal data-contract failure rather than a reason to bypass the check. The helper canonicalizes both instants and, on mismatch, owns construction of the existing structured `409` body (`code`, `error`, `currentUpdatedAt`, `expectedUpdatedAt`). It does not read `OM_OPTIMISTIC_LOCK` and cannot be disabled by resource allowlists. Existing configurable optimistic-lock exports keep their published behavior. Catalog and other module callers must not instantiate `CrudHttpError` or rebuild this body directly.

The concurrency and transaction contract is:

1. Every command that changes UoM on an **existing** product—including aggregate edit, `catalog.products.update` when any UoM policy field is present, legacy conversion create/update/delete, and their undo/redo handlers—starts a transaction and acquires a scoped pessimistic write lock on the product row **before** conversion-row locks. Existing conversion rows are then locked in deterministic `id ASC` order. Product create and create redo are the explicit exception: no committed root row exists to lock, so they insert the product and nested conversions in one transaction; no conversion command can target that uncommitted product.
2. After acquiring the product lock, aggregate edit passes the already schema-validated request `updatedAt` and current product version to `assertRequiredOptimisticLock`. This domain precondition is unconditional even when `OM_OPTIMISTIC_LOCK=off` or excludes `catalog.product`; therefore the configurable `enforceCommandOptimisticLock` helper is not used as the sole check. A mismatch returns the existing standard structured `409` without writing. Optional platform/enterprise guards may still run as enrichment but cannot weaken this floor.
3. Every successful UoM mutation, including a conversion-only legacy mutation or undo/redo, monotonically advances `product.updatedAt`; if the clock value is not later than the stored value, use stored value plus one millisecond. Aggregate edit advances it exactly once per commit.
4. Because every writer for an existing product locks the same product root, concurrent conversion inserts cannot bypass the aggregate lock as phantoms. No migration or canonical-key database constraint is required for P1.3a.
5. Under the lock, the command resolves dictionary aliases and validates the complete **post-mutation candidate set**: base/default-sales relationship, quantity/rounding envelopes, membership in the selected active/non-deleted dictionary when one exists, factor envelope, IDs owned by the product/scope, and no effective canonical duplicate or base-unit alias. Existing invalid data may still be repaired by a delete/deactivate/update whose resulting candidate is valid; validation does not require the pre-mutation set to pass.
6. Product policy plus conversion creates/updates/deletes commit in one transaction. Validation or any product/conversion persistence failure rolls back the complete aggregate.

The edit UI follows every conversion-list page until the server-reported total is loaded before enabling aggregate save; it does not assume the current `pageSize=100` response is complete. P1.3a introduces no new domain cardinality limit. The server treats the submitted list as the complete desired set only after validating every item and the optimistic product version.

Action-log before/after snapshots include the complete product UoM policy and every conversion row as exact strings. For every existing-product UoM mutation, `execute` captures the authoritative `snapshotBefore` **after acquiring the product/conversion locks and before applying changes**, then captures `snapshotAfter` after the final flush but before leaving the same transaction. The internal command result carries these snapshots/undo evidence to `buildLog`; the route maps only the declared public response and never exposes the internal action-log payload. This follows the existing native pattern where `buildLog` reads undo evidence from `result`.

The UoM handlers must not use the command bus `prepare` snapshot as authoritative undo evidence, because `prepare` runs before `execute` and therefore before the root lock. They also must not rely on an unlocked post-execute `captureAfter` read for the committed aggregate snapshot. Contract tests pause a legacy conversion writer between preparation and locked execution, allow another writer to commit, and prove that the logged `snapshotBefore` is the exact state actually replaced. Product create has no prior committed root: it records `snapshotBefore = null` and captures the complete created `snapshotAfter` inside its transaction. Product-create redo recreates nested conversions and their side effects. Update/legacy undo and redo use semantic preconditions, restore the configuration under the same product-root lock and advance the root version.

The snapshots are persisted by the existing command bus after handler execution, following current platform ordering; P1.3a does not claim that audit-log persistence is inside the aggregate database transaction. A post-commit action-log persistence failure therefore keeps the residual behavior documented below.

After commit, create emits the existing `catalog.product.created` event once plus `catalog.product_unit_conversion.created` for created rows. Edit, legacy conversion mutations and all undo/redo paths emit `catalog.product.updated` once plus the matching existing `catalog.product_unit_conversion.created|updated|deleted` events for changed rows. No new event ID is introduced. CRUD/index/event/cache side effects and guard `afterSuccessCallbacks` run after commit and fail soft. A command-bus action-log persistence failure follows existing platform semantics: the command surfaces the error although the already committed aggregate is not rolled back; it must be logged/alerted and covered by a framework-behavior test rather than represented as aggregate rollback.

Existing product and conversion URLs/methods remain functional. Their single-resource operations preserve published numeric inputs, add optional exact companions and retain semantic undo behavior, while UoM mutations on existing products gain the shared product-root coordination invariant above. `catalog.products.update` invokes complete candidate validation only when the payload touches `defaultUnit`, `defaultSalesUnit`, `defaultSalesUnitQuantity`, either UoM rounding field, or an exact companion; unrelated product edits do not become dependent on dictionary/UoM validity. Callers that intend to change base policy and factors as one semantic operation must use the atomic create extension or edit aggregate endpoint. The first-party create UI always supplies nested `uomConversions`; the edit UI uses the aggregate endpoint. This is an additive migration path rather than a breaking removal.

### Normalization service, not HTTP

P1.3a adds no HTTP normalization route. Catalog product listing and price filtering invoke the DI service internally. Sales invokes it from command handling for product-backed lines. All write inputs are validated with Zod before resolver/business logic. Catalog price filtering resolves normalization before the database list/count operation; an `afterList` hook must not remove quantity-ineligible rows.

### Pricing tier and list filtering

- `PricingContext.quantity` remains required and numeric for compatibility; optional `quantityExact` is additive.
- Native `selectBestPrice` tier eligibility uses `quantityExact` when present and exact decimal comparison against integer `minQuantity`/`maxQuantity`. It falls back to the numeric field only for legacy callers.
- Existing resolver callbacks and event payloads keep receiving the numeric field; P1.3a does not change price precedence, scoring or resolver order.
- `/api/catalog/prices` and product-list pricing normalize the requested product quantity before tier selection. The normalized exact value is carried through database predicates/service selection without a JavaScript multiplication or comparison.
- Price-list quantity predicates are applied before `COUNT`, ordering, offset and limit. `items`, `total` and `totalPages` describe the same filtered set. The existing `afterList` quantity filter is removed, not supplemented.
- Variant-only price queries continue resolving the parent product within tenant/organization scope before normalization.
- A price-list query with no product/variant and no `quantityUnit` applies the exact input as an identity quantity to global tier predicates. The same request with `quantityUnit` fails with `uom.unit_without_product` because no product-owned conversion policy exists.

### Sales preview

The existing Sales line dialog keeps its current UI structure. Its raw quantity text becomes `quantityExact`; the existing parsed `quantity` remains the compatibility/calculation field. The displayed normalized preview uses the shared exact policy function with exact strings from already loaded product/conversion data, including the product rounding mode and scale. The client models are extended additively: `ProductOption` retains numeric `defaultSalesUnitQuantity` and adds `defaultSalesUnitQuantityExact: string | null` plus rounding mode/scale; `UnitOption` retains numeric `toBaseFactor` and adds `toBaseFactorExact: string | null`. Mapping prefers `default_sales_unit_quantity_exact` and `to_base_factor_exact`; numeric values are compatibility fallbacks only. Selecting a product seeds the raw quantity text from `defaultSalesUnitQuantityExact` before deriving the numeric field. Preview never reconstructs an exact operand from a number when exact evidence is available. No additional preview request is added. The preview is explicitly non-authoritative: save re-resolves in Catalog and the response/snapshot replaces the preview. A mismatch caused by concurrent configuration change is surfaced by the saved result, not silently retained from the client.

## Migration & Backward Compatibility

- No database migration or backfill is required.
- Existing API URLs, HTTP methods, numeric request fields, numeric response fields, Sales snapshot V1 rows, DI services, event IDs, and import paths are not removed or narrowed.
- Exact request companions `toBaseFactorExact`, `defaultSalesUnitQuantityExact` and `quantityExact`, `PricingContext.quantityExact`, plus exact response fields `to_base_factor_exact` and `default_sales_unit_quantity_exact`, are additive. Existing numeric TypeScript properties retain their types; no existing property is widened to `string | number`.
- `catalogQuantityNormalizationService`, `CATALOG_QUANTITY_NORMALIZATION_MAX_BATCH_SIZE`, `codedCrudError`, `assertRequiredOptimisticLock` and their public import paths are new additive contract surfaces. Once released they follow the normal deprecation protocol; existing Shared error and configurable optimistic-lock exports remain unchanged.
- Existing product/conversion commands remain supported. UoM mutations on existing products gain a product-root lock/version bump as an internal integrity behavior; the aggregate UoM command is the recommended atomic path for coupled changes. Unrelated `catalog.products.update` calls do not run UoM candidate validation.
- Existing Sales snapshots are preserved byte-for-byte on read/copy. Only new or explicitly edited product-backed lines use the new resolution behavior.
- A product-backed Sales line that omits `quantityUnit` continues selecting `defaultSalesUnit`, then base unit. Catalog operational callers continue selecting base unit. The new required resolver policy makes this distinction explicit.
- Existing unit-price-reference fields and quote→order/invoice snapshot copying are preserved. Catalog supplies product policy; Sales continues owning monetary enrichment.
- Correct price-list quantity filtering now occurs before pagination, so `items`, `total` and `totalPages` may differ from the previously inconsistent `afterList` result. This is a documented correctness fix, not a response-shape change.
- Operational normalization and validated UoM mutations fail closed for invalid configuration. A legacy product create that omits the new `uomConversions` property remains behaviorally unchanged and may create a product that cannot normalize alternate/default-sales units until repaired. First-party create always sends the property and receives complete-set validation. Release/upgrade notes document both the compatibility exception and the repair path.
- No backfill rewrites existing unit codes. Existing dictionary/alias collisions fail operational resolution until repaired; candidate-state validation allows corrective delete/deactivate/update operations.
- Dictionary output continues returning trimmed entry `value`; `normalizedValue` and the shared canonical key participate in lookup and collision detection but do not silently replace the published unit code.
- `productVariantId` without `productId`, explicit Catalog pricing unit without a product/variant target, and disagreement between a numeric compatibility field and its exact companion are newly rejected as contradictory inputs; release notes list these validation changes.

## Implementation Plan

### Phase 1 — Exact decimal and conversion precision

| Task | Deliverable | Evidence |
|---|---|---|
| A1 | Classify every Catalog/Sales normalization and preview call site | Reviewed inventory in the readiness artifact with no unclassified product-backed path |
| A2 | Pure bounded shared exact-decimal representation and policy application | Unit tests for canonical form, signs, ties, modes, shared scale `0..18`, pre-`BigInt` precision limit, domain overflow, negative zero and rejected notation |
| A3 | Additive exact companions, typed Shared coded-error adapter and localized public UoM failures | Unit/API tests proving string round trips, unchanged numeric TypeScript properties, numeric/exact mismatch rejection, no authoritative `number` conversion, helper-owned error bodies and complete locale-key coverage |

This phase is independently testable, but it is not an independently releasable capability: conversion CRUD preserves exact strings and the shared utility has no Catalog dependency, while the cross-surface inconsistency remains unresolved.

### Phase 2 — Catalog resolver and aggregate integrity

| Task | Deliverable | Evidence |
|---|---|---|
| A4 | Frozen request-scoped DI service, error type and bounded scope-batched method | Stable import-path, missing-unit-policy, deterministic-error, 1,000-item pre-read rejection, scope and maximum-five-read-per-accepted-batch contract tests |
| A5 | Atomic validated product-create extension, update aggregate and shared existing-product writer coordination | Aggregate-vs-product-update/conversion concurrency, create-with-property validation, create-without-property compatibility, Shared-owned unconditional version precondition, monotonic root version, rollback, guards, transaction-captured full snapshot undo/redo, alias collision and >100-row editor tests |
| A6 | Product-list, `selectBestPrice` and price-filter convergence | Exact tier boundary, variant-only and productless identity queries, explicit-unit-without-product rejection and pre-pagination count/page tests |

This phase produces the internal Catalog foundation required by Sales adoption. It must not be released or marked P1.3a-complete before Phase 3.

### Phase 3 — Sales adoption and compatibility

| Task | Deliverable | Evidence |
|---|---|---|
| A7 | Product-backed Sales command convergence | Exact ingress, preserved `defaultSalesUnit` fallback, Catalog snapshot mapping and `unitPriceReference` evidence |
| A8 | Productless Sales identity adapter | Service/shipping/discount/adjustment regressions, nullable evidence and variant-without-product rejection |
| A9 | Exact Sales preview | Exact ProductOption/UnitOption mapping, raw default-sales seeding and integration evidence that preview/save agree absent a concurrent policy change |
| A10 | Compatibility, isolation and user-facing error gate | Legacy numeric callers/snapshots, cross-tenant, quantity mismatch, variant mismatch, quote→order copy, unit-price conversion, coded adapter, Catalog/Sales translation and hardcoded-string regressions |

P1.3a is complete only when all three phases ship together; the phase boundaries provide reviewable test checkpoints, not partially supported public behavior.

## Acceptance Tests

- Factor `1` returns the same canonical quantity.
- `2.5 box × 12 pc/box` returns `30 pc`.
- Half ties differ correctly under `half_up`, `down`, and `up`, including signed inputs.
- The parser rejects `1.`, `.5`, exponent/locale/whitespace input and more than 256 decimal digits before allocating an unbounded `BigInt`.
- Twelve-decimal factors and scale `0..6` produce declared exact strings; invalid quantity, factor, rounding policy and result overflow return their frozen error codes.
- A twelve-decimal `toBaseFactorExact` submitted with its required numeric compatibility sibling survives create, read, update, command-log undo and redo without the numeric value feeding persistence; the legacy numeric-only request still works and the inferred numeric property type is unchanged.
- `defaultSalesUnitQuantityExact` follows the same exact load/edit/submit/undo path while its legacy numeric request/response remains available; a mismatched numeric/exact pair fails with `uom.exact_value_mismatch`.
- Maximum accepted input persists; the next value fails before database use.
- Product listing, price filtering, Sales preview and product-backed Sales line creation return the same normalization when they use the same committed policy and exact input.
- A legacy numeric quantity remains accepted; an exact companion is authoritative, a mismatched pair fails, and a first-party decimal text value survives to the Catalog request unchanged.
- `selectBestPrice` routes a high-magnitude six-decimal exact input through `compareDecimals` and chooses the correct integer-bounded tier, while custom pricing consumers still receive the published numeric field.
- Quantity-filtered price listing applies eligibility before pagination: multi-page fixtures return correct page membership, `total` and `totalPages`; variant-only queries normalize through the scoped parent product. A productless/unitless query uses exact identity quantity, while a productless query with `quantityUnit` fails with `uom.unit_without_product`.
- With no explicit Sales unit, a product-backed line uses `defaultSalesUnit` then base, while a Catalog operational request uses base. Both behaviors are selected explicitly in the resolver request.
- A productless Sales line uses factor `1`, keeps nullable product/unit evidence and never invokes Catalog; a non-null missing product fails, and a variant without a product fails validation.
- A missing dictionary uses canonical stored codes; a present active dictionary with a missing scoped entry fails. A fixture where entry `value` differs from `normalizedValue` returns trimmed `value` byte-for-byte apart from surrounding whitespace, while case, alias and `normalizedValue` collisions fail under the product lock.
- Changing a factor after Sales line creation does not change the old snapshot.
- Creating or editing product base policy and conversions through the first-party editor is one transaction; an injected product/conversion persistence failure rolls back the entire aggregate, and a stale edit `updatedAt` returns the standard `409` through `assertRequiredOptimisticLock` even with `OM_OPTIMISTIC_LOCK=off`. Shared helper tests freeze the body, and Catalog contains no direct `CrudHttpError` construction for this path. A separate action-log failure test documents the existing post-commit command-bus behavior without claiming rollback.
- A successful aggregate edit returns the canonical complete configuration, assigned conversion IDs and a strictly newer `updatedAt`; the editor replaces its local state from that response.
- Aggregate edit racing `catalog.products.update` touching UoM, each legacy conversion create/update/delete and their undo/redo serializes on the product root; no phantom conversion bypasses validation, and every conversion-only commit monotonically changes product `updatedAt`. An unrelated product update is not rejected solely because pre-existing UoM data is invalid.
- A product with 101+ conversions loads every conversion into the editor and an unchanged aggregate save does not delete rows beyond the first page or alter metadata on matched rows; a newly added aggregate row receives `metadata = null`.
- Product-create undo and redo remove/restore nested conversions, exact snapshots and matching product/conversion events; edit and legacy undo/redo do the same under the root lock. A race test commits a second writer after command-bus `prepare` but before the first writer acquires the lock and proves that `buildLog.snapshotBefore` equals the state actually replaced, not the stale prepared state; `snapshotAfter` equals the state flushed in that transaction.
- Product create accepts an exact-only twelve-decimal factor inside explicit `uomConversions`, rejects an alternate `defaultSalesUnit` without a valid active factor, and persists the whole candidate atomically; omitting the property preserves legacy create behavior, and subsequent normalization fails closed until a validated aggregate repair.
- A variant inherits its product policy; a variant from another product/scope fails closed.
- Explicit missing/invalid conversion never falls back to raw quantity.
- `normalizeMany` accepts 1,000 requests, preserves order, reports the first invalid request by original index and performs at most five reads per distinct tenant/organization scope. A 1,001-item call fails with `uom.batch_too_large` before any persistence read and reports only `maxBatchSize` and `actualBatchSize`; callers may chunk larger workloads explicitly.
- Product-backed mapping retains `unitPriceReference`; quote→order/invoice snapshot copying and unit-price conversion on unit change preserve their published behavior.
- Sales product selection seeds raw quantity from `default_sales_unit_quantity_exact`, and preview consumes `to_base_factor_exact`; high-precision fixtures prove neither value first passes through `number` arithmetic.
- Every public UoM failure maps to the declared status and stable code plus a localized non-empty `error`; Catalog/Sales locale coverage and hardcoded-string checks pass, and diagnostics never contain raw quantity, customer or document data.
- Integration fixtures are created through APIs and cleaned in `finally`/teardown.

P1.3a is complete when one exact resolver governs every successful product-backed Catalog/Sales normalization path, the explicit Sales productless adapter is covered, factor persistence is exact, and compatibility tests show no unintended contract break. It is the quantity prerequisite for stable draft/release contracts and unblocks P1.3b, but it does not define Manufacturing yield/persistence and does not by itself enable stock-affecting production.

## Risks & Impact Review

| Severity | Scenario and affected area | Mitigation and detection | Residual risk |
|---|---|---|---|
| Critical | A Catalog lookup resolves a factor from another tenant/organization, corrupting Catalog pricing and Sales snapshots. | Scope every product/variant/conversion query; never accept scope from HTTP body; adversarial cross-scope service/API tests; log only error code and scoped IDs. | Low after tests; a future unscoped query remains review-sensitive. |
| Critical | A Sales line without an explicit unit changes from `defaultSalesUnit` semantics to base-unit semantics during resolver adoption. | Required `missingEnteredUnitPolicy`; Sales/Catalog caller-specific regression tests with a non-1 default-sales conversion. | Low after contract tests; new callers must choose deliberately. |
| Critical | Aggregate, ordinary product update and legacy conversion writers race, allowing a phantom insert or stale `updatedAt` to bypass complete-set validation. | Every existing-product UoM mutation/undo locks the product first, uses a fixed lock order, validates under lock and monotonically advances root `updatedAt`; aggregate version comparison is unconditional; race all operation pairs in integration tests. | Low while all writes remain command-driven. |
| Critical | Command-bus `prepare` captures a conversion snapshot before the product-root lock, so a concurrent commit can make the action-log undo state stale even when the later write itself is serialized. | Capture authoritative before/after snapshots inside the same root-locked transaction, carry them through the internal command result to `buildLog`, and race a writer across the prepare→execute boundary. | Low while UoM handlers never use prepared/unlocked snapshots as undo evidence. |
| High | Product UoM policy commits while conversion synchronization fails, or post-commit action-log persistence fails and leaves a committed change without a new undo entry. | One transaction covers product and conversions; complete before/after snapshots and persistence rollback tests. Preserve command-bus ordering for audit logs, surface/alert log failures and document the platform-level residual risk. | Low for mixed data; medium for audit availability because action-log persistence is post-commit platform behavior. |
| High | Catalog hand-rolls the unconditional optimistic-lock conflict or another coded UoM error, drifting from Shared response contracts. | Add Shared-owned `assertRequiredOptimisticLock` and `codedCrudError` helpers, preserve existing configurable exports, and add response-shape/import-usage contract tests. | Low after callers are restricted to the shared helpers. |
| High | A factor, default-sales quantity or entered quantity loses digits through a JS `number` before persistence/comparison. | Additive `*Exact` companions without widening existing numeric properties, string-authoritative first-party flow, mismatch guards, exact Sales option mapping, exact tier comparison and round-trip/undo tests. | Medium for legacy numeric-only clients because already-lost client precision cannot be reconstructed. |
| High | Price filtering remains post-pagination and returns incorrect items/totals. | Remove the `afterList` quantity filter; resolve first and apply the predicate before count/offset/limit; multi-page integration tests. | Low after route tests. |
| High | The editor submits only the first 100 conversion rows as the complete set and deletes the remainder. | Fetch all pages before enabling save; test 101+ rows and unchanged aggregate save. | Low; very large products still depend on normal HTTP request limits. |
| High | Catalog snapshot mapping drops existing Sales `unitPriceReference` evidence. | Include Catalog-owned unit-price policy in the resolver snapshot; retain Sales-owned monetary enrichment and quote-copy regression tests. | Low. |
| High | A Catalog/Sales/UI path retains independent `number` quantity arithmetic or hard-coded rounding. | Exhaustive classified call-site inventory, shared pure preview function, exact pricing handoff and cross-surface golden corpus. Detect contract-test mismatch by caller. | Low after all classified paths migrate. |
| High | New configured rounding changes the result of an edited Sales line or price tier selection. | Preserve historical snapshots, limit new behavior to new/edited product-backed lines, retain quote→order copy behavior and publish upgrade notes. | Medium: corrected new-write results can differ intentionally from legacy calculations. |
| Medium | A tenant has a partially configured unit dictionary or canonical aliases collide. | Explicit absent-vs-present dictionary rule; require scoped entries in the selected active/non-deleted dictionary; preserve entry `value` output; canonical duplicate validation under the product lock. | Medium until operators repair invalid master data; entries have no separate lifecycle in P1.3a. |
| Medium | A legacy client omits `uomConversions` during product create and produces a configuration that cannot normalize its alternate/default-sales unit. | Preserve the create contract intentionally, fail closed during operational normalization, document the aggregate repair path and make first-party create always submit the complete property. | Medium until external clients adopt the exact aggregate extension. |
| Medium | Batch resolution regresses into per-product reads or accepts an unbounded ID list that exceeds SQL parameter/memory limits. | Reject more than 1,000 requests before reads; for accepted calls batch by scope with at most five reads per scope and cover both cardinality and query count. | Low; larger callers must perform explicit bounded chunking. |
| Medium | Concurrent configuration changes after Sales preview make the displayed value stale. | Treat preview as advisory; re-resolve during save and replace it with the authoritative snapshot. | Low; the user may observe a changed saved result and retry if needed. |
| Medium | New UoM failures surface as raw codes or untranslated English copy in Catalog/Sales UI. | Module-owned locale keys, server/client translation adapters, typed coded-error bodies and locale/hardcoded-string tests. | Low after every frozen public code is covered. |
| Medium | Shared exact parsing receives an unbounded operand or starts containing Catalog/Manufacturing policy. | Enforce the 256-digit pre-allocation bound; keep only decimal operands/policy parameters and verify import boundaries. | Low. |
| Low | A future cross-request resolver cache serves stale or cross-scope policy. | No cross-request cache in P1.3a; any later cache requires DI, tenant/org/product tags and post-commit invalidation review. | Low. |

Blast radius is limited to Catalog quantity-sensitive pricing and new/edited Sales lines; existing Sales evidence is immutable. Operational diagnostics must count normalization errors by code and caller without logging quantity payloads or customer/document data.

## Frontend Architecture Contract

- The existing `LineItemDialog.tsx` remains the client boundary; P1.3a adds no provider, page, route, or new `"use client"` file.
- The shared exact policy helper is isomorphic and contains no React, persistence, DI or server-only import.
- Sales quantity state retains raw decimal text for `quantityExact` alongside the existing parsed numeric field. Preview uses already loaded UoM policy and adds no network request, hydration dependency or list-level computation.
- Product UoM forms retain exact decimal strings. Edit loading follows all conversion pages before enabling save and submits the aggregate endpoint once; it does not issue follow-up per-row conversion mutations.
- No new production dependency is allowed, so the route bundle delta is limited to the pure helper; implementation records the before/after client chunk size and rejects an increase greater than 5 kB gzip without separate approval.
- Existing keyboard, dialog and design-system behavior is unchanged. Catalog/Sales add localized copy for the new UoM failures through existing i18n providers; no provider or translation mechanism changes. Any touched UI line follows the Boy Scout rule; client tests cover rendering/hydration, localized failures, raw-text preservation, exact preview update and load-failure disabling of aggregate save.

## Validation

Documentation validation:

```bash
git diff --check
yarn agents:check-budget
```

Implementation validation includes `yarn generate`, shared/core unit tests, `yarn workspace @open-mercato/shared build`, `yarn workspace @open-mercato/core build`, `yarn i18n:check-hardcoded`, `yarn i18n:check-values`, stable public-import verification, module-decoupling coverage, and self-contained Catalog/Sales integration tests under their module `__integration__` folders. No migration is applied.

## Readiness Review v4 — 2026-08-28

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

### Contract Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root/core | No direct cross-module ORM; scope every read/write | Specified | DI service uses scalar IDs, mandatory tenant/organization scope and bounded scope batching. |
| shared | Shared utilities and HTTP errors remain pure, precise, bounded and domain-free | Specified | Exact arithmetic has typed strings and a pre-allocation digit bound; generic coded errors and unconditional optimistic-lock response construction stay Shared-owned without Catalog/Manufacturing imports. |
| core | Domain mutations use commands, atomic transactions and undo | Specified | Existing-product UoM writers share one root lock/version invariant; authoritative before/after snapshots are captured inside that transaction and carried to `buildLog`, while create uses a documented no-existing-root exception. |
| core | Custom write routes use OpenAPI, metadata and mutation guards | Specified | Aggregate endpoint declares parse→guard→reparse→restore authority→command ordering. |
| core/catalog | Catalog pricing uses the resolver pipeline and existing selector | Specified | Exact quantity is additive; tier predicates execute before pagination without changing precedence/resolver order. |
| core/sales | Sales document math stays DI/service based | Specified | Product-backed UoM resolution preserves `defaultSalesUnit` semantics and existing unit-price-reference enrichment. |
| cache | Resolve cache through DI and scope/invalidate tags | N/A for MVP | No cross-request cache. Requirements are frozen for a future addition. |
| backward compatibility | Existing routes/types/fields/DI/imports are stable; changes additive | Specified | Numeric properties retain their types; request/response exact companions are additive; legacy create omission remains supported; intentional validation/correctness changes are documented. |
| QA | Integration tests are executable, self-contained and cleaned up | Specified | Acceptance covers precision, the 1,000-item batch ceiling, pagination, prepare→execute snapshot races, undo/redo, localization and API fixture cleanup. |
| UI/DS/i18n | Preserve canonical UI mechanisms and client boundaries | Specified | No new layout/provider; module-owned UoM translations, raw exact text, all-page conversion loading and load-failure behavior are explicit. |
| security/encryption | Validate inputs; PII encryption where applicable | Specified / N/A | Zod, bounded decimal parsing and scoped reads are required; quantity/UoM data is not PII and adds no sensitive column. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | DB decimal strings, unchanged numeric fields, additive `*Exact` companions and snapshots align without a migration; dictionary entries are not assigned nonexistent lifecycle fields. |
| API contracts match UI behavior | Pass | Sales retains raw quantity/default/factor strings through exact option fields; product edit loads the complete conversion set and saves once atomically. |
| Sales compatibility is explicit | Pass | Missing-unit behavior, productless/variant validation and `unitPriceReference` ownership are frozen. |
| Pricing correctness is explicit | Pass | Exact comparison and filtering before count/pagination are required while precedence stays unchanged. |
| Risks cover all writes | Pass | Existing-product UoM update paths, phantom inserts and undo/redo share one root-lock invariant; authoritative snapshots are captured inside the locked transaction rather than in command-bus `prepare`. |
| Batch/cache strategy covers reads | Pass | Calls are bounded to 1,000 requests, accepted batches use at most five reads per tenant/organization scope, and no cross-request cache exists in MVP. |
| Error and i18n ownership is explicit | Pass | Shared owns coded/optimistic HTTP construction; Catalog/Sales own localized messages and adapter coverage. |
| Scope is one capability | Pass | Manufacturing yield/division/persistence remain outside P1.3a. |

### Remaining Gates

- A maintainer/user must accept this v4 revision after reviewing the transaction-captured snapshot, Shared error-helper, bounded-batch and localization corrections.
- Parent roadmap PR #5256 must be accepted/merged before product implementation starts.
- Implementation must still prove the acceptance suite; statuses above mean **specified**, not implemented.

### Verdict

**No known specification-contract blocker remains after v4 remediation.** The document is ready for maintainer review, but it does not authorize implementation until this revision and the parent-roadmap gate are accepted.

## Changelog

- 2026-08-13: Created P1.3a from the audited Catalog/Sales portion of the original quantity/UoM/precision proposal.
- 2026-08-19: Clarified P1.3a as the exact-quantity source for BOM base-output and component-line snapshots, including fixed/variable consumption and yield calculations owned by the Manufacturing definition contract.
- 2026-08-19: Added bounded exact division so Manufacturing can apply `gross = nominal / yieldFactor` with one final policy rounding step while keeping yield semantics outside Catalog/shared.
- 2026-08-19: Aligned governance with the proposed parent roadmap: design is complete but awaits roadmap acceptance and its own readiness review.
- 2026-08-28: Remediated readiness findings: removed Manufacturing yield/division/persistence from scope; froze the DI key, import path, service/batch/error contracts; defined productless Sales and dictionary behavior; made factor strings authoritative; added atomic first-party UoM aggregate save, exact Sales preview, compatibility strategy, phased tests, risks and final compliance evidence.
- 2026-08-28 v2: Preserved Sales `defaultSalesUnit` fallback, added exact quantity companions and pricing comparisons, moved filtering before pagination, bounded scope batching/decimal parsing, preserved `unitPriceReference`, coordinated aggregate and legacy UoM writers on the product root, completed create/update undo/redo semantics, and covered all-page conversion editing.
- 2026-08-28 v3: Replaced widened decimal inputs with additive `*Exact` companions, aligned dictionary rules with the actual entry model, preserved dictionary entry `value` output, made aggregate stale-version rejection unconditional, defined the product-create/no-root and legacy-omission exceptions, covered ordinary product UoM updates, froze productless pricing behavior, completed Sales exact option mapping, and exported the exact-decimal error contract.
- 2026-08-28 v4: Moved authoritative action-log snapshots inside the root-locked mutation transaction, assigned unconditional optimistic-lock and coded HTTP construction to Shared helpers, bounded `normalizeMany` to 1,000 requests before reads, and added Catalog/Sales localization ownership plus acceptance coverage for every public UoM failure.

### Review — 2026-08-13

- **Reviewer:** Agent
- **Security:** Passed.
- **Performance:** Passed; batch resolution and scoped caching are explicit.
- **Cache:** Passed.
- **Commands:** Passed; existing Sales writes remain command-driven.
- **Risks:** Passed.
- **Verdict:** Design complete, pending parent-roadmap acceptance and readiness review; implementation remains gated.

### Review — 2026-08-28

- **Reviewer:** Agent plus fresh-context scope reviewer.
- **Security:** Passed; tenant/organization scope and non-disclosing failures are explicit.
- **Performance:** Passed; batch query bound and client bundle budget are explicit.
- **Cache:** Passed; no cross-request cache in MVP.
- **Commands:** Passed; coupled UoM configuration uses one atomic command with optimistic locking and undo.
- **Risks:** Passed; exact persistence, partial writes, legacy clients, dictionary state and UI staleness are covered.
- **Verdict:** Specification-level remediation complete; fresh-context scope review returned **KEEP**. Implementation remains gated by parent-roadmap acceptance/merge.

### Review v2 — 2026-08-28

- **Reviewer:** Agent, following code-backed readiness audit.
- **Security:** Specified; exact inputs are bounded before `BigInt`, and all reads/writes retain tenant/organization scope.
- **Performance:** Specified; resolver batching is bounded per scope and quantity filtering occurs before pagination.
- **Cache:** Passed at specification level; no cross-request cache in MVP.
- **Commands:** Specified; all UoM writers, including legacy and undo/redo, use the product-root lock/version invariant.
- **Compatibility:** Specified; numeric fields remain, Sales missing-unit and `unitPriceReference` behavior are preserved, and intentional validation fixes are documented.
- **Verdict:** v2 remediation complete and ready for maintainer review. Implementation remains unauthorized pending v2 acceptance and parent-roadmap acceptance/merge.

### Review v3 — 2026-08-28

- **Reviewer:** Agent, following code-backed module-capability audit of v2.
- **Data model:** Passed; dictionary entry rules now match the existing schema and require no migration.
- **Commands/concurrency:** Specified; existing-product UoM writers share the root lock, create has an explicit transaction-only exception, and aggregate version comparison cannot be disabled by `OM_OPTIMISTIC_LOCK`.
- **Compatibility:** Specified; existing numeric TypeScript properties retain their types, exact companions are additive, and legacy product create without `uomConversions` remains supported with an explicit operational limitation.
- **Pricing/Sales:** Specified; productless explicit-unit pricing fails deterministically, while Sales carries exact default quantity/factor strings into raw input and preview.
- **Verdict:** v3 resolves the code-backed v2 blockers and is ready for maintainer review. Implementation remains unauthorized pending v3 acceptance and parent-roadmap acceptance/merge.

### Review v4 — 2026-08-28

- **Reviewer:** Agent, using `om-module-capability-audit` after a code-backed review of command-bus ordering, Shared error rules and Catalog/Sales adapters.
- **Commands/concurrency:** Specified; authoritative UoM snapshots are captured inside the product-root-locked transaction and passed to `buildLog` through the internal command result, so command-bus `prepare` cannot supply stale undo evidence.
- **Shared ownership:** Specified; unconditional optimistic-lock and coded HTTP construction are additive Shared helpers, while Catalog/Sales retain domain-code and translation ownership.
- **Performance:** Specified; `normalizeMany` rejects more than 1,000 requests before reads and retains the maximum-five-read contract per scope for accepted calls.
- **UI/i18n:** Specified; every public UoM code has module-owned localized copy and adapter/locale regression coverage.
- **Verdict:** v4 resolves the code-backed v3 blockers and is ready for maintainer review. Implementation remains unauthorized pending v4 acceptance and parent-roadmap acceptance/merge.
