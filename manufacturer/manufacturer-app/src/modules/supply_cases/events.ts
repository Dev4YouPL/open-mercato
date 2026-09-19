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
        { path: 'commitments', type: 'object', optional: true },
        { path: 'caseCreated', type: 'boolean' },
        { path: 'occurredAt', type: 'date', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
      ],
    },
  },
  {
    id: 'supply_cases.alternative_offer.received',
    label: 'Alternative Offer Received',
    entity: 'supply_case',
    category: 'custom',
    payloadSchema: {
      fields: [
        { path: 'caseId', type: 'text' },
        { path: 'inboundMessageId', type: 'text' },
        { path: 'offerHash', type: 'text' },
        { path: 'status', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
      ],
    },
  },
  /**
   * Phase 4. Both fire post-commit from exactly one site each:
   * `confirmation_recorded` from `resolution.record_confirmation`, right after
   * the append-only `SupplyConfirmation` write; `resolved` from
   * `resolution.apply_confirmed`, right after the case's commit-point write
   * into `RESOLVED`. Neither payload carries supplier prose — identifiers,
   * verdicts and numbers only.
   */
  {
    id: 'supply_cases.case.confirmation_recorded',
    label: 'Supply Confirmation Recorded',
    entity: 'supply_case',
    category: 'custom',
    payloadSchema: {
      fields: [
        { path: 'id', type: 'text' },
        { path: 'caseId', type: 'text' },
        { path: 'correlationId', type: 'text' },
        { path: 'role', type: 'text' },
        { path: 'verdict', type: 'text' },
        { path: 'planId', type: 'text' },
        { path: 'inboundMessageId', type: 'text' },
        { path: 'confirmedCommitments', type: 'object', optional: true },
        { path: 'occurredAt', type: 'date', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
      ],
    },
  },
  {
    id: 'supply_cases.case.resolved',
    label: 'Supply Case Resolved',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'id', type: 'text' },
        { path: 'caseId', type: 'text' },
        { path: 'correlationId', type: 'text' },
        { path: 'planId', type: 'text' },
        { path: 'coveredQuantity', type: 'number' },
        { path: 'requiredQuantity', type: 'number' },
        { path: 'riskStatus', type: 'text' },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.analysis.started',
    label: 'Supply Analysis Started',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'operationId', type: 'text' },
        { path: 'kind', type: 'select' },
        { path: 'inboundMessageId', type: 'text', optional: true },
        { path: 'caseId', type: 'text', optional: true },
        { path: 'workflowInstanceId', type: 'text', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.analysis.completed',
    label: 'Supply Analysis Completed',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'operationId', type: 'text' },
        { path: 'kind', type: 'select' },
        { path: 'inboundMessageId', type: 'text', optional: true },
        { path: 'caseId', type: 'text', optional: true },
        { path: 'classification', type: 'select', optional: true },
        { path: 'triageOutcome', type: 'select', optional: true },
        { path: 'workflowInstanceId', type: 'text', optional: true },
        { path: 'requiredQuantity', type: 'number', optional: true },
        { path: 'coveredQuantity', type: 'number', optional: true },
        { path: 'missingQuantity', type: 'number', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.analysis.failed',
    label: 'Supply Analysis Failed',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'operationId', type: 'text' },
        { path: 'kind', type: 'select' },
        { path: 'inboundMessageId', type: 'text', optional: true },
        { path: 'caseId', type: 'text', optional: true },
        { path: 'reasonCode', type: 'select' },
        { path: 'retryable', type: 'boolean' },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.case.stage_changed',
    label: 'Supply Case Stage Changed',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'caseId', type: 'text' },
        { path: 'correlationId', type: 'text', optional: true },
        { path: 'fromStatus', type: 'select', optional: true },
        { path: 'toStatus', type: 'select' },
        { path: 'version', type: 'text', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.case.risk_detected',
    label: 'Supply Case Risk Detected',
    entity: 'supply_case',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'caseId', type: 'text' },
        { path: 'missingQuantity', type: 'number' },
        { path: 'requiredDate', type: 'date' },
        { path: 'riskStatus', type: 'select', optional: true },
        { path: 'factsHash', type: 'text', optional: true },
        { path: 'tenantId', type: 'text' },
        { path: 'organizationId', type: 'text' },
        { path: 'occurredAt', type: 'date', optional: true },
      ],
    },
  },
  {
    id: 'supply_cases.activity.recorded',
    label: 'Supply Activity Recorded',
    entity: 'activity',
    category: 'system',
    excludeFromTriggers: true,
    clientBroadcast: true,
    payloadSchema: {
      fields: [
        { path: 'id', type: 'text' },
        { path: 'activityId', type: 'text' },
        { path: 'caseId', type: 'text', optional: true },
        { path: 'occurredAt', type: 'date' },
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
export const ALTERNATIVE_OFFER_RECEIVED_EVENT = 'supply_cases.alternative_offer.received'
export const CASE_CONFIRMATION_RECORDED_EVENT = 'supply_cases.case.confirmation_recorded'
export const CASE_RESOLVED_EVENT = 'supply_cases.case.resolved'

export default eventsConfig
