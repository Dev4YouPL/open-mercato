import type { SupplyCase, SupplyCommitment, SupplyMessage } from '../data/entities'

export const SUPPLY_TIMELINE_STEPS = [
  'detected',
  'baseline',
  'replan',
  'policy',
  'email_sent',
  'waiting',
  'email_received',
  'feasibility',
  'commitment_updated',
  'confirmation_sent',
  'resolved',
] as const

export type SupplyTimelineStepKey = typeof SUPPLY_TIMELINE_STEPS[number]
export type SupplyTimelineState = 'done' | 'current' | 'pending' | 'error' | 'skipped'

export type SupplyTimelineStep = {
  key: SupplyTimelineStepKey
  state: SupplyTimelineState
  at: string | null
  // Values interpolated into the localized step detail (`supplier_demo.supplyCases.timeline.detail.<key>`).
  params: Record<string, string | number>
}

type TimelineCase = Pick<SupplyCase,
  | 'status' | 'statusReason' | 'createdAt' | 'sku' | 'originalCommitment' | 'baselineCommitment' | 'currentCommitment'
  | 'planSummary' | 'policyDecision' | 'additionalCost' | 'currencyCode' | 'acceptedCommitment' | 'cancelledCommitment'
  | 'freedCapacity' | 'replyReceivedAt' | 'commitmentUpdatedAt' | 'resolvedAt'>

type TimelineMessage = Pick<SupplyMessage,
  | 'direction' | 'messageType' | 'deliveryStatus' | 'validationStatus' | 'duplicateCount'
  | 'createdAt' | 'queuedAt' | 'deliveredAt' | 'receivedAt'>

const WAITING_STATUSES = new Set(['proposal_queued', 'proposal_delivered'])
const FAILED_DELIVERY = new Set(['enqueue_failed', 'delivery_failed'])
const IN_FLIGHT_DELIVERY = new Set(['pending', 'sending', 'queued_in_hub'])

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function formatCommitments(commitments: SupplyCommitment[] | null | undefined): string {
  return (commitments ?? []).map((entry) => `${entry.quantity} · ${entry.date}`).join(', ')
}

function step(key: SupplyTimelineStepKey, state: SupplyTimelineState, at: Date | null | undefined = null, params: Record<string, string | number> = {}): SupplyTimelineStep {
  return { key, state, at: iso(at), params }
}

function latest<T extends TimelineMessage>(messages: T[], predicate: (message: T) => boolean): T | null {
  const matches = messages.filter(predicate)
  return matches.length ? matches[matches.length - 1] : null
}

function outboundStep(key: 'email_sent' | 'confirmation_sent', message: TimelineMessage | null, params: Record<string, string | number>): SupplyTimelineStep {
  if (!message) return step(key, 'pending', null, params)
  if (message.deliveryStatus === 'delivered') return step(key, 'done', message.deliveredAt ?? message.queuedAt ?? message.createdAt, params)
  if (FAILED_DELIVERY.has(message.deliveryStatus)) return step(key, 'error', message.queuedAt ?? message.createdAt, params)
  if (IN_FLIGHT_DELIVERY.has(message.deliveryStatus) && message.deliveryStatus !== 'pending') return step(key, 'current', message.queuedAt ?? message.createdAt, params)
  return step(key, 'pending', null, params)
}

/**
 * Builds the roadmap §5 Supplier timeline from persisted timestamps only. Every step is always present, so the
 * console renders the same 11 rows for every case; steps that do not apply (Level 3 has no replan) are `skipped`.
 */
export function buildSupplyCaseTimeline(supplyCase: TimelineCase, messages: TimelineMessage[]): SupplyTimelineStep[] {
  const ordered = [...messages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  const proposal = latest(ordered, (message) => message.direction === 'outbound' && message.messageType === 'SUPPLY_PROPOSAL')
  const confirmation = latest(ordered, (message) => message.direction === 'outbound' && message.messageType === 'SUPPLY_COMMITMENT_CONFIRMED')
  const inbound = ordered.filter((message) => message.direction === 'inbound')
  const validReply = latest(inbound, (message) => message.validationStatus === 'valid')
  const lastInbound = inbound.length ? inbound[inbound.length - 1] : null
  const rejectedCount = inbound.filter((message) => message.validationStatus !== 'valid').length
  const duplicates = inbound.reduce((total, message) => total + (message.duplicateCount ?? 0), 0)
  const reason = supplyCase.statusReason ?? ''
  const infeasible = supplyCase.status === 'needs_human' && reason.startsWith('acceptance_infeasible_')
  const planSummary = supplyCase.planSummary as { movedAllocations?: Array<{ orderNumber?: string; shiftHours?: number }> } | null | undefined
  const moved = planSummary?.movedAllocations?.[0]

  const steps: SupplyTimelineStep[] = [
    step('detected', 'done', supplyCase.createdAt, {
      sku: supplyCase.sku,
      original: formatCommitments(supplyCase.originalCommitment),
    }),
    supplyCase.baselineCommitment.length
      ? step('baseline', 'done', supplyCase.createdAt, { commitments: formatCommitments(supplyCase.baselineCommitment) })
      : step('baseline', supplyCase.status === 'escalated' ? 'error' : 'pending'),
    planSummary
      ? step('replan', 'done', supplyCase.createdAt, {
        commitments: formatCommitments(supplyCase.currentCommitment),
        order: moved?.orderNumber ?? '',
        hours: moved?.shiftHours ?? 0,
        cost: supplyCase.additionalCost ?? '0',
        currency: supplyCase.currencyCode,
      })
      : step('replan', 'skipped'),
    supplyCase.policyDecision
      ? step('policy', supplyCase.policyDecision === 'auto_approved' ? 'done' : 'error', supplyCase.createdAt, { decision: supplyCase.policyDecision })
      : step('policy', 'skipped'),
    outboundStep('email_sent', proposal, { commitments: formatCommitments(supplyCase.currentCommitment) }),
    validReply || !WAITING_STATUSES.has(supplyCase.status)
      ? step('waiting', validReply || lastInbound ? 'done' : 'pending', validReply?.receivedAt ?? null)
      : step('waiting', 'current'),
    lastInbound
      ? step(
        'email_received',
        validReply ? 'done' : 'error',
        (validReply ?? lastInbound).receivedAt ?? (validReply ?? lastInbound).createdAt,
        {
          type: (validReply ?? lastInbound).messageType ?? 'UNKNOWN',
          validation: (validReply ?? lastInbound).validationStatus ?? 'unknown',
          rejected: rejectedCount,
          duplicates,
        },
      )
      : step('email_received', 'pending'),
    supplyCase.commitmentUpdatedAt
      ? step('feasibility', 'done', supplyCase.commitmentUpdatedAt)
      : infeasible ? step('feasibility', 'error', null, { reason }) : step('feasibility', 'pending'),
    supplyCase.commitmentUpdatedAt
      ? step('commitment_updated', 'done', supplyCase.commitmentUpdatedAt, {
        accepted: formatCommitments(supplyCase.acceptedCommitment),
        cancelled: formatCommitments(supplyCase.cancelledCommitment),
        freed: formatCommitments(supplyCase.freedCapacity),
      })
      : step('commitment_updated', 'pending'),
    outboundStep('confirmation_sent', confirmation, { commitments: formatCommitments(supplyCase.acceptedCommitment) }),
    supplyCase.resolvedAt ? step('resolved', 'done', supplyCase.resolvedAt) : step('resolved', 'pending'),
  ]
  return steps
}
