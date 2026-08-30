# CrudForm Mutation Resource Override

## TLDR

Add an optional `CrudForm.mutationResource` prop that lets a form identify the aggregate protected by mutation guards independently from the edited record and audit-history resource. This is a backward-compatible shared-UI capability required by aggregate editors such as Manufacturing routing drafts, where a family or child form mutates a revision-root aggregate.

The prop changes only mutation-injection and Enterprise record-lock context. It does not change create/update detection, the submitted record ID, optimistic-lock header derivation, custom-field/entity-extension hosts, version-history navigation, or audit `x-om-operation` ownership.

## Overview

This is an independently deployable shared-UI prerequisite for aggregate editors. It belongs to `@open-mercato/ui`, has no Manufacturing dependency, and can ship before any consumer adopts it. Manufacturing routing P1.5 is the first named consumer, not the owner of the contract.

## Problem Statement

`CrudForm` currently derives mutation context from two unrelated concepts: `resourceKind` comes from `versionHistory`, while `resourceId` prefers the form record ID. That works when edited record, lock root, and audit-history root are the same entity, but it cannot correctly represent an aggregate whose mutation guard protects a parent or revision while audit history remains attached to another stable record.

Consumers must not falsify `recordId`, repoint `versionHistory`, bypass `CrudForm`, or accept incorrectly scoped Enterprise record locks merely to describe the real mutation root.

## Proposed Solution

Extend the public `CrudFormProps<TValues>` contract additively:

```ts
type CrudFormMutationResource = {
  resourceKind: string
  resourceId?: string
}

type CrudFormProps<TValues extends Record<string, unknown>> = {
  mutationResource?: CrudFormMutationResource
  // existing props remain unchanged
}
```

When `mutationResource` is absent, `CrudForm` retains its current behavior byte-for-byte. When present, its values have highest precedence only for the mutation-injection context:

```ts
const mutationResourceKind = mutationResource
  ? mutationResource.resourceKind.trim() || undefined
  : versionHistory?.resourceKind

const mutationResourceId = mutationResource
  ? mutationResource.resourceId?.trim() || undefined
  : recordId ?? versionHistory?.resourceId
```

Presence of `mutationResource` is intentional even when `resourceId` is omitted: a create form may identify the protected resource kind before a record ID exists, and must not silently fall back to an unrelated form or version-history ID. Callers supplying an edit-time aggregate root are responsible for supplying its `resourceId`.

Alternatives rejected:

- Reusing `versionHistory` would couple record-lock identity to audit navigation and break consumers that deliberately use different roots.
- Overriding `recordId` would corrupt create/update detection and submitted entity identity.
- Reimplementing forms with `useGuardedMutation` would discard canonical CrudForm behavior and duplicate validation, conflict, extension, and accessibility flows.

## Architecture

Ownership belongs to `packages/ui/src/backend/CrudForm.tsx`; the exported prop/type is an additive stable UI contract. No Manufacturing-specific identifier or dependency enters `@open-mercato/ui`.

`mutationResource` affects the context passed to mutation injection hooks and therefore the Enterprise record-lock widget. The existing context fields keep their meanings:

| Context field | Source after this change |
|---|---|
| `resourceKind` | Trimmed `mutationResource.resourceKind` when the prop is present; blank becomes `undefined` without legacy fallback. Otherwise use the existing `versionHistory.resourceKind` fallback. |
| `resourceId` | Trimmed `mutationResource.resourceId` when the prop is present; omitted/blank becomes `undefined` without legacy fallback. Otherwise use the existing `recordId ?? versionHistory.resourceId` fallback. |
| `recordId` | Existing form-record derivation, unchanged |
| `operation` | Existing create/update detection, unchanged |
| `entityId` / extension spot | Existing CrudForm entity identity, unchanged |
| optimistic-lock expected version | Existing `optimisticLockUpdatedAt` or `initialValues.updatedAt` derivation, unchanged |
| `versionHistory` | Existing audit-history configuration, unchanged |

The prop does not add a provider, API route, database field, command, event, cache entry, or generated registry. It does not itself authorize a write: server-side mutation guards, ACL, tenant scope, optimistic locking, and command validation remain authoritative.

## Data Model

N/A. The capability adds no entity, table, column, migration, persisted client state, or serialized server contract.

## API Contracts

This specification changes only the TypeScript component contract. Required behavior:

- `mutationResource` is optional and additive.
- `resourceKind` must be a non-empty stable resource identifier supplied by the caller; repository-owned consumers use singular dotted IDs such as `manufacturing.routing_revision`. Blank input resolves fail-closed to `undefined` and never reactivates the legacy fallback.
- An omitted `mutationResource` preserves the exact legacy context.
- A present `mutationResource` with no `resourceId` does not fall back to `recordId` or `versionHistory.resourceId`.
- The prop affects both submit and delete mutation-injection paths consistently.
- Mutation injections and the Enterprise record-lock widget observe the same resolved resource.
- The prop does not change `x-om-operation`, version-history links, or the resource recorded by the consumer's command/audit log.

