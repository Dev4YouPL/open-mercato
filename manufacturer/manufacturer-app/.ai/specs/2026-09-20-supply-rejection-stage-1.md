# Manufacturer — SUPPLY_REJECTION for the registered primary proposal

**Date:** 2026-09-20  
**Status:** Stage 1 implementation complete; repository-wide delivery remains gated by the missing Supplier B copy and two pre-existing local environment failures (PostgreSQL authentication and an unrelated Turbopack generated-alias build error).

## Scope and source of truth

This delta extends the existing `supply_cases` JSON-store workflow. It adds one outbound intent, `SUPPLY_REJECTION`, and a guarded operator action for a registered Supplier 1 proposal. Existing `ALTERNATIVE_SUPPLY_REQUEST`, `SUPPLY_ACCEPTANCE`, proposal intake, alternative sourcing, and confirmation behavior remain unchanged.

The action uses the latest persisted Supplier 1 proposal inbound record as its source. It must fail closed when the case has no such record, no business `messageId` in its envelope, no RFC `Message-ID`, no supplier recipient, or no correlation id. No replacement identifiers or local-case correlation are permitted.

## Contract changes

- Add `SUPPLY_REJECTION` to the closed message-intent schema and `OUTBOUND_PHASES`; preserve all existing values and serialization.
- Extend the outbound correlation phase union only; the JSON store file version remains unchanged because this is an additive enum value and existing records remain valid.
- The rejection envelope is `schemaVersion: 1`, exactly one protocol block, with `messageType: SUPPLY_REJECTION`, persisted correlation id, business `messageId` (`MSG-...`), recipient and SKU from trusted persisted/configured values, and `payload.inReplyToMessageId` equal to the latest proposal envelope id.
- Mail transport `Message-ID`, `In-Reply-To`, and `References` remain RFC identifiers and are never populated from the business `MSG-...` value.
- The message is sent in the existing thread with a `Re:` subject. Quoted history is stripped so the response contains exactly one protocol block.

## Command and state

Add `supply_cases.sourcing.reject_primary_proposal` (or the repository's equivalent command seam) with the existing decision permission, scope derivation, optimistic-lock header, transaction/store critical section, and post-commit outbound dispatch. It is valid only for a registered Supplier 1 proposal and only once per case. The logical idempotency key is stable across retries and concurrent executions; a retry reuses the existing business message id and outbound anchor. Duplicate activity and duplicate outbound rows are forbidden. A stale version returns 409 and is surfaced as a conflict in the UI.

The rejection records an outbound correlation and a case activity entry with correlation and delivery state. Queue acceptance is not delivery; no case transition may claim delivery until the existing transport evidence says so. The action does not block the alternative supplier request path.

## Security and compatibility

All reads and writes are tenant and organization scoped. Sender, recipient, SKU, correlation, proposal references, and RFC threading identifiers come from stored records or trusted channel configuration, never from model output or free-form operator text. The existing inbound Supplier A consumer must recognize `SUPPLY_REJECTION`; malformed or missing-source data is recorded as a concrete failure without sending.

## Tests and acceptance

Required unit/integration coverage:

- envelope construction, required fields, exactly one block, and stable retry id;
- business `MSG-...` versus RFC `Message-ID` distinction and reply headers;
- missing source identifiers, idempotency, concurrent/replayed command, optimistic-lock conflict;
- regressions for `ALTERNATIVE_SUPPLY_REQUEST` and `SUPPLY_ACCEPTANCE`;
- alternative RFQ remains available after rejection;
- controlled Manufacturer → Supplier A inbound recognition of `SUPPLY_REJECTION`;
- scoped permission and tenant isolation where the existing test harness supports it.

The local gate is `yarn generate`, focused `yarn test`, `yarn typecheck`, `yarn lint`, `yarn ds:check`, and `yarn build` as feasible without applying migrations or using live mail. Real mailbox delivery is not claimed by local tests.

## Implementation Status

- [x] Contract/schema and envelope builder
- [x] Idempotent guarded command and activity/outbound persistence
- [x] API/UI action and conflict handling
- [x] Supplier A inbound compatibility check
- [x] Required focused, regression, and integration tests available in the local harness
- [x] Generation, typecheck, lint, DS check, and independent review findings addressed

The final repository gate is not fully green: the focused rejection suites pass 20/20; the full Manufacturer suite passes 28/29 suites and 360/362 tests, with the two DB workflow failures caused by local PostgreSQL password authentication. `yarn build` reaches production compilation but fails in the pre-existing `supplier_examples` module because Turbopack cannot resolve `#generated/entities.ids.generated`; no rejection file is named in that error.

**Migration status:** no migration is expected for the current JSON store; no migration has been generated or applied.

**Stage gate:** Stage 1 code and focused verification are complete; the environment-dependent final gate is recorded above rather than hidden. Stage 2 is blocked until the user-provided Supplier B copy, separate database, port, mailbox and safe configuration are present and verified without exposing secrets. Stage 3 was not started because the required order stops after the blocked Stage 2 gate.
