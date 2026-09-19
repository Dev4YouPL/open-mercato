# Research note — outbound path for Phase 2 (steps 6–7)

> **Status update (2026-09-19, same day).** The transport seam described below was
> subsequently BUILT, at the user's request, as the smallest slice that does not
> pre-empt the Phase 2 spec: `lib/outbound/sendSupplierMessage.ts` (decision),
> `lib/outbound/ports.ts` (wiring) and a `send-supplier-message` CLI as its real call
> site, covered by TEST-005A–I. What is still NOT built and still belongs to the spec:
> the RFQ/acceptance content, the `sourcing.*` commands, the workflow steps, and the
> actor decision's UI consequences. Sections 2 and 3 below record decisions that were
> taken as recommended; sections 5 and 6 remain open questions for the spec.

**This is not a spec.** It is a read-only rozpoznanie of the installed
`communication_channels` + `channel_imap` contract, written for whoever authors the
Phase 2 spec of [`2026-09-18-supplier-email-agent-workflow.md`](./2026-09-18-supplier-email-agent-workflow.md).
Every claim carries the file it was read from, at the
versions installed in this app (`@open-mercato/core` 0.8.0 + local patch,
`@open-mercato/channel-imap` 0.8.0).

Phase 2 steps 6–7 are "compose/send `ALTERNATIVE_SUPPLY_REQUEST` to Supplier 2 through
`communication_channels`" and "wait for delivery evidence before entering
`WAITING_FOR_ALTERNATIVE_OFFER`". Both are answerable today; the answers change several
things the Phase 1 spec assumed.

## 1. The send path exists in-process and needs no HTTP self-call

`communication_channels/lib/send-as-user.ts` exports `sendAsUser`, registered in DI as
**`communicationChannelsSendAsUser`** (`communication_channels/di.ts:46`). It composes the
`Message`, persists the outbound `MessageChannelLink` + `ChannelThreadMapping`, and
enqueues delivery. Input carries `to`, `cc`, `bcc`, `subject`, `body`, `inReplyTo`,
`references`, `parentMessageId` and free-form `channelMetadata`; it returns a
discriminated result rather than an HTTP `Response`, explicitly so other modules can call
it over DI.

The full chain is:

```
sendAsUser  ->  messages.message.sent (event)
            ->  communication_channels:outbound-bridge (persistent subscriber)
            ->  queue `communication-channels-outbound`
            ->  workers/outbound-delivery
            ->  command communication_channels.message.deliver_outbound
            ->  ImapChannelAdapter.sendMessage  (SMTP)
            ->  communication_channels.message.sent | .delivery_failed
```

**SMTP is real here.** `channel_imap` is IMAP **and** SMTP (`channel_imap/index.ts:3`,
`lib/smtp-client.ts`), and this app's seed already configures it:
`OM_SEED_SMTP_HOST=smtp.mail.ovh.net`, port `587`, `starttls`, `fromAddress =
manufacturer@hackon-om-wro.cloud`. No new channel package is needed to send the RFQ.

## 2. The blocker is the ACTOR, not the transport

`sendAsUser` takes an actor `{ userId, tenantId, organizationId }` and **refuses when the
channel is not owned by that user**: `if (channel.userId !== actor.userId)`
(`lib/send-as-user.ts:101`). A workflow step has no authenticated user.

The seeded channel is owned by a real user — `mailbox_seed/setup.ts` looks up
`OM_SEED_IMAP_USER_EMAIL` (`admin@acme.com`) and passes `userId: user.id` into
`connect_credential_channel`. So the options the spec has to choose between are:

1. the sourcing command sends **as the mailbox's owning user**, resolved from the channel
   row rather than from the request — which makes "who sent the RFQ" a property of the
   mailbox, not of the operator who clicked;
2. the send runs as the **disposing operator**, which requires every such operator to own
   the shared mailbox channel and is wrong for a shared supplier mailbox;
3. a system-actor send path is added that bypasses `sendAsUser` — the largest change, and
   it re-implements thread mapping and link persistence.

**Decided as option 1 and implemented.** `sendSupplierMessage` resolves the actor from
the channel row (`channel.userId`) and refuses with `CHANNEL_HAS_NO_OWNER` when the
mailbox has none — inventing an actor would be inventing an authorization. The spec still
owns the consequence: the RFQ is attributed to whoever owns the shared mailbox, so the
operator who dispositioned is recorded on the case, not on the mail.

This is a spec decision, and it is the same shape as the one T-09b already settled for
`apply_triage` (`scope` honoured only under `ctx.systemActor`) — except inverted: there the
caller was a subscriber with no actor; here a human dispositions and a machine sends.

## 3. `OutboundCorrelation` CAN be anchored before the send

This is the most useful finding, and it resolves the ordering hole in Phase 1's outbound
design (`buildOutboundIdempotencyKey` exists since T-08b, and nothing writes an anchor
outside fixtures — verified: no non-test caller of `outboundCorrelations.record*`).

