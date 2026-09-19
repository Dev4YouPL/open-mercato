# Supplier B — WMS Reservation Shortfall → Supply Proposal Email

**Date**: 2026-09-18
**Status**: Ready for implementation

## TLDR

When a confirmed sales order cannot be fully reserved in the Supplier B warehouse, the installed WMS already emits `wms.inventory.reservation_shortfall`. This spec adds an app-owned reaction in `supplier_demo`: a persistent subscriber turns the shortfall into a local `SupplyCase`, computes a delivery commitment and sends a **real e-mail** to the order's customer through the installed **Communication Channels** hub (IMAP/SMTP or Gmail mailbox). The commitment is the baseline `300 now / 200 later`, or, from Phase 4, a deterministic replan to `400 / 100` under the Supplier auto-approval policy. The e-mail carries a human-readable body plus the frozen `SupplyEnvelope` machine block (`messageType: SUPPLY_PROPOSAL`). The on-stage trigger uses only installed UI: WMS **Adjust** (−700, reason `damaged`) followed by **Confirm** on sales order SO-441. A UMES row action "Report supply disruption" on the sales orders list is the deterministic fallback trigger into the same command. Covers roadmap backlog S01–S02, S07–S08, S12–S13, S19, S21–S25, plus the data side of S18/S26.

## Problem Statement

Supplier B committed 500 × MAT-42 for Wednesday on SO-441 to Manufacturer A. After a capacity disruption only 300 pcs are available. Today:

- The installed WMS subscriber `wms:reservation-shortfall-notification` only creates an in-app notification for `wms.view` users. The customer is never informed.
- No record captures the disruption, the proposed commitment, or the outgoing message. A later inbound reply (S14) would have nothing to correlate against.
- The Manufacturer's Open Mercato needs a machine-readable, validated message (roadmap §8–§9). Free text must never trigger mutations there.

The 5-minute demo (roadmap §17, 0:20–1:25) needs the Supplier side to detect the problem, repair what it can locally, and send a real e-mail autonomously within seconds of the order being confirmed.

## Overview and Success Measures

- **Primary outcome:** From **Confirm** on SO-441 (stock already reduced to 300) to the e-mail landing in the Manufacturer mailbox in ≤ 30 s, 5/5 rehearsal runs, exactly one e-mail per case.
- **Leading indicators:** `SupplyCase` row ≤ 2 s after confirm; `SupplyMessage.deliveryStatus = delivered` (hub `communication_channels.message.sent`) ≤ 20 s; zero duplicate hub messages after event replay; `demo:preflight` green before every run.
- **Baseline:** Today 0 e-mails are sent and 0 cases recorded. The only artefact is an in-app WMS notification.
- **Market / product reference:** SAP IBP / Oracle SCM "order promising → ATP shortfall → supplier collaboration" and EDI 855 (PO Acknowledgment with changes). **Adopted:** a structured, versioned acknowledgment-with-changes payload next to a human body, with split commitments as `[{quantity, date}]`. **Rejected:** a full EDI/AS2 stack and portal collaboration, because the constraint is plain e-mail between two independent systems.

## Goals

- **REQ-001** — A WMS reservation shortfall on a confirmed sales order creates exactly one `SupplyCase` per order, with original, baseline and current commitments.
- **REQ-002** — Exactly one real `SUPPLY_PROPOSAL` e-mail per case goes to the order customer's e-mail through Communication Channels. It carries a valid frozen `SupplyEnvelope` and the subject `[SC-<orderNumber>] Delivery update — <SKU>`. Its real delivery outcome (delivered / failed) is recorded.
- **REQ-003** — The e-mail is sent only when trusted scope is present, the kill switch is on, the mailbox is configured and the recipient is allowlisted. Otherwise the case fails closed with a visible reason and a notification, and nothing is sent.
- **REQ-004** — Enqueue and delivery failures are recorded and can be retried by an operator without a second case or an automatic duplicate e-mail.
- **REQ-005** — (Phase 4) Before sending, a deterministic planner replans production slots (`300/200 → 400/100`, SO-442 +4 h, +120 PLN). The Supplier policy auto-approves when the shift is ≤ 4 h, there is no SLA violation, the cost is ≤ 500 PLN and no high-priority order is affected. Otherwise the case escalates to a human and no e-mail is sent.
- **REQ-006** — (Phase 3) An operator can start the same flow from the sales orders list via "Report supply disruption" by entering the quantity available on the original date. This is advisory: it does not change stock or reservations.
- **REQ-007** — `supplier_demo` setup and `demo:reset` produce a reproducible fixture with dates relative to today. `demo:preflight` verifies every runtime precondition of the stage run.

## Non-goals

- Inbound e-mail parsing, envelope extraction, receipt dedupe, reply correlation, counter-proposals and confirmations (S03–S06, S09, S14–S17, S27–S34). A separate spec builds on the `SupplyCase`/`SupplyMessage` model defined here.
- The Supplier Agent Console (S18/S26 visual timeline). This spec ships only an operational list page.
- An LLM agent. Everything here is deterministic. The agent (S11) will later call the planner as a tool.
- A new adjust reason code. The installed enum (`damaged, shrinkage, found, correction, other`) is used as is.
- Multi-SKU shortfalls in one order. They escalate and no e-mail is sent.
- Changing WMS stock or reservations from the fallback trigger.

## Proposed Solution

Stay on installed seams end to end:

1. **Detection** reuses the installed chain `sales.order.confirmed → wms:sales-order-confirmed-reserve → wms.inventory.reservation_shortfall`.
2. **Case creation** is the app command `supplier_demo.supply_case.open_from_shortfall`, invoked by a persistent subscriber. It is idempotent on `(tenant, organization, salesOrderId)`. It loads the order (scoped query engine) for `expectedDeliveryAt`, status and `customerSnapshot`.
3. **Planning** is pure functions (`lib/planner.ts`, `lib/policy.ts`). Phase 2 computes the baseline split; Phase 4 adds the slot replan and the policy.
4. **Sending** is a separate persistent subscriber on `supplier_demo.supply_case.proposal_ready`, emitted after the case commit. It commits `delivery_status = sending`, then calls the installed DI facade `communicationChannelsSendAsUser` as the designated Supplier mailbox user, then commits `queued_in_hub`. The hub owns MIME, threading, the outbound queue and provider retries.
5. **Delivery tracking** uses subscribers on the installed `communication_channels.message.sent` / `.delivery_failed` events. They match on the hub `messageId` and set `delivered` / `delivery_failed` on the `SupplyMessage`.
6. **Fallback trigger** is a UMES row action on `data-table:sales.orders:row-actions`. It calls a guarded API → `report_disruption` → the same `open_from_shortfall` path.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Subscribe to installed `wms.inventory.reservation_shortfall` | Real WMS signal with required/reserved/shortfall per variant | `wms.inventory.adjusted` | No order/customer context |
| Installed reason code `damaged` + note "Capacity disruption" | Reason codes are a fixed UI enum | Add `capacity_disruption` | Requires a UMES replacement of `AdjustInventoryDialog` |
| Transport = Communication Channels `communicationChannelsSendAsUser` (Q-001) | Real mailbox, threading (`threadId`), hub queue and retries, delivery events, and `message.received` for the inbound spec | Shared `sendEmail` helper | No thread/message record or delivery events |
| Recipient = order `customerSnapshot.customer.primaryEmail` + env allowlist (Q-002) | The order knows its customer; the allowlist bounds the blast radius | Fixed env address | Chosen by user |
| Separate subscribers for open / send / delivery status | Each side effect runs post-commit and is independently retryable | One subscriber | A send failure would roll back or duplicate the case |
| `sending` marker committed before the hub call; no automatic resend from `sending` | Prevents a duplicate e-mail after a crash between the hub call and our commit | Rely on hub dedupe | The hub dedupes per its own message, not per our business message |
| Second-tranche date from seeded `SupplierProductionSlot` (Q-004) | The same capacity model feeds the Phase 4 planner | Fixed +N days | Diverges from the planner model |
| Entities reference the order by ID + snapshot | AGENTS.md: no cross-module ORM relations | Custom fields on `sales:order` | A case has its own lifecycle and message history |
| One case per order; `correlationId = SC-<orderNumber>` (Q-007, frozen) | Matches the shared contract | One case per line | Contract fixes the correlation format |
| One spec, four phases (Q-003, Q-005) | User decision; the phases share one data model and state machine | Split into mailbox chore, core, planner and ops specs (reviewer suggestion) | Phases stay independently shippable; the fallback is ordered before the planner as stage insurance |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Shortfall | `shortfallQuantity = requiredQuantity − reservedQuantity > 0` for one variant of a confirmed order | `wms.inventory.reservation_shortfall` payload | Ignored when ≤ 0 |
| Order context | `expectedDeliveryAt`, `status`, `customerSnapshot` loaded with a scoped query-engine read of `sales:order` | `sales` | Not found → `escalated`/`order_not_found`; no date → `escalated`/`missing_delivery_date` |
| Original commitment | `[{ quantity: requiredQuantity, date: expectedDeliveryAt }]` | order | — |
| Baseline commitment | `[{ reservedQuantity, expectedDeliveryAt }, { shortfallQuantity, firstFreeSlot.date }]`. Zero-quantity tranches are omitted | payload + `SupplierProductionSlot` | No slot with free capacity ≥ shortfall → `escalated`/`no_capacity` |
| Current commitment | The commitment actually proposed: baseline (Phases 2–3) or planner result (Phase 4) | `SupplyCase.currentCommitment` | Any tranche dated before today → `escalated`/`commitment_in_past` |
| Correlation ID | `SC-<orderNumber>`, unique per tenant + organization among non-deleted cases | `SupplyCase.correlationId` | Unique hit → load the existing case (idempotent) |
| Business message ID | `MSG-<uuid v4>`, generated once per `SupplyMessage` | `SupplyMessage.businessMessageId` | Never regenerated on retry |
| Supplier policy (Phase 4) | AUTO_APPROVED iff `maxShiftHours ≤ 4` ∧ no SLA violation ∧ `incrementalCost ≤ 500 PLN` ∧ no `priority = high` allocation moved. Otherwise HUMAN_REQUIRED | `lib/policy.ts` | HUMAN_REQUIRED → `escalated`/`policy_human_required`, no e-mail |
| Partner allowlist | Case-insensitive exact match against `SUPPLIER_DEMO_PARTNER_EMAILS` (comma-separated) | env | Not listed, empty or missing email → `blocked_recipient` |
| Kill switch | Feature toggle `supplier_demo_auto_supply_proposal` (default on) | `feature_toggles` | Off → the shortfall subscriber returns early, no case |

