# Supplier B — inbound RFQ and approved offer

## Status

Implementation in the sibling copy `C:\wroclaw_hackaton\supplier\supplier-b`. This is an additive Stage 2 slice and must not change the existing `supplier_demo` supply-case behavior used by Manufacturer A.

## Outcome

Accept only an allowlisted Manufacturer RFQ that is clearly a free-form RFQ, persist a tenant- and organization-scoped RFQ record, extract facts with a read-only toolless AI agent, verify availability and price deterministically, require an operator approval, and compose an idempotent reply without a protocol envelope. No automatic send is enabled.

## Boundaries and invariants

- Existing `SupplyCase`/`SupplyMessage` ingestion remains authoritative for protocol-envelope replies and existing cases.
- An RFQ is never converted into a fake customer, sales order, or `SupplyCase`.
- Mailbox transport identity, sender allowlist, scope, thread and RFC Message-ID are persisted as evidence; duplicate delivery is harmless under concurrent ingest.
- Tenant and organization scope is derived from the authenticated event context and is present in every query and unique key.
- User-editable RFQ rows carry `updated_at`; approval/rejection uses an expected version and idempotent command paths.
- AI sees sanitized untrusted text only, has no tools, and returns flat schema data with evidence for every extracted quantity/date/SKU. Injection, ambiguity, low confidence, invalid evidence, or missing evidence blocks approval/send.
- Availability reads WMS balances/reservations and supplier production slots without mutating either. Price is read from the scoped catalog source; missing price or currency blocks the offer.
- The response is application-composed from approved facts and includes SKU, quantity, ISO date, unit price and currency. It is threaded to the source message and sent only after explicit approval; the send path is disabled unless a future explicit config enables it.
- No live mailbox, SMTP, OpenRouter, or external API call is part of local validation. Missing credentials are an environment gate, not a reason to invent data.

## Surfaces

- `SupplierRfq` entity and reviewed migration/snapshot.
- Mailbox received-event classifier with strict RFQ subject/body rules and concurrent dedupe.
- Typed RFQ interpretation agent using exactly `openai/gpt-4o-mini`, toolless and read-only.
- Deterministic interpretation validation, WMS/production availability projection, and catalog price projection.
- Approval/rejection and explicit held-send command with optimistic locking and audit/history.
- RFQ list/detail backend pages with original message, evidence, deterministic facts, offer, status/history, loading/error/empty/conflict states, EN/PL translations and ACL.
- Unit/command/API compatibility tests, including tenant isolation, duplicate/concurrent ingest, prompt-injection blocking, no-price blocking, stale approval, no auto-send, and Manufacturer offer-parser compatibility.

## Delivery gates

1. `yarn generate` and focused tests pass.
2. `yarn db:generate` emits only the RFQ migration; after explicit authorization, apply it against the isolated `supplier_b` database.
3. `yarn typecheck`, `yarn lint`, `yarn ds:check`, and relevant tests pass; existing unrelated baseline failures are documented.
4. Live joint mail/provider proof remains pending until the sibling app has a configured mailbox, allowlist, and OpenRouter credentials without exposing secrets; the separate database and port are now in place.

## Implementation verification

- `yarn generate`: passed; RFQ entity, command, route, subscriber, event, AI-agent and backend-page registries were regenerated. OpenAPI used its existing Node 24 static fallback because the bundled JSON import path lacks an import attribute.
- `yarn db:generate`: passed; emitted only `Migration20260920072817_supplier_demo.ts` plus the supplier-demo snapshot update.
- Separate database: `supplier-b-postgres-1` runs on host port `5434`, database `supplier_b`, with volume `supplier-b_postgres_data`. `yarn db:migrate` completed successfully against it; `supplier_demo_rfqs` exists and `Migration20260920072817_supplier_demo` is recorded in migration history. The migration CLI emitted non-fatal query-index declaration-scan warnings for unresolved package paths.
- `yarn test --runInBand`: passed, 20 suites and 95 tests.
- `yarn typecheck`: passed with no errors after resolving the production route/bootstrap/type blockers.
- `yarn lint`: passed with only pre-existing warnings; `yarn ds:check`: passed, 333 files.
- Production build: `yarn build` passed end-to-end (and `yarn exec next build --webpack` also passed). The build still reports known non-fatal warnings for optional `@valkey/valkey-glide`, generated metadata exports, Awilix dynamic dependencies, and the Node 24 OpenAPI JSON-import fallback.