The adapter accepts a **caller-supplied RFC 5322 Message-ID**:
`convertOutboundForEmail` reads `meta.messageId` (`channel_imap/lib/convert-outbound.ts:47`)
and `sendMessage` passes it to the SMTP client (`lib/adapter.ts`, `messageId:` in the
`smtp.send` call). Crucially, `messageId` is **not** stripped on the way through — the hub
only removes reply-targeting keys, and `REPLY_TARGETING_METADATA_KEYS = ['replyToExternalId',
'messageReferenceId']` (`lib/outbound-reply-ref.ts:113`).

So the sequence can be: mint the `Message-ID` → write the `OutboundCorrelation` anchor →
send with that exact id. A crash after the anchor leaves an unmatched anchor (harmless, and
the idempotency key makes the retry reuse it); a crash before the send leaves no mail. The
alternative — read the id back from the send result — has a window where an RFQ is
delivered and the reply can never be correlated.

**Implemented as described**, with one addition the spike did not anticipate: a replay
(the anchor already exists) sends NOTHING and reports the original identity, because a
delivered attempt and one that died before SMTP are indistinguishable from the anchor
alone, and double-mailing a real supplier is the worse failure. An explicit `resend`
reuses the anchored `Message-ID`. That is the manual-retry handle Phase 2 step 8 asks for.

**Trap worth naming in the spec:** the `communication_channels.message.sent` event payload's
`externalMessageId` is the **`ExternalMessage` row UUID, not the RFC Message-ID**
(`commands/deliver-outbound-message.ts`, the emit block). The RFC id is persisted separately
on `link.channelMetadata.messageId`, **bracket-stripped** to match the inbound convention.
A subscriber that stores `payload.externalMessageId` as the correlation anchor would store a
UUID and never match an inbound `In-Reply-To`. Note `resolveThread.ts` on our side must
agree on the bracket convention.

## 4. Delivery evidence is an event pair plus a link status

Phase 2 step 7 ("wait for delivery evidence") has three candidate oracles, all present:

- `communication_channels.message.sent` — persistent, emitted after the adapter returns
  `sent` and the link is flushed;
- `communication_channels.message.delivery_failed` — the failure half, carrying the
  classification;
- `MessageChannelLink.deliveryStatus`, lifecycle `queued -> pending -> sent | failed`, unique
  per `message_id`, which is the hub's own idempotency gate.

Note what SMTP evidence actually means: `getStatus` on this adapter returns a constant
`{ status: 'sent' }` (`channel_imap/lib/adapter.ts`), so there is **no delivery
confirmation, no read receipt and no bounce feedback** on this provider. "Delivered" here
means the SMTP server accepted the message. The exit gate's "exactly one real RFQ is
delivered" can be proven only to that boundary, and the spec should say so rather than imply
end-to-end delivery.

## 5. The hub already threads — and edits the body

`deliver-outbound-message` appends its own correlation marker to the outbound body: a
`[OM:<token>]` footer (hidden `<span>` in HTML, a bracketed trailer in plain text) plus a
synthetic `References` id (`buildBodyFooter` / `buildReferencesId`, `lib/thread-token.ts`).

Two consequences for `supply_cases`:

- our sanitizer (T-05a/T-05b) will meet `[OM:...]` on the inbound reply, because the
  supplier's client quotes it back. It must be stripped or it becomes part of the
  agent-visible body;
- the hub therefore has a **second, independent** reply-correlation mechanism running
  alongside our `OutboundCorrelation` anchor. The spec should state whether the two agree,
  which one is authoritative when they disagree, and why we keep our own — the honest answer
  is probably that ours is app-owned and survives the hub's thread mapping being absent, but
  that argument belongs in the spec, not in the code.

## 6. Two Phase 1 facts the Phase 2 design rests on

Established while closing T-10b, not by this spike:

- **`supply_cases.inbound-case` terminates on the first reply.** It has exactly three steps
  (`start` -> `await-reply` -> `end`, `src/modules/supply_cases/workflows.ts`), and
  `__tests__/inbound-workflow-engine.db.test.ts` asserts on the live engine that the first
  correlated reply drives the instance to `status: COMPLETED`, `currentStepId: 'end'`.
  Phase 2's exit gate requires a durable workflow still **waiting** after restart, so either
  this definition grows the Phase 2 steps or Phase 2 starts a second instance per case — and
  the second option retires the "one case, one instance" invariant the T-10b decision record
  relies on. This needs deciding in the spec, before code.
- **The module has exactly one command** (`supply_cases.inbound.apply_triage`). Phase 2 adds
  `sourcing.apply_decision` and `sourcing.request_alternative`, whose caller is a human, not
  a subscriber — so they cannot simply copy T-09b's "scope honoured only under
  `ctx.systemActor`" rule.

## Open questions this spike could not answer

- Whether a new outbound thread to Supplier 2 should reuse the case's existing conversation
  (the Supplier 1 thread) or open its own. `sendAsUser` supports both: `parentMessageId`
  joins an existing thread, omitting it starts a new one.
- What the RFQ body is. Nothing here touches composition or i18n.
- Whether `sendAsUser`'s outbound mutation guard (`guardOutboundCreate`,
  `lib/mutation-guards.ts`) imposes feature requirements a system-initiated send would fail.