### State machines

`SupplyCase.status`:

```text
detected ─ok─▶ proposal_ready ─hub enqueue ok─▶ proposal_queued ─hub sent─▶ proposal_delivered (terminal here)
   │                ▲    │                            │
   │                │    └─enqueue failed / state unknown─┐
   │                │                                 └─hub delivery_failed (non-transient)─┐
   │                └──────────── operator retry ◀── send_failed ◀────────────────────────┘
   ├─ order_not_found / missing_delivery_date / no_capacity / multi_sku / commitment_in_past / policy_human_required ─▶ escalated
   └─ recipient missing / not allowlisted / mailbox not configured ─▶ blocked_recipient ─operator retry (re-evaluates)─▶ proposal_ready | blocked_recipient
```

`SupplyMessage.deliveryStatus`: `pending → sending → queued_in_hub → delivered | delivery_failed`; `sending → enqueue_failed`. A transient `delivery_failed` event (`transient: true`) only records `last_error`, because the hub keeps retrying.

Any transition to `escalated`, `blocked_recipient` or `send_failed` emits `supplier_demo.supply_case.attention_required`, which creates a notification.

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| System (event subscribers) | Open case, plan, send, track delivery | `tenantId` + `organizationId` from the trusted command-emitted event payload; both required | n/a (`systemActor: true` command ctx, as in `supplier_demo/setup.ts`) |
| Supplier mailbox user | Owner of the connected mailbox channel; outbound mail is sent as this user | Same tenant + org as the case | Whatever `messages` compose requires (resolved in Phase 1 step 1) |
| Supplier operator | View cases; retry `send_failed` / `blocked_recipient` | Selected organization | `supplier_demo.supply_cases.view`, `supplier_demo.supply_cases.manage` |
| Supplier operator | Report disruption on an order | Selected organization; the order must belong to it | `supplier_demo.supply_cases.manage` + installed `sales.orders.view` |

- **Subscribers:** they return early and log when scope is missing. They never infer scope.
- **API routes:** scope comes from auth plus the selected organization, never from the body.
- **Mailbox channel and mailbox user:** both are loaded scoped. A mismatch counts as "mailbox not configured".

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Stock, reservation, shortfall detection | Reuse | `wms` | event `wms.inventory.reservation_shortfall`; command `wms.sales-order.assign-warehouse` (fixture) | Installed, correct |
| Order + customer data | Reuse (read) | `sales`, `customers` | query engine on the order; `customerSnapshot` | Source of truth |
| Mailbox, MIME, threading, queue, provider retries | Reuse | `communication_channels` + `messages` + `integrations` + `channel_imap` (or `channel_gmail`) | DI `communicationChannelsSendAsUser`; events `communication_channels.message.sent` / `.delivery_failed` | Canonical mailbox hub (`.ai/guides/integrations.md` §Mailbox) |
| Supply case, messages, slots, planner, policy | App-own | `supplier_demo` | commands + app events | Supplier-private domain |
| Fallback trigger UI | UMES | `sales` host | `data-table:sales.orders:row-actions` (FROZEN spot) | No installed-code edits |
| Attention notifications | Reuse | `notifications` | type `supplier_demo.supply_case.attention_required` | Visible human boundary |
| Kill switch | Reuse | `feature_toggles` | toggle `supplier_demo_auto_supply_proposal` | Canonical toggles |

## Architecture and Data Flow

```text
[WMS Adjust −700, reason damaged]  wms.inventory.adjust (installed)
[Sales order SO-441 → Confirm]     sales.order.confirmed (installed)
   └─▶ wms:sales-order-confirmed-reserve (installed; needs toggle wms_integration_sales_order_inventory; uses assigned/primary warehouse)
         └─▶ wms.inventory.reservation_shortfall {orderId, orderNumber, shortfalls[], tenantId, organizationId}
               ├─▶ wms:reservation-shortfall-notification (installed, unchanged)
               └─▶ supplier_demo:shortfall-open-case (persistent, NEW)
                     └─▶ cmd supplier_demo.supply_case.open_from_shortfall  (one transaction)
                           ├─ existing case? → if proposal_ready ∧ message pending → re-emit proposal_ready; return
                           ├─ load order (scoped query engine)
                           ├─ insert SupplyCase(detected)
                           ├─ planner.baseline() | planner.replan() + policy.evaluate() (Phase 4)
                           ├─ recipient.resolve() + allowlist + mailbox configured
                           ├─ insert SupplyMessage(outbound, SUPPLY_PROPOSAL, pending)
                           ├─ status → proposal_ready | escalated | blocked_recipient
                           └─ after commit: emit proposal_ready | attention_required

supplier_demo.supply_case.proposal_ready
   └─▶ supplier_demo:send-proposal-email (persistent, NEW) → cmd supplier_demo.supply_message.send
         ├─ guard: toggle on, status proposal_ready, message pending (sending/queued/delivered → no-op)
         ├─ commit deliveryStatus=sending, attempts++
         ├─ communicationChannelsSendAsUser(container, mailboxActor, {userChannelId, to:[recipient], subject, body,
         │                                    channelMetadata:{supplyBusinessMessageId, correlationId}})
         ├─ ok   → commit queued_in_hub (commMessageId, commThreadId, commChannelId); case → proposal_queued
         └─ fail → commit enqueue_failed (lastError); case → send_failed; emit attention_required
       (hub) messages.message.sent → outbound bridge → outbound-delivery worker → SMTP / Gmail

communication_channels.message.sent | .delivery_failed {messageId, …, tenantId, organizationId}
   └─▶ supplier_demo:track-proposal-delivery (persistent, NEW)
         ├─ find SupplyMessage by commMessageId (scoped); none → ignore (not ours)
         ├─ sent → delivered; case → proposal_delivered
         └─ failed ∧ !transient → delivery_failed; case → send_failed; emit attention_required

Fallback (Phase 3):
[Orders list row action "Report supply disruption"] → POST /api/supplier_demo/supply-cases/report-disruption
   └─▶ cmd supplier_demo.supply_case.report_disruption → open_from_shortfall(trigger=manual_disruption)
```

