import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * `supply_cases.inbound_message.accepted` is emitted only after the
 * deterministic transport gate passed AND the `InboundMessage` was persisted.
 * It is the boundary between "a message was observed by some channel" and "this
 * module has taken responsibility for it", and the later triage workflow starts
 * from here.
 *
 * The payload carries identifiers and scope only. The body stays in the intake
 * record: the raw text is untrusted supplier prose, and putting it on the bus
 * would copy it into every subscriber, queue and trace that touches the event.
 *
 * `supply_cases.case.proposal_received` is the second boundary, and it is
 * deliberately NOT emitted by the gate: it asserts that a classified supplier
 * proposal now has a case, which only the deterministic triage apply can know.
 * It fires once per message, after `supply_cases.inbound.apply_triage` has
 * auto-applied and linked a case — never on a replay, never on NEEDS_ATTENTION
 * and never on a quarantine.
 */
const events = [
  {
    id: 'supply_cases.inbound_message.accepted',
    label: 'Inbound Message Accepted',
    entity: 'inbound_message',
    category: 'custom',
    payloadSchema: {
      fields: [
        { path: 'id', type: 'text' },
        { path: 'inboundMessageId', type: 'text' },
        { path: 'rfcMessageId', type: 'text' },
        { path: 'channelLinkId', type: 'text' },
        { path: 'providerKey', type: 'text' },
        { path: 'senderEmail', type: 'text' },
        { path: 'recipientEmail', type: 'text' },
        { path: 'receivedAt', type: 'date', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
      ],
    },
  },
  {
    id: 'supply_cases.case.proposal_received',
    label: 'Supply Case Proposal Received',
    entity: 'supply_case',
    category: 'custom',
    payloadSchema: {
      fields: [
        { path: 'id', type: 'text' },
        { path: 'caseId', type: 'text' },
        { path: 'correlationId', type: 'text' },
        { path: 'inboundMessageId', type: 'text' },
        { path: 'rfcMessageId', type: 'text' },
        { path: 'senderEmail', type: 'text' },
        { path: 'sku', type: 'text', optional: true },
        { path: 'caseCreated', type: 'boolean' },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
      ],
    },
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'supply_cases', events })
export const emitSupplyCasesEvent = eventsConfig.emit
export type SupplyCasesEventId = (typeof events)[number]['id']

export const INBOUND_MESSAGE_ACCEPTED_EVENT = 'supply_cases.inbound_message.accepted'
export const CASE_PROPOSAL_RECEIVED_EVENT = 'supply_cases.case.proposal_received'

export default eventsConfig