## UI/UX

No visible component, copy, layout, provider, route, or client boundary is added. Existing conflict surfaces and record-lock UI continue to render through the same injection mechanisms; only their resource identity is corrected for opted-in aggregate forms.

## Edge Cases & Failure Scenarios

- Legacy callers omit the prop and retain the existing context.
- A create form passes only `resourceKind`; no record lock is acquired for a nonexistent ID, but kind-aware mutation guards can still observe the intended resource class.
- An edit form passes an aggregate `resourceId` different from its form `recordId`; mutation guards protect the aggregate while the form still updates the child/header entity selected by `recordId`.
- A caller supplies `versionHistory` for a family and `mutationResource` for a revision; audit navigation stays family-rooted and record locking stays revision-rooted.
- A caller supplies an empty `resourceKind` or `resourceId`; CrudForm trims it to `undefined`, does not reactivate the legacy fallback, and therefore never invents or infers a replacement aggregate identity.
- Enterprise is absent or record locking is disabled; the additive context remains harmless and OSS optimistic locking continues unchanged.

## Risks & Impact Review

| Risk | Severity / affected area | Control | Residual risk |
|---|---|---|---|
| Existing forms change behavior | High / shared UI | Prop absence preserves the current resolution path and receives regression coverage. | Future internal refactors must retain the fallback contract. |
| Audit history points at the lock root | High / audit UX | `versionHistory` is explicitly excluded from the override and tested independently. | Consumers must still configure their intended audit root. |
| Edit form omits aggregate `resourceId` | High / Enterprise locking | Contract and tests require edit consumers to pass the aggregate ID; no silent fallback occurs once the prop is present. | Incorrect third-party usage can disable record-specific enrichment but cannot weaken server-side guards. |
| Optimistic-lock header changes accidentally | High / concurrency | Header derivation and request scoping are outside the new resolution and receive regression tests. | Consumer-provided versions must still correspond to their command lock root. |
| Shared UI contract becomes Manufacturing-specific | Medium / architecture | Generic names and tests contain no module dependency or routing identifier beyond consumer fixtures. | Future consumers may need a richer generic contract, which requires a new additive review. |

## Migration and Backward Compatibility

No database or data migration exists. Rollback is code-only: removing the prop implementation before public release restores the legacy resolver and requires routing consumers not to ship first. After public release, the prop is a stable additive contract and cannot be removed without the deprecation protocol in `BACKWARD_COMPATIBILITY.md`; operational rollback therefore keeps the prop and may disable only its consumers. The implementation documents the prop on the exported `CrudFormProps` surface, and its implementation PR references this specification as required for a public contract change.

## Phasing and Implementation Plan

### Phase 1 — shared contract

1. Add and export `CrudFormMutationResource`, add the optional prop to `CrudFormProps`, and resolve mutation context with the exact precedence above.
2. Keep record ID, operation detection, extension hosts, version history, optimistic-lock headers, submit/delete behavior, and `x-om-operation` handling unchanged.

### Phase 2 — verification

1. Add shared-UI tests for legacy fallback, create-with-kind-only, distinct record/mutation/history IDs, submit and delete parity, optimistic-lock header preservation, and fail-closed blank kind/ID normalization without fallback.
2. Add Enterprise integration coverage proving that the record-lock widget receives the overridden revision/aggregate identity while family audit history and form record identity remain unchanged.
3. Run the configured focused UI and Enterprise tests, `yarn build:packages`, `yarn typecheck`, and the full validation gate required by the implementation PR.

### Phase 3 — consumer handoff

1. Publish the shared capability before or in a prerequisite commit/PR that Manufacturing routing can consume.
2. Update aggregate-form specifications to reference this contract instead of redefining it.

## Final Compliance Report

| Requirement | Status | Evidence |
|---|---|---|
| One cohesive capability | Pass | The spec owns only mutation-resource identity for CrudForm and its guard/record-lock consumers. |
| Backward compatibility | Pass | The prop is optional; absence preserves the exact existing resolver. |
| Canonical mechanisms | Pass | Extends CrudForm rather than replacing it or bypassing mutation injections. |
| Security and authorization | Pass | Server guards remain authoritative; the prop only supplies resource identity. |
| Optimistic locking | Pass | Expected-version derivation and scoped headers remain unchanged. |
| Frontend architecture | Pass / N/A | No new route, provider, visible UI, or client boundary is introduced. |
| Testability | Pass | Legacy, aggregate-root, audit-root, submit/delete, OSS, and Enterprise cases are explicit. |
| Rollback | Pass | Pre-release code rollback and post-release compatibility behavior are defined. |

### Non-compliant items

None identified after scope separation. Implementation remains subject to the public-contract approval boundary in the root `AGENTS.md`.

### Verdict

**Ready for implementation after explicit approval of the additive public `CrudForm` contract.**

## Changelog

### 2026-08-30

- Extracted the generic mutation-resource override from the Manufacturing routing specification.
- Defined exact precedence, legacy fallback, create/edit semantics, Enterprise record-lock integration, rollback, and focused verification.