**Stuck in `sending`.** A process crash between the hub call and our commit leaves a message in `sending`, and the subscriber never calls the hub again automatically. The retry command handles it:
- It first looks for a hub outbound link with `channelMetadata.supplyBusinessMessageId` (scoped, read-only lookup, no ORM relation).
- If it finds one, it adopts its IDs and sets `queued_in_hub`.
- If not, it marks `enqueue_failed` with reason `send_state_unknown`, which leaves the case in `send_failed` for the operator to retry.

- **Module boundaries:** everything supply-specific stays in `supplier_demo`. It already owns the MAT-42 fixture and `requires: ['catalog', 'wms']`; it gains `sales`, `customers`, `communication_channels` and `feature_toggles`. A separate module would split the invariant "case + first message" across a transaction.
- **Extension points:** installed events (`wms.inventory.reservation_shortfall`, `communication_channels.message.sent` / `.delivery_failed`), DI `communicationChannelsSendAsUser`, UMES `data-table:sales.orders:row-actions`. No installed file is edited.
- **Alternatives considered:** a durable workflow in the `workflows` module. A single-shot send plus status tracking does not need it; the waiting-for-reply stage in the inbound spec may.
- **Compatibility:** additive only (new app events, entities and routes). `src/modules.ts` gains the hub modules (below).

### Module activation (Q-001 consequence)

`src/modules.ts` adds, in dependency order: `messages`, `integrations`, `communication_channels` (all `@open-mercato/core`) and `channel_imap` from `@open-mercato/channel-imap` (Q-009: the Supplier mailbox is hosted on OVH, so it connects via IMAP + SMTP; `channel_gmail` is not activated). Phase 1 step 1 verifies the exact specifiers and transitive `requires` against installed sources and facts before editing. Activation brings those modules' shipped migrations. They are generated and reviewed, then applied only after approval.

## User Journeys

### Journey J-001 — On-stage disruption (main path)

0. `yarn mercato supplier_demo demo:preflight` is all green.
1. **WMS → Inventory**, MAT-42 in `SUPPLIER-DEMO / STOCK`, **Adjust**: delta −700, reason `damaged`, note "Capacity disruption". Available: 300.
2. **Sales → Orders → SO-441** (Manufacturer A, 500 × MAT-42, expected next Wednesday, assigned to `SUPPLIER-DEMO`) → **Confirm**.
3. WMS reserves 300 and emits a shortfall of 200. Within ~2 s `SupplyCase SC-SO-441` exists with baseline `300 Wed / 200 Fri`.
4. From Phase 4: the planner moves SO-442 +4 h, the commitment becomes `400 Wed / 100 Fri` at +120 PLN, and the policy returns AUTO_APPROVED.
5. The mail is queued in the hub (`proposal_queued`), then sent (`proposal_delivered`). The installed WMS notification also appears.
6. **Failures:**
   - The mailbox rejects the send → `send_failed` + notification; the list offers **Retry**.
   - The recipient is missing or not allowlisted → `blocked_recipient` + notification. Fix the data or env, then **Retry** re-evaluates.

### Journey J-002 — Fallback trigger

1. Stock is 1000. The operator confirms SO-441: full reservation, no shortfall.
2. **Sales → Orders** list → row SO-441 → **Report supply disruption**. A dialog asks for "Quantity available on the original date" (integer, `0 ≤ x < ordered quantity`).
3. Submit → `POST /api/supplier_demo/supply-cases/report-disruption` → same case (`trigger = manual_disruption`) → J-001 steps 3–5. Stock and reservations stay unchanged; the dialog says so.
4. A second submit for the same order returns 409 `case_exists` with a link to the list. Without the feature, the action is hidden and the API returns 403. An order that is not confirmed returns 422.

## UI and Interaction Contracts

