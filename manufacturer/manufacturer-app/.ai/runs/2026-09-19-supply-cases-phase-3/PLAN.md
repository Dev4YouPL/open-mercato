# Phase 3 implementation plan

**Specification status:** READY_FOR_IMPLEMENTATION  
**Runtime owner:** `manufacturer-app/src/modules/supply_cases`  
**Forbidden scope:** `packages/core`, `packages/enterprise`

## Objective

Implement Phase 3, "Offer correlation and final decision", from the amended parent specification.
The result must correlate and persist one real Supplier 2 offer, resume the same durable workflow,
build three deterministic resolution plans, force a second Caseload disposition, and send only the
selected plan's replay-safe communications. It must not mutate production, stock or supplier
commitment state.

## Entry dependencies

These are gates, not work to silently fold into Phase 3:

1. Phase 2 must pass its exit gate. In particular, `src/modules/supply_cases/workflows.ts` must
   contain the durable Phase 2 graph through delivered `ALTERNATIVE_SUPPLY_REQUEST` and a persisted
   wait for the alternative offer. The current file does not yet satisfy this dependency.
2. The existing installed workflow/agent-orchestrator contracts remain available: `INVOKE_AGENT`
   with `onResult: { alwaysAsk: true }`, `agent_orchestrator.proposal.created`,
   `agent_orchestrator.proposal.disposed`, and the canonical Caseload dispose route.
3. The existing communication seam remains authoritative: `sendSupplierMessage`, persisted
   `OutboundCorrelation`, and `communication_channels.message.sent` delivery evidence.
4. The JSON repository is accepted only for the local demo/test target. Production use remains
   blocked on the separately owned ORM entities, migrations and encryption maps; Phase 3 must not
   fake encryption in JSON.

If dependency 1 is not green, the implementer may build and test pure Phase 3 slices but must not
wire or claim the end-to-end exit gate.

## Ordered slices

### P3-01 — Offer contract and atomic record

- Extend the typed SupplyCase offer snapshot and strict zod schemas.
- Add pure quantity/date/amount/currency/current-RFQ validation.
- Add canonical `offerHash`.
- Add scoped `recordAlternativeOfferIfAbsent` with compare-and-set inside the repository write
  lock; same hash replays, competing hash conflicts.
- Cover valid, unresolved, malformed, mismatch, stale, duplicate, cross-scope and race cases.

Primary files: `data/types.ts`, `data/repositories.ts`, `data/json/store.ts`, new focused helpers
under `lib/resolution/`, and colocated tests.

### P3-02 — Inbound bridge and workflow resume

- Extend the accepted-inbound subscriber through commands, not direct repository mutations.
- Preserve the scoped RFC Message-ID claim, sanitization and closed candidate list.
- Add the deterministic audit-only case link for uniquely correlated invalid current-RFQ replies.
- Persist valid offer before emitting an event or signalling the existing workflow.
- Add early-offer read-through and same-instance restart/replay tests.

Primary files: `commands/inbound-triage.ts`, `subscribers/inbound-message-accepted.ts`,
`lib/triage/applyTriageOutcome.ts`, `events.ts`, command registration and tests.

### P3-03 — Recompute and three immutable plans

- Reuse the existing deterministic impact service with the persisted offer.
- Build exactly `ACCEPT_DELAY`, `USE_STOCK`, and `USE_ALTERNATIVE` in code.
- Include full supplier, stock, coverage, cost, production/customer impact, confirmation and
  outbound-effect data.
- Hash and persist the final facts and plans; reject stale/tampered plans.
- Isolate the `300 PLN` stock-cost fixture policy in an app-owned named policy module.

Primary files: existing initial-impact contracts, `data/types.ts`, new `lib/resolution/*`, a focused
final-analysis command, repository methods and unit tests.

### P3-04 — Final advisor and forced Caseload review

- Register `supply_cases.final_resolution_advisor` as a strict propose-only in-process agent with no
  tools or mutations.
- Validate that its three options exactly echo persisted plan IDs, hashes and action payloads.
- Add stable final `INVOKE_AGENT` with `alwaysAsk: true` to the completed Phase 2 workflow.
- Bind one created proposal to the case through an app-owned persistent subscriber.
- On malformed output/error/timeout/guardrail stop, mark `NEEDS_ATTENTION`; do not generate an
  actionable fallback.

Primary files: `ai-agents.ts`, `workflows.ts`, new/focused analysis commands and proposal-created
subscriber, `events.ts`, DI/command discovery files, and tests.

### P3-05 — Human disposition and plan-specific send

- Consume `agent_orchestrator.proposal.disposed` persistently because it carries
  `selectedOptionId`; do not infer the selection from the workflow resume payload.
- Re-authorize `dispositionBy` for `supply_cases.decisions.apply` in addition to enterprise dispose
  authorization.
- Implement `resolution.apply_decision` and `resolution.request_confirmation` with scoped CAS,
  facts/offer/plan hashes and immutable pending-plan persistence before side effects.
- Use `sendSupplierMessage` and deterministic per-effect keys. Resume partial sends by sending only
  missing effects.
- Wait for delivery evidence before entering `WAITING_FOR_SUPPLIER_CONFIRMATIONS`.
- Treat edited/rejected/unauthorized/stale/racing dispositions as non-green and side-effect free.

Primary files: new disposition subscriber, `commands/`, `lib/outbound/`, `events.ts`, repository
methods, command/DI registration and integration tests.

### P3-06 — Read model, UI, ACL and i18n

- Extend the existing detail API/read model and detail page; do not create another approval API.
- Render the actual offer and neutral comparison of all three plans, including infeasibility,
  required confirmations, send/delivery state and bounded errors.
- Deep-link authorized users to `/backend/caseload/[proposalId]`.
- Add retry/conflict/timeout/partial-send states and preserve non-green state until Phase 4.
- Add all labels to the five existing locales and use semantic design-system tokens.

Primary files: existing detail route/read model/page/components, `acl.ts` only if metadata wiring is
needed (do not rename existing features), module locale files, and browser tests.

### P3-07 — Exit-gate verification

- Run focused unit and integration suites after every slice.
- Run self-contained browser coverage with API-created fixtures and cleanup.
- Verify replay, restart, two-organization isolation, optimistic-lock races and byte-for-byte
  non-mutation of production/order/stock/commitment records.
- Run `yarn generate` if discovery surfaces changed, then typecheck, lint, DS check, focused Jest and
  Playwright, followed by the ordered CI gate from `.ai/agentic.config.json`.
- Do not run `yarn db:migrate` without explicit approval.

## Review sequence

1. Implementation agent records every completed slice, changed file and command result in
   `STATE.md`, then writes a concise handoff.
2. First reviewer checks contracts, scope, security, idempotency, locking, tests and the exit gate;
   it fixes in-scope defects and records them.
3. Final independent reviewer repeats the audit against the parent spec and real diff, fixes
   remaining in-scope defects, and leaves a release/QA verdict.

Every agent must preserve unrelated worktree changes and update `STATE.md` plus `HANDOFF.md` before
handoff.

## Completion definition

The complete Phase 3 exit gate in the parent specification passes. In particular,
`USE_ALTERNATIVE` approval yields exactly two delivered logical communications under replay while
the four prohibited business-state classes remain unchanged. Documentation or fixture-only success
does not satisfy the gate.