Closest references: `node_modules/@open-mercato/core/src/modules/wms/backend/wms/reservations/page.tsx` (read-only operational DataTable) and `node_modules/@open-mercato/core/src/modules/wms/components/backend/AdjustInventoryDialog.tsx` (dialog form). The rules are in `.ai/guides/backend-ui.md`, and implementation invokes `om-backend-ui-design`.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/supplier-demo/supply-cases` | List cases; row action **Retry** on `send_failed` / `blocked_recipient` | `GET /api/supplier_demo/supply-cases`; `POST /api/supplier_demo/supply-cases/{id}/retry` | `wms/backend/wms/reservations/page.tsx` | `Page`, `PageBody`, `DataTable`, shared status badge | loading, empty, error, conflict (409), permission denied | REQ-001, REQ-004 |
| Row action on `data-table:sales.orders:row-actions` | "Report supply disruption" → dialog → submit | `POST /api/supplier_demo/supply-cases/report-disruption` | `AdjustInventoryDialog.tsx` | UMES row action + shared `Dialog` + `CrudForm` (one numeric field) | validation, 403, 404, 409 `case_exists`, 422, success flash | REQ-006 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Supplier operator | … WMS; **Supply Recovery → Supply cases** (new, `supplier_demo`) | none | Orders → row action (2 clicks); Supply cases (1 click) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Supply cases list | "No supply cases yet. Cases appear when a confirmed order cannot be fully reserved." | DataTable stacked columns at narrow width | Row focus; row-action menu via keyboard |
| Report disruption dialog | n/a | Full-width at narrow width | Focus the quantity field on open; Enter submits; Esc cancels; errors via `aria-describedby`; the advisory note is read on open |

### `/backend/supplier-demo/supply-cases` — Supply cases

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Supply cases                                                              │
│ [Status ▾] [Search order / SKU]                                           │
├──────────────────────────────────────────────────────────────────────────┤
│ Case       Order   Customer        SKU    Original  Proposed    Status    │
│ SC-SO-441  SO-441  Manufacturer A  MAT-42 500 Wed   400 Wed /   ✉ Delivered│
│                                                     100 Fri               │
│ …                                                   reason: no_capacity   │
├──────────────────────────────────────────────────────────────────────────┤
│ Pagination                                              row ⋯: Retry      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:**
  - Sorted by `updatedAt` desc, with a status filter.
  - The list refetches on window focus and after every action. Delivery status changes asynchronously, so it must never show a stale version.
  - **Retry** sends the case's `updatedAt`. A 409 shows the shared conflict message and triggers a refetch.
- **Localization:** namespace `supplier_demo.supplyCases.*`, covering status and reason labels and commitment formatting (`{qty} {weekday}`) in the user's locale.
- **Design system:** semantic status tokens:
  - info: `proposal_ready`, `proposal_queued`
  - success: `proposal_delivered`
  - warning: `escalated`, `blocked_recipient`
  - error: `send_failed`

  No hard-coded colors. Verify in light and dark mode.

## Data Models

All entities live in `src/modules/supplier_demo/data/entities.ts`. Each one is scoped by `tenant_id` + `organization_id` and has `created_at`, `updated_at` (optimistic lock) and `deleted_at`. Unique indexes are partial on `deleted_at IS NULL`, so `demo:reset` can soft-delete.

### `SupplyCase` (`supplier_demo_supply_cases`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid | PK | no | immutable |
| `correlation_id` | text | unique (org, tenant, correlation_id) partial | no | `SC-<orderNumber>`, immutable |
| `sales_order_id` | uuid | unique (org, tenant, sales_order_id) partial | no | ID only |
| `order_number` | text | — | no | snapshot |
| `customer_entity_id` | uuid, null | index | no | snapshot ref |
| `customer_display_name` | text, null | — | no | snapshot |
| `customer_snapshot` | jsonb, null | — | **yes** (encryption map) | decrypted copy of the order's `customer_snapshot` at case creation; always read with `findWithDecryption` |
| `recipient_email` | text, null | — | **yes** | from `customerSnapshot.customer.primaryEmail` |
| `catalog_variant_id` | uuid | index | no | — |
| `sku` | text | — | no | snapshot |
| `trigger` | enum `wms_shortfall \| manual_disruption` | — | no | immutable |
| `status` | enum (state machine) | index (org, tenant, status) | no | command-only transitions |
| `status_reason` | text, null | — | no | reason code |
| `original_commitment` / `baseline_commitment` / `current_commitment` | jsonb `[{quantity:int, date:'YYYY-MM-DD'}]` | — | no | original + baseline set once |
| `plan_summary` | jsonb, null | — | no | Phase 4: `{movedAllocations:[{orderNumber, shiftHours}], incrementalCost, currency, slaProtected}`. Local only, never mailed |
| `risk_level` | enum `low \| high`, null | — | no | Phase 4 |
| `policy_decision` | enum `auto_approved \| human_required`, null | — | no | Phase 4 |
| `additional_cost` | numeric(12,2), null | — | no | — |
| `currency_code` | text, default `PLN` | — | no | — |
| `negotiation_turn` | int, default 0 | — | no | reserved for the inbound spec |

### `SupplyMessage` (`supplier_demo_supply_messages`)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid | PK | no | — |
| `supply_case_id` | uuid | index | no | same-module FK |
| `business_message_id` | text | unique (org, tenant, …) partial | no | `MSG-<uuid>` |
| `direction` | enum `outbound \| inbound` | — | no | only `outbound` here |
| `message_type` | enum of the 5 contract types | — | no | `SUPPLY_PROPOSAL` here |
| `sender_email` / `recipient_email` | text | — | **yes** | — |
| `subject` | text | — | no | — |
| `envelope_payload` | jsonb | — | no | envelope **without** `sender`/`recipient`; those are injected from the encrypted columns at render time |
| `delivery_status` | enum `pending \| sending \| queued_in_hub \| delivered \| delivery_failed \| enqueue_failed` | index | no | see state machine |
| `comm_message_id` | uuid, null | index (org, tenant, comm_message_id) | no | hub `Message.id`, used for delivery tracking and inbound threading |
| `comm_thread_id` / `comm_channel_id` | uuid, null | — | no | from `SendAsUserResult` |
| `last_error` | text(500), null | — | no | provider message, truncated, no secrets |
| `attempts` | int, default 0 | — | no | — |

### `SupplierProductionSlot` (`supplier_demo_production_slots`)

| Field | Type | Notes |
|---|---|---|
| `id`, scope, timestamps | — | — |
| `catalog_variant_id` | uuid | MAT-42 |
| `starts_at` | timestamptz | computed relative to today by setup/reset |
| `capacity_quantity` | int | pcs per slot |
| `allocations` | jsonb `[{orderNumber, quantity, priority:'normal'\|'high', slaDueAt, shiftableHours, shiftCostPerHour}]` | SO-442: normal priority, shiftable 4 h, 30 PLN/h |

**Migrations:**
- Phase 1: hub modules' shipped migrations only.
- Phase 2: one `yarn db:generate` for all three entities. Review the SQL and snapshot for scope and partial indexes, then ask before applying.

**Encryption map:** `recipient_email` on both entities, and `sender_email`.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| command | `supplier_demo.supply_case.open_from_shortfall` | system actor or `…manage` | `{ salesOrderId, orderNumber (required), shortfalls[] , trigger }` + trusted scope | `{ caseId, status, created }`; after commit `supplier_demo.supply_case.opened`, then `…proposal_ready` or `…attention_required` | existing case → `created:false`, re-emits `proposal_ready` only if still ready and the message is `pending` | REQ-001, 003, 005 |
| command | `supplier_demo.supply_message.send` | system actor or `…manage` | `{ supplyMessageId }` | `{ deliveryStatus }`; emits `…attention_required` on failure | no-op unless the case is `proposal_ready` and the message is `pending`; re-checks toggle, allowlist and mailbox | REQ-002, 003, 004 |
| command | `supplier_demo.supply_message.track_delivery` | system actor | hub event payload | `{ matched }` | unknown `messageId` → ignore | REQ-002, 004 |
| command | `supplier_demo.supply_case.retry` | `…manage` | `{ caseId, updatedAt }` | `send_failed` → recovers `sending` (link lookup) or resets the message to `pending` → `proposal_ready` → emit; `blocked_recipient` → re-resolves the recipient → `proposal_ready` or stays blocked | 409 version mismatch; 422 wrong status | REQ-004 |
| command | `supplier_demo.supply_case.report_disruption` | `…manage` | `{ salesOrderId, availableQuantity }` | delegates to `open_from_shortfall` (`manual_disruption`); advisory, no WMS mutation | 404 not in scope; 409 `case_exists`; 422 not confirmed / quantity out of range / multi-SKU | REQ-006 |
| `GET` | `/api/supplier_demo/supply-cases` | auth + `…view` | `page, pageSize, status?, search?` | `{ items, totalCount }` via `makeCrudRoute` (list only) | 401/403 | REQ-001 |
| `POST` | `/api/supplier_demo/supply-cases/{id}/retry` | auth + `…manage` | `{ updatedAt }` | 202 `{ status }` | 400/403/404/409/422 | REQ-004 |
| `POST` | `/api/supplier_demo/supply-cases/report-disruption` | auth + `…manage` | `{ salesOrderId: uuid, availableQuantity: int ≥ 0 }` | 201 `{ caseId, status }` | 400/403/404/409/422 | REQ-006 |

Every custom route declares per-method `metadata` (`requireAuth`, `requireFeatures`) and `openApi`, and runs the installed mutation guards before executing its command. Scope always comes from auth. The version for 409 checks is always `SupplyCase.updatedAt`.

### Frozen `SupplyEnvelope` (Q-007)

```text
---OPEN-MERCATO-SUPPLY-MESSAGE---
{
  "schemaVersion": 1,
  "messageId": "MSG-<uuid>",
  "correlationId": "SC-<orderNumber>",
  "messageType": "SUPPLY_PROPOSAL",
  "sender": "<supplier mailbox address>",
  "recipient": "<recipient_email>",
  "payload": {
    "sku": "MAT-42",
    "commitments": [{"quantity": 400, "date": "YYYY-MM-DD"}, {"quantity": 100, "date": "YYYY-MM-DD"}]
  }
}
---END-OPEN-MERCATO-SUPPLY-MESSAGE---
```

- **Shape:** exactly the roadmap §8/§20 shape. The optional `payload.orderReference` and `payload.originalCommitment` are added only if Q-008 is accepted; they are not required for any phase gate.
- **Dates:** ISO calendar dates in the tenant timezone.
- **Placement:** the block goes verbatim into `body.plain` and inside a `<pre>` in `body.html`.
- **Subject:** `[SC-<orderNumber>] Delivery update — <SKU>`.
- **Human body:** follows roadmap §8 and contains only quantities, dates, SKU and the order number. No production-plan or cost data.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `wms.inventory.reservation_shortfall` | wms (installed) | `supplier_demo:shortfall-open-case` | `open_from_shortfall` | Persistent retry; unique `sales_order_id`; re-emit when stuck in `proposal_ready` |
| `supplier_demo.supply_case.opened` | supplier_demo | — | timeline data | command log |
| `supplier_demo.supply_case.proposal_ready` | supplier_demo (post-commit) | `supplier_demo:send-proposal-email` | `supply_message.send` | `sending` marker; no automatic resend |
| `communication_channels.message.sent` / `.delivery_failed` | communication_channels (installed) | `supplier_demo:track-proposal-delivery` | delivery status | match by `comm_message_id`; replays are idempotent state writes |
| `supplier_demo.supply_case.attention_required` `{caseId, status, reason}` | supplier_demo | `supplier_demo:attention-notification` | notification to `supplier_demo.supply_cases.manage` holders, linking to the list | one per transition |
| `messages.message.sent` | messages (installed) | hub outbound bridge (installed) | provider delivery | hub-owned retries, dead-letter, reauth |

The new event IDs go in `src/modules/supplier_demo/events.ts`, followed by `yarn generate`.

## Security, Privacy, and Compliance

- **Authorization:** `supplier_demo.supply_cases.view` / `.manage` in `acl.ts`, granted to admin roles via `setup.ts` `defaultRoleFeatures`. No role-name checks.
- **Tenant isolation:**
  - Every read and write is filtered by tenant + organization taken from the event payload or auth.
  - The mailbox channel, the mailbox user, the order query and the hub-link lookup are all scoped.
  - A delivery event whose `messageId` is not found in scope is ignored.
- **Mailbox actor:** `lib/mailbox.ts` builds a `SendAsUserActor` for the configured mailbox user, with a scoped auth context carrying only that user's own features. It fails closed if the user or channel is missing, in another scope, or not `connected`. The same function is used by the smoke CLI and the subscriber.
- **Sensitive data:**
  - E-mail addresses are encrypted and read with `findWithDecryption`.
  - `envelope_payload` contains no addresses.
  - The mail carries no Supplier-private data (roadmap §5), and `plan_summary` stays local.
- **Abuse and failure modes:**
  - The allowlist bounds recipients.
  - Subject and body are built only from typed fields.
  - Credentials never leave the hub.
  - `last_error` is truncated and must not contain tokens.
  - Replays are absorbed by the unique indexes and the `sending` marker.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | pure | `planner.baseline(500, 300, slots)`; no-slot case; past-date case | `[{300,Wed},{200,Fri}]`; zero tranche omitted; `no_capacity`; `commitment_in_past` | REQ-001 |
| TEST-002 | unit | pure | `envelope.build()` + `render()` + parse back | identical JSON between markers; exact frozen keys; subject format | REQ-002 |
| TEST-003 | integration | fixture, stock 300, hub test-seed adapter (`OM_ENABLE_TEST_CHANNEL_SEEDING`) | confirm SO-441 via API; drain queues | 1 case `proposal_delivered`; 1 `SupplyMessage` `delivered` with `comm_message_id`; hub `Message` body contains the envelope | REQ-001, 002 |
| TEST-004 | integration | as TEST-003 | re-emit the same shortfall event 2×; re-emit `proposal_ready` 2× | still 1 case, 1 message, 1 hub message | REQ-001, 004 |
| TEST-005 | security | non-allowlisted customer e-mail; second tenant with the same order number | confirm the order; `GET` as tenant B | `blocked_recipient`, 1 notification, 0 hub messages; tenant B sees nothing | REQ-003 |
| TEST-006 | integration | mailbox channel disconnected | confirm; retry with stale `updatedAt`; reconnect; retry with a fresh one | `send_failed` (`enqueue_failed`); 409; then `delivered`, `attempts = 2` | REQ-004 |
| TEST-007 | integration | test adapter emits non-transient `delivery_failed` | confirm; drain | `send_failed`, `last_error` set, notification | REQ-004 |
| TEST-008 | integration | message forced into `sending` with a hub link present / absent | retry | adopts the link → `queued_in_hub` / `enqueue_failed` + `send_state_unknown`; never 2 hub messages | REQ-004 |
| TEST-009 | UI | stock 1000, confirmed SO-441; users with and without `manage` | row action → dialog → submit ×2, keyboard only | case + mail; 409 message; action hidden without the feature; stock unchanged | REQ-006 |
| TEST-010 | UI | cases in every status | list in light/dark and narrow width | states render; Retry only on `send_failed` / `blocked_recipient` | REQ-001, 004 |
| TEST-011 | integration | toggle `supplier_demo_auto_supply_proposal` off | confirm with a shortfall | no case, no mail; installed WMS notification still created | REQ-003 |
| TEST-012 | unit + integration | slots: SO-442 shiftable 4 h @ 30 PLN/h; variant: `priority: high` | `replan` + `policy`; confirm | `400/100`, cost 120, `auto_approved`; high → `escalated`, no mail, notification | REQ-005 |
| TEST-013 | integration | fresh tenant | setup ×2; `demo:reset`; `demo:preflight` | exactly one Manufacturer A, SO-441 (draft, assigned to `SUPPLIER-DEMO`), SO-442, slots, stock 1000; dates ≥ today; preflight passes and fails on each broken precondition | REQ-007 |

## Implementation Phases

### Phase 1 — Mailbox hub activation and outbound smoke send

- **Depends on:** none
- **Outcome:** The Supplier OM sends a real e-mail through Communication Channels, using the exact code path the subscriber will use. This is the roadmap gate for Fri 19:30.
- **Why this order / value delivered:** It resolves the riskiest external dependency (OAuth/SMTP) first, as the roadmap risk table requires.
- **Deliverables:**
  1. Verify the specifiers, `requires` and the auth features the `messages` compose command needs. Then edit `src/modules.ts` and review the generated migrations. **Apply only after approval.**
  2. The operator connects the Supplier mailbox in the hub UI.
  3. `supplier_demo/lib/mailbox.ts` with `resolveMailboxActor()` + `sendSupplyMail()` (env `SUPPLIER_DEMO_MAILBOX_CHANNEL_ID`, `SUPPLIER_DEMO_MAILBOX_USER_ID`).
  4. CLI `yarn mercato supplier_demo mail:smoke --to <addr>`.
- **Independent slices:** (a) module activation + migrations; (b) mailbox resolver + CLI.
- **Mailbox configuration (OVH, `channel_imap`):**
  - **Mailbox:** the Supplier mailbox is hosted on OVH (Zimbra UI `https://zimbra1.mail.ovh.net/modern/`, webmail `https://webmail.mail.ovh.net/`). Those are web UIs; the hub connects through IMAP and SMTP.
  - **How to connect:** the mailbox owner (`SUPPLIER_DEMO_MAILBOX_USER_ID`) connects in the hub UI via `POST /api/communication_channels/channels/connect/credentials`. The fields are validated by `channel_imap/lib/credentials.ts` `imapCredentialsSchema`:

    | Field | Value |
    |---|---|
    | `imapHost` / `imapPort` / `imapTls` | OVH IMAP server of this mailbox offer; port 993 with `tls` |
    | `imapUser` / `imapPassword` | full mailbox address + mailbox password |
    | `smtpHost` / `smtpPort` / `smtpTls` | OVH SMTP server; 465 with `tls`, or 587 with `starttls` |
    | `smtpUser` / `smtpPassword` | same as IMAP |
    | `fromAddress` | the mailbox address itself; OVH SMTP rejects a From that differs from the authenticated login |

  - **Hostnames:** take the exact IMAP/SMTP hostnames from OVH Control Panel → Emails → the mailbox → configuration. They differ between the OVH MX Plan/Email Pro/Zimbra offers, so the spec does not hard-code them. `mail:smoke` proves them.
  - **Credentials:** they are stored only in the hub's encrypted `IntegrationCredentials`. They never go into env, the spec, logs or commits.
  - **Manufacturer mailbox:** the Manufacturer's address (the SO-441 customer `primaryEmail`) goes into `SUPPLIER_DEMO_PARTNER_EMAILS`; `SUPPLIER_DEMO_PARTNER_EMAILS[0]` is also the seeded Manufacturer A e-mail.
- **Requirements closed:** — (enabler for REQ-002, REQ-003)
- **Tests:** a unit test for `resolveMailboxActor` (missing env, wrong-scope channel, disconnected channel → typed errors).
- **Validation:** `yarn generate && yarn typecheck && yarn test`
- **Exit gate:** The smoke CLI mail arrives in the Manufacturer inbox, and the hub emits `communication_channels.message.sent` for it.

### Phase 2 — Shortfall → SupplyCase → baseline proposal e-mail (Level 3)

- **Depends on:** Phase 1 exit gate
- **Outcome:** Adjust + Confirm on SO-441 sends the `300 Wed / 200 Fri` proposal automatically, and its delivery is tracked.
- **Why this order / value delivered:** This is the mandatory Level 3 path (roadmap §10).
- **Deliverables:**
  - **Data:** the three entities + migration (**ask before applying**) and the encryption map.
  - **Module config:** `acl.ts`, `setup.ts` role features, `events.ts`, the kill-switch toggle, and `index.ts` `requires`.
  - **Libs:** `lib/planner.ts` (baseline), `lib/envelope.ts`, `lib/compose.ts`, `lib/recipient.ts`.
  - **Commands:** `open_from_shortfall`, `supply_message.send`, `track_delivery`, `retry` (command only, no UI).
  - **Subscribers:** `shortfall-open-case`, `send-proposal-email`, `track-proposal-delivery`, `attention-notification`, plus the notification type.
  - **Fixture:** Manufacturer A with e-mail; SO-441 as a draft, 500, next Wednesday; SO-442; slots; stock 1000; both orders assigned to `SUPPLIER-DEMO` via `wms.sales-order.assign-warehouse`; dates relative to today.
  - **CLIs:**
    - `demo:reset` soft-deletes the demo cases and messages, cancels the current demo order (the installed WMS subscriber releases its reservations), creates a fresh draft order (`SO-441` if free, else `SO-441-<n>`; a clean `yarn initialize` gives a pristine `SO-441` for the final run) and resets stock to 1000.
    - `demo:preflight` checks: the WMS reservation toggle and our toggle are on; the mailbox is connected; the customer e-mail is allowlisted; MAT-42 stock and warehouse assignment are as expected; the demo order is a draft with no case. It also reports the queue strategy and reminds you to run workers when it is async.
- **Independent slices:** (a) entities + migration + fixture/CLIs; (b) pure libs + unit tests; (c) commands + subscribers (after a and b).
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-007; the REQ-004 state side.
- **Tests:** TEST-001 to TEST-008, TEST-011, TEST-013
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test && yarn test:integration:ephemeral`
- **Exit gate:** 3/3 manual J-001 runs (without step 4), starting from `demo:reset` + `demo:preflight`, each deliver exactly one mail with a valid frozen envelope. The case reaches `proposal_delivered`.

### Phase 3 — Supply cases list, retry UI and fallback trigger (stage insurance)

- **Depends on:** Phase 2 exit gate
- **Outcome:** Operators see cases, retry failures, and can trigger the flow manually from the orders list.
- **Why this order / value delivered:** It comes before the planner so the demo has a fallback even if Phase 4 slips.
- **Deliverables:**
  - `GET /api/supplier_demo/supply-cases` (`makeCrudRoute`).
  - The `retry` and `report-disruption` routes, each with `metadata`, `openApi` and mutation guards.
  - The `report_disruption` command.
  - The page `/backend/supplier-demo/supply-cases` (DataTable) and its nav item.
  - The UMES row action + dialog on `data-table:sales.orders:row-actions`.
  - i18n `supplier_demo.supplyCases.*`.
- **Independent slices:** (a) list API + page + retry; (b) UMES row action + report API.
- **Requirements closed:** REQ-004 (UI), REQ-006
- **Tests:** TEST-009, TEST-010 (+ TEST-006 through the UI)
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn test:integration:ephemeral`
- **Exit gate:** J-002 works keyboard-only; the list renders in light/dark and at narrow width; Retry recovers a forced disconnected-mailbox failure.

### Phase 4 — Deterministic replan + Supplier policy (Level 4)

- **Depends on:** Phase 2 exit gate (Phase 3 recommended first)
- **Outcome:** The proposal becomes `400 Wed / 100 Fri` with AUTO APPROVED. High-risk plans escalate instead of sending.
- **Why this order / value delivered:** It delivers the demo line "Dostawca najpierw próbuje rozwiązać problem we własnej firmie."
- **Deliverables:**
  - `lib/planner.ts` `replan()`: greedy — shift shiftable normal-priority allocations in the target slot by ≤ 4 h, recompute cost and SLA.
  - `lib/policy.ts`.
  - `open_from_shortfall` persists the plan, policy decision, cost and moved allocations (command-owned; undo restores the previous allocations snapshot kept in the command log).
  - `human_required` → `escalated` + attention notification.
- **Independent slices:** (a) pure planner + policy with unit tests; (b) command wiring.
- **Requirements closed:** REQ-005
- **Tests:** TEST-012 (+ TEST-003 re-run expecting 400/100)
- **Validation:** `yarn typecheck && yarn test && yarn test:integration:ephemeral`
- **Exit gate:** 3/3 runs send `400/100`. Switching SO-442 to `priority: high` escalates with no mail.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, list | `SupplyCase`, `open_from_shortfall`, `wms.inventory.reservation_shortfall` | 2 | TEST-001, 003, 004 | AC-001 |
| REQ-002 | J-001 | `SupplyMessage`, `supply_message.send`, `track_delivery`, envelope, `communicationChannelsSendAsUser`, hub events | 1–2 | TEST-002, 003 | AC-002 |
| REQ-003 | J-001 step 6 | `lib/recipient.ts`, `lib/mailbox.ts`, kill switch, `attention_required` | 2 | TEST-005, 011 | AC-003 |
| REQ-004 | J-001 step 6, list | `retry`, delivery states | 2 (state), 3 (UI) | TEST-004, 006, 007, 008, 010 | AC-004 |
| REQ-005 | J-001 step 4 | `planner.replan`, `policy`, `SupplierProductionSlot` | 4 | TEST-012 | AC-005 |
| REQ-006 | J-002, orders row action | `report-disruption`, `report_disruption` | 3 | TEST-009 | AC-006 |
| REQ-007 | J-001 step 0–1 | setup fixture, `demo:reset`, `demo:preflight` | 2 | TEST-013 | AC-007 |

**Extension surfaces:** each of these has its own test:

| Surface | Test |
|---|---|
| Subscriber on `wms.inventory.reservation_shortfall` | TEST-003 |
| Subscribers on the hub `message.sent` / `delivery_failed` events | TEST-003, TEST-007 |
| DI consumer of `communicationChannelsSendAsUser` | Phase 1 test, TEST-003 |
| App events in `events.ts` | TEST-004 |
| Row action on `data-table:sales.orders:row-actions` | TEST-009 |
| Kill-switch toggle | TEST-011 |

The first step of each phase resolves, per surface, the exact `src/modules/example/**` file to adapt from `om-module-scaffold`'s `references/surface-inventory.json`, as `spec-delivery.md` requires.

## Rollout, Migration, and Rollback

- **Order:**
  1. Phase 1 activation.
  2. Hub migrations (approval).
  3. Mailbox connect.
  4. Phase 2 migration (approval).
  5. Setup/fixture.
  6. `demo:preflight`.
- **Env:** `SUPPLIER_DEMO_MAILBOX_CHANNEL_ID`, `SUPPLIER_DEMO_MAILBOX_USER_ID`, `SUPPLIER_DEMO_PARTNER_EMAILS`, and optional `SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS` fallback. Sender selection prefers the connected mailbox channel `externalIdentifier`; when unavailable, `SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS` is used. If any required mailbox/allowlist setting is missing, cases are still created but the case goes to `blocked_recipient` (`mailbox_not_configured` / `recipient_not_allowlisted`) and nothing is sent.
- **Kill switch:** `supplier_demo_auto_supply_proposal`. When it is off, all app behavior stops; the installed WMS notification is untouched.
- **Rollback:**
  - Turn the toggle off, then remove the subscribers.
  - Deactivating the hub modules only makes sense once their tables are no longer needed.
  - Shipped migrations are never edited.
- **Observability:** `supplier_demo` structured logs carry `correlationId` and `businessMessageId` on every step. Case status and reason are visible in the list.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| OVH IMAP/SMTP setup fails (wrong host per offer, port blocked on venue network, From ≠ login rejected) | No real e-mail | Phase 1 first; hostnames from OVH panel; `mail:smoke`; try 587/`starttls` if 465 is blocked; `fromAddress` = login | Venue network blocks SMTP → phone hotspot; provider outage → backup video |
| OVH anti-spam delays or filters the machine-looking mail | Late or missing mail at Manufacturer | Plain-text-first body; human sentence first; rehearse the Supplier → Manufacturer mailbox pair; Manufacturer allowlists the sender | Low |
| IMAP polling latency (for the later inbound spec) | Slow replies | Out of scope here; the hub poll interval is noted for the inbound spec | — |
| The mailbox user's auth context lacks the compose features | Enqueue fails | Resolved in Phase 1 step 1; smoke CLI uses the same path | Low |
| Activating 3–4 installed modules drags in setup, ACL and migrations | Delay | Verify facts first; review SQL; ask before applying | Moderate |
| Confirm → mail spans 5+ queue hops; async strategy without workers → nothing happens | Silent failure on stage | `demo:preflight` reports the queue strategy and toggles; rehearse 5/5 | Low |
| Order confirmed before the stock drop, or stock in the wrong warehouse | No shortfall | Fixed demo script; fixture assigns the warehouse; preflight checks stock; fallback button (Phase 3) | Low |
| Crash between the hub call and our commit | Duplicate or missing mail | `sending` marker, no automatic resend, link lookup on retry | Very low |
| Fixture dates go stale | Past-dated commitment | Relative dates in setup/reset; the planner rejects past dates | Very low |
| Manual disruption diverges from WMS state | Mail promises 300 while WMS holds 500 | Documented advisory behavior; dialog note | Accepted |
| Q-008 fields rejected | none | Not sent unless accepted | none |

## Acceptance Criteria

- [ ] **AC-001** — MAT-42 is at 300 and SO-441 (500) is confirmed in org A. Within 2 s exactly one `SupplyCase SC-SO-441` exists, with original `500@Wed` and baseline `300@Wed, 200@Fri`.
- [ ] **AC-002** — Exactly one e-mail arrives at Manufacturer A's allowlisted address within 30 s, with subject `[SC-SO-441] Delivery update — MAT-42` and an envelope that parses to exactly the frozen schema. The case reaches `proposal_delivered`.
- [ ] **AC-003** — If the recipient is not allowlisted or missing, or the mailbox is unconfigured, the case is `blocked_recipient`, one notification exists and the hub has zero outbound messages. With the kill switch off, no case is created. A second tenant never sees the case.
- [ ] **AC-004** — A disconnected mailbox or a non-transient provider failure yields `send_failed` with a notification. A retry with a stale version returns 409. A retry with the current version produces exactly one delivered e-mail. A message stuck in `sending` is never auto-resent.
- [ ] **AC-005** — With the Phase 4 fixture, the mail proposes `400@Wed, 100@Fri`; the case stores `auto_approved`, 120 PLN and SO-442 +4 h. With SO-442 at high priority, the case is `escalated` and no mail is sent.
- [ ] **AC-006** — An operator with `manage` can report a disruption for a confirmed SO-441 from the orders list using only the keyboard. The same mail flow runs and WMS stock is unchanged. Without the feature, the action is hidden and the API returns 403.
- [ ] **AC-007** — Setup ×2 plus `demo:reset` leave exactly one Manufacturer A, one draft demo order assigned to `SUPPLIER-DEMO`, SO-442, the slot set, stock 1000 and dates ≥ today. `demo:preflight` passes and flags each broken precondition.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `supplier-app/AGENTS.md`, `.ai/guides/spec-delivery.md`, `.ai/guides/integrations.md` §Mailbox, wms/sales facts, hub source (`send-as-user.ts`, `deliver-outbound-message.ts`) |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Single state machine; traceability table; independent review findings applied (see Changelog) |
| Every workflow completes end to end without a catch-all integration phase | pass | Four phases, each with an observable exit gate |
| Platform-native reuse and extension points were chosen before custom code | pass | Installed WMS event, hub DI facade and events, UMES row action, feature toggle |
| UI contracts identify references, canonical components, and theme/state coverage | pass | Two surfaces with references and states |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | See phases |

Verdict: `Ready for implementation`.

## Implementation Status

Source doc: .ai/specs/2026-09-18-supplier-shortfall-supply-proposal.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — Mailbox hub activation and outbound smoke send | verified | none | enabler for AC-002, AC-003 | `yarn generate && yarn typecheck && yarn test` | Smoke CLI mail arrives in the Manufacturer inbox and the hub emits `communication_channels.message.sent` |
| Phase 2 — Shortfall → SupplyCase → baseline proposal e-mail (Level 3) | verified | Phase 1 | AC-001, AC-002, AC-003, AC-004, AC-007 | `yarn generate && yarn typecheck && yarn lint && yarn test && yarn test:integration:ephemeral` | Exit gate passed before Phase 3 handoff; current full validation still reports the existing `agent_examples` typecheck/build blocker |
| Phase 3 — Supply cases list, retry UI and fallback trigger | verified | Phase 2 | AC-004, AC-006 | Manual J-002/list verification completed by the user; automated integration environment remains unavailable | J-002 keyboard-only, list light/dark/narrow, and disconnected-mailbox Retry recovery manually verified |
| Phase 4 — Deterministic replan + Supplier policy | verified | Phase 3 | AC-005 | `yarn generate && yarn lint && yarn test && npx tsc --noEmit` (supplier_demo clean; known agent_examples errors remain); integration harness blocked | User confirmed the manual 3/3 mail/escalation exit gate on 2026-09-19 |

### Phase 1 progress

- [x] module activation + shipped migrations: `src/modules.ts` activates `messages`, `integrations`, `communication_channels`, and `channel_imap` in dependency order; `yarn generate && yarn db:generate` emitted no app-owned SQL or snapshot diff; the approved local migration applied only the 5 `communication_channels`, 3 `integrations`, and 5 `messages` migrations
- [x] mailbox resolver + smoke CLI: `src/modules/supplier_demo/lib/mailbox.ts`, `src/modules/supplier_demo/cli.ts`, and focused resolver tests; scoped user/channel resolution, connected IMAP guard, DI send facade, and `mail:smoke --to <addr>` are implemented; focused and full Jest tests pass
- [x] manual Phase 1 exit gate: user confirmed `mail:smoke` delivered and the hub emitted `communication_channels.message.sent`; `yarn typecheck` remains blocked by pre-existing duplicate helper errors under `src/modules/agent_examples/**`

### Phase 2 progress

- [x] data and fixture foundation — `data/entities.ts`, `encryption.ts`, `setup.ts`, `cli.ts`; toggle creation is reusable from `seedDefaults`, `seedExamples`, and `demo:reset`; encrypted Manufacturer A lookup is scoped, duplicate-safe, and updates the allowlisted primary e-mail; seeded orders resolve dictionary `draft`, repair legacy null status, reuse active suffixed orders, and choose a free `SO-441-<n>` after cancellation
- [x] pure contracts — `lib/planner.ts`, `lib/envelope.ts`, `lib/compose.ts`, `lib/recipient.ts`; focused planner/envelope/recipient tests pass
- [x] runtime flow — `commands/supply.ts`, persistent shortfall/send/delivery/attention subscribers, `notifications.ts`, `acl.ts`, `events.ts`, and the kill-switch toggle; encrypted orders use scoped decrypting reads; entity IDs are assigned before message linkage; missing order/date context persists escalated cases and attention events; connected mailbox sender addresses take precedence over the fallback env var; post-commit supplier events are enqueue-only; Jest passes with 13 tests
- [x] fixture/reset regression coverage — `setup.ts` and `cli.ts` make toggle/customer/order reset idempotent, cancel every active `SO-441*`, release lingering reservations, restore MAT-42 to on-hand 1000/reserved 0, and report per-item preflight remediation; `TEST-013` covers reset ×2 and preflight/remediation output
- [x] encrypted persistence regression coverage — `src/modules/supplier_demo/__integration__/TEST-003.spec.ts` resets the real fixture, executes `open_from_shortfall` against a real encrypted order, and asserts `proposal_ready`, `300@Wed + 200@Fri`, linked pending message IDs, recipient, and sender; it also verifies missing-order escalation
- [ ] validation and migration review — `yarn generate` passes with generated outputs unchanged and no migration generated; lint exits 0 with 8 existing warnings; `yarn test --runInBand` passes 4 suites/13 tests; `yarn typecheck` and the elevated ephemeral integration build remain blocked by pre-existing duplicate-helper errors under `src/modules/agent_examples/**`; 3/3 manual J-001 runs remain pending; the existing Phase 2 migration SQL/snapshot remain reviewed and unapplied

### Phase 3 progress

- [x] supply-case list API — `GET /api/supplier_demo/supply-cases` uses `makeCrudRoute`, auth/view ACL, scoped status/search/pagination, updated-at descending sort, OpenAPI and `updatedAt` projection
- [x] retry API and command — `POST /api/supplier_demo/supply-cases/{id}/retry` dispatches `supplier_demo.supply_case.retry`, validates the current version, returns 409 on stale versions and 422 for non-retryable statuses, and runs installed mutation guards
- [x] manual disruption API and command — `POST /api/supplier_demo/supply-cases/report-disruption` validates confirmed single-SKU orders and integer quantity bounds, returns `case_exists` on duplicate reports, delegates to `open_from_shortfall(trigger=manual_disruption)`, and does not write WMS stock or reservation entities
- [x] supply cases page — Page/PageBody/DataTable with localized status tokens, search/status filters, pagination, loading/empty/error/permission states, focus/action refetch, guarded Retry action and shared 409 conflict surface
- [x] frozen Sales orders UMES extension — keyboard-accessible `Report supply disruption` row action plus CrudForm dialog with focus-on-open, Enter submit, Escape cancel and announced WMS/reservation advisory
- [x] integration test coverage added — TEST-006, TEST-009 and TEST-010 cover the list, keyboard fallback submit/duplicate conflict, and light/dark/narrow evidence when authenticated UI credentials are supplied; this environment skips them without credentials
- [x] validation and manual exit gate — the user verified J-002 keyboard flow, list light/dark/narrow states, and disconnected-mailbox Retry recovery; `yarn generate`, lint, ds:check and in-band Jest pass, while the repository typecheck/ephemeral build remain blocked by pre-existing `src/modules/agent_examples/**` duplicate-helper errors

### Phase 4 progress

- [x] pure deterministic planning and policy — `lib/planner.ts`, `lib/policy.ts`, `planner.test.ts`, `policy.test.ts`; normal fixture produces `400@Wed + 100@Fri`, SO-442 shifts 4 h at 120 PLN, and policy edge tests cover 4 vs 4.01 h and 500 vs 500.01 PLN — `yarn test --runInBand src/modules/supplier_demo/lib/__tests__/planner.test.ts src/modules/supplier_demo/lib/__tests__/policy.test.ts` passed
- [x] command wiring and atomic slot mutation — `commands/supply.ts`, `setup.ts`; baseline remains separate from current commitment, policy-human-required escalates without proposal-ready/send, and the command log `snapshotBefore.productionSlots` stores exact pre-mutation allocations; undo restores those arrays in scope — `npx tsc --noEmit` reported no `src/modules/supplier_demo` diagnostics
- [x] reproducible fixture/reset and proposal/list contracts — `cli.ts`, `TEST-003.spec.ts`, `TEST-012.spec.ts`, `proposal-contracts.test.ts`, `SupplyCasesTable.tsx`, `i18n/en.json`, `i18n/pl.json`; reset restores 400/400 seeded slots and accepts `--so442-priority high`, preflight checks the selected seed, mail assertions reject cost/plan/other-order data, and Proposed renders `currentCommitment` — `yarn generate && yarn test --runInBand` passed
- [x] integration and manual exit gate — TEST-003/TEST-012 were added but not executed because `yarn test:integration:ephemeral` cannot start its environment here (`spawn EPERM`); the repository-wide typecheck still exits on the known `src/modules/agent_examples/**` errors; the user confirmed the manual 3/3 mail/escalation gate on 2026-09-19

Manual Phase 4 exit gate:

1. Run `yarn mercato supplier_demo demo:reset`, then `yarn mercato supplier_demo demo:preflight`.
2. In WMS, adjust MAT-42 by `-700` with reason `damaged` and note `Capacity disruption`.
3. Confirm the newest draft `SO-441*`.
4. Verify the Manufacturer mailbox receives one proposal saying `400` on the original date and `100` on the next slot date; verify the case is `auto_approved` with `120 PLN` additional cost.
5. Run `yarn mercato supplier_demo demo:reset --so442-priority high`, then `yarn mercato supplier_demo demo:preflight --so442-priority high`.
6. Repeat steps 2–3 and verify the case is `escalated` with reason `policy_human_required`, the message remains unsent, and no new e-mail arrives.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Email transport | Supplier owner | — | `communication_channels` via `communicationChannelsSendAsUser` — 2026-09-18 |
| Q-002 | Recipient source | Supplier owner | — | Order `customerSnapshot.customer.primaryEmail` + env allowlist — 2026-09-18 |
| Q-003 | Planner in scope | Supplier owner | — | Yes, as a later phase (Phase 4) — 2026-09-18 |
| Q-004 | Second-tranche date | Supplier owner | — | Seeded `SupplierProductionSlot` — 2026-09-18 |
| Q-005 | Fallback button | Supplier owner | — | In this spec; ordered as Phase 3 after review — 2026-09-18 |
| Q-006 | Demo fixture | Supplier owner | — | Seed customer, SO-441, SO-442, slots; stock 1000; live Adjust −700 — 2026-09-18 |
| Q-007 | Envelope contract | Both owners | — | Roadmap §8/§20 shape frozen; `correlationId = SC-<orderNumber>` — 2026-09-18 |
| Q-008 | Add optional `payload.orderReference` / `payload.originalCommitment`? | Manufacturer owner | no | pending — not sent unless accepted |
| Q-009 | `channel_imap` (IMAP/SMTP) or `channel_gmail` (OAuth) for the Supplier mailbox? | Supplier owner | — | `channel_imap` — OVH-hosted mailbox (Zimbra `zimbra1.mail.ovh.net/modern`, webmail `webmail.mail.ovh.net`); see Phase 1 "Mailbox configuration" — 2026-09-18 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-18 | Skeleton + open questions |
| 2026-09-18 | Q-001…Q-007 resolved; full draft |
| 2026-09-18 | Independent review applied. Changes: hub enqueue ≠ delivery, so the spec now tracks `communication_channels.message.sent` / `.delivery_failed`. Added a `sending` marker with no automatic resend. Re-emit when the case is stuck in `proposal_ready`. Specified the mailbox actor's auth. Order load is now explicit. Added `demo:preflight`, warehouse assignment and relative dates. Envelope is stored without addresses. Fallback moved to Phase 3 ahead of the planner. Envelope frozen with no additive fields. Unified `attention_required` event. Single version source for 409. Retry covers `blocked_recipient`. Manual disruption is advisory. Added mutation guards and a kill-switch test. The review's suggestion to split the spec into 4 specs was not taken (user decided scope in Q-003/Q-005). |
| 2026-09-18 | Q-009 resolved: OVH-hosted mailbox via `channel_imap` (IMAP + SMTP). Added the Phase 1 mailbox configuration and OVH-specific risks. |
| 2026-09-18 | User approved implementation (handoff to Codex via `om-implement-spec`, phase by phase). Status → Ready for implementation. |
| 2026-09-19 | Review fix: `SupplyCase.customer_snapshot` added to the Data Model and the encryption map; `open_from_shortfall` escalates `multi_sku` when more than one variant is short. TEST-003 asserts ciphertext at rest and the multi_sku path. |
| 2026-09-19 | Phase 3 implementation: supply-case list/retry routes, manual disruption fallback command and route, authenticated DataTable page, frozen Sales orders row-action/dialog extension, i18n, and TEST-006/009/010 coverage. Phase 4 remains pending. |
| 2026-09-19 | Phase 4 implementation: deterministic replan/policy, 400/100 seeded slot fixture, transactional command-owned allocation move with command-log undo snapshot, high-priority escalation, reset/preflight priority option, new-commitment-only mail assertion, Proposed list column, policy translation, and TEST-012. Unit/lint/generation gates pass; integration startup is blocked by `spawn EPERM` and the known `agent_examples` typecheck baseline, so the Phase 4 exit gate remains in progress. |
| 2026-09-19 | Phase 4 review fixes: slot moves are persisted only for `auto_approved` plans; `highPriorityAllocationMoved` is raised only when recovery would require a high-priority order; `demo:preflight` compares jsonb slot allocations field by field; `demo:reset` retires production slots from earlier seed dates. Note: `shiftHours` is the allocation's declared shiftable window (demo narrative "+4 h"), not the computed distance between slots. |
