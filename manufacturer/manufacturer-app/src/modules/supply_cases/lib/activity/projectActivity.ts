import type { SubscriberContext } from '@open-mercato/events/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitSupplyCasesEvent } from '../../events'
import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import {
  activityReasonCodeSchema,
  activityRiskStatusSchema,
  activityStageSchema,
  activityVerdictSchema,
  type ActivityReasonCode,
  type ActivityRiskStatus,
  type ActivityStage,
  type ActivityVerdict,
  type ActivityKind,
  type ActivityParams,
  type SupplyActivityEntry,
  type SupplyActivityEntryInput,
} from '../../data/activity'

const logger = createLogger('supply_cases').child({ component: 'activity-projector' })

type ProjectActivityOptions = {
  eventName: string
  payload: unknown
  store: SupplyCasesStore
  scope: StoreScope
  now?: () => string
}

type ActivityPayload = Record<string, unknown>

export async function projectActivityEvent(options: ProjectActivityOptions): Promise<void> {
  if (options.eventName === 'supply_cases.activity.recorded') return
  const payload = asRecord(options.payload)
  if (!payload) return
  const mapped = await mapEvent(options.eventName, payload, options.store, options.scope, options.now ?? (() => new Date().toISOString()))
  if (!mapped) return
  const activities = Array.isArray(mapped) ? mapped : [mapped]
  for (const activity of activities) {
    const result = await options.store.activities.appendIfAbsent(options.scope, activity)
    if (result.status !== 'recorded') continue
    await emitSupplyCasesEvent('supply_cases.activity.recorded', {
      id: result.entry.id,
      activityId: result.entry.id,
      caseId: result.entry.caseId,
      occurredAt: result.entry.occurredAt,
      tenantId: options.scope.tenantId,
      organizationId: options.scope.organizationId,
    }, {
      tenantId: options.scope.tenantId,
      organizationId: options.scope.organizationId,
    })
  }
}

export async function projectActivityFromSubscriber(
  eventName: string,
  payload: unknown,
  ctx: SubscriberContext,
): Promise<void> {
  if (eventName === 'supply_cases.activity.recorded') return
  const tenantId = nonEmpty(ctx.tenantId)
  const organizationId = nonEmpty(ctx.organizationId)
  if (!tenantId || !organizationId) {
    const error = new Error('[internal] activity subscriber received an event without trusted scope')
    logger.error('Activity projection rejected an event without trusted scope', { eventName })
    getTelemetryRuntime()?.reportError(error, { module: 'supply_cases', code: 'activity.scope_missing', attributes: { eventName } })
    throw error
  }
  const store = ctx.resolve<SupplyCasesStore>('supplyCasesStore')
  await projectActivityEvent({ eventName, payload, store, scope: { tenantId, organizationId } })
}

async function mapEvent(
  eventName: string,
  payload: ActivityPayload,
  store: SupplyCasesStore,
  scope: StoreScope,
  now: () => string,
): Promise<SupplyActivityEntryInput | SupplyActivityEntryInput[] | null> {
  const occurredAt = isoOrDefault(payload.occurredAt ?? payload.receivedAt, now())
  const caseId = nonEmpty(payload.caseId)
  const inboundMessageId = nonEmpty(payload.inboundMessageId)
  const operationId = nonEmpty(payload.operationId)
  const correlationId = caseId ? (await store.supplyCases.findById(scope, caseId))?.correlationId ?? null : null
  const workflowInstanceId = nonEmpty(payload.workflowInstanceId)
  const agentRunId = nonEmpty(payload.agentRunId)
  const base = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    caseId,
    caseCorrelationId: correlationId,
    actorType: 'system' as const,
    actorRef: null,
    evidenceType: inboundMessageId ? 'inbound_message' as const : caseId ? 'case' as const : null,
    evidenceId: inboundMessageId ?? caseId,
    technicalRefType: workflowInstanceId ? 'workflow_instance' as const : agentRunId ? 'agent_run' as const : null,
    technicalRefId: workflowInstanceId ?? agentRunId,
    occurredAt,
    sourceEventId: eventName,
  }

  if (eventName === 'supply_cases.inbound_message.accepted') {
    const messageId = inboundMessageId ?? nonEmpty(payload.id)
    if (!messageId) return null
    return entry({
      ...base,
      caseId: null,
      caseCorrelationId: null,
      evidenceType: 'inbound_message',
      evidenceId: messageId,
      kind: 'email_received',
      status: 'info',
      titleKey: 'supply_cases.activity.emailReceived',
      detailKey: 'supply_cases.activity.emailReceivedDetail',
      params: {},
      dedupeKey: `inbound:${messageId}:accepted`,
      groupKey: `inbound:${messageId}`,
      sourceOccurrenceId: messageId,
    })
  }

  if (eventName === 'supply_cases.case.proposal_received') {
    const messageId = inboundMessageId ?? nonEmpty(payload.id)
    if (!caseId || !messageId) return null
    const deliveries = readDeliveries(payload.commitments)
    return [entry({
      ...base,
      kind: 'supplier_offer_extracted',
      status: 'success',
      titleKey: 'supply_cases.activity.supplierOfferExtracted',
      detailKey: deliveries.length > 0 ? 'supply_cases.activity.supplierOfferExtractedDetail' : 'supply_cases.activity.supplierOfferExtractedGeneric',
      params: deliveries.length > 0 ? { supplierRole: 'SUPPLIER_1', deliveries } : { supplierRole: 'SUPPLIER_1' },
      dedupeKey: `case:${caseId}:proposal:${messageId}`,
      groupKey: `inbound:${messageId}`,
      sourceOccurrenceId: messageId,
    }), entry({
        ...base,
        kind: 'case_created',
        status: 'success',
        titleKey: 'supply_cases.activity.caseCreated',
        detailKey: 'supply_cases.activity.caseCreatedDetail',
        params: correlationId ? { correlationId } : {},
        dedupeKey: `case:${caseId}:created`,
        groupKey: `case:${caseId}`,
        sourceOccurrenceId: caseId,
      })]
  }

  if (eventName === 'supply_cases.alternative_offer.received' && caseId) {
    const offerHash = nonEmpty(payload.offerHash) ?? inboundMessageId ?? 'alternative'
    return entry({
      ...base,
      kind: 'supplier_offer_extracted',
      status: 'success',
      titleKey: 'supply_cases.activity.supplierOfferExtracted',
      detailKey: 'supply_cases.activity.supplierOfferExtractedGeneric',
      params: { supplierRole: 'SUPPLIER_2' },
      dedupeKey: `case:${caseId}:alternative:${offerHash}`,
      groupKey: `case:${caseId}:alternative`,
      sourceOccurrenceId: offerHash,
    })
  }

  if (eventName === 'supply_cases.analysis.started' && operationId) {
    const kind = payload.kind === 'initial_impact' ? 'initialImpact' : 'inboundTriage'
    const groupKey = analysisGroupKey(kind, caseId, inboundMessageId, operationId)
    const priorEntries = await store.activities.list(scope)
    const priorAttempts = priorEntries.filter((candidate) => candidate.groupKey === groupKey && ['analysis_started', 'retry_started'].includes(candidate.kind))
    const retry = priorAttempts.length > 0 && hasOpenFailureOrStale(priorEntries, groupKey, occurredAt, kind === 'initialImpact')
    const analysisKind: ActivityKind = retry ? 'retry_started' : 'analysis_started'
    const attempt = priorAttempts.length + 1
    return entry({
      ...base,
      caseId,
      caseCorrelationId: correlationId,
      kind: analysisKind,
      status: 'running',
      titleKey: retry ? 'supply_cases.activity.agentRetrying' : kind === 'initialImpact' ? 'supply_cases.activity.agentCheckingImpact' : 'supply_cases.activity.agentCheckingEmail',
      detailKey: retry ? 'supply_cases.activity.retryStartedDetail' : 'supply_cases.activity.analysisStartedDetail',
      params: retry ? { agentKey: kind, attempt } : { agentKey: kind },
      dedupeKey: `analysis:${operationId}:started`,
      groupKey,
      sourceOccurrenceId: operationId,
    })
  }

  if (eventName === 'supply_cases.analysis.completed' && operationId) {
    const isInitialImpact = payload.kind === 'initial_impact'
    if (!isInitialImpact) {
      const groupKey = analysisGroupKey('inboundTriage', caseId, inboundMessageId, operationId)
      const classification = readClassification(payload.classification)
      const triageOutcome = readTriageOutcome(payload.triageOutcome)
      if (classification !== 'SUPPLIER') {
        const quarantined = triageOutcome === 'QUARANTINED'
        return entry({
          ...base,
          kind: 'analysis_completed',
          status: quarantined ? 'warning' : 'success',
          titleKey: quarantined ? 'supply_cases.activity.analysisQuarantined' : 'supply_cases.activity.analysisCompleted',
          detailKey: quarantined ? 'supply_cases.activity.analysisQuarantinedDetail' : 'supply_cases.activity.analysisCompletedDetail',
          params: {},
          dedupeKey: `analysis:${operationId}:completed`,
          groupKey,
          sourceOccurrenceId: operationId,
        })
      }
      return entry({
        ...base,
        kind: 'sender_classified',
        status: 'success',
        titleKey: 'supply_cases.activity.senderClassifiedAsSupplier',
        detailKey: 'supply_cases.activity.senderClassifiedDetail',
        params: { supplierRole: 'SUPPLIER_1' },
        dedupeKey: `analysis:${operationId}:classified`,
        groupKey,
        sourceOccurrenceId: operationId,
      })
    }
    const requiredQuantity = finiteNumber(payload.requiredQuantity)
    const coveredQuantity = finiteNumber(payload.coveredQuantity)
    const missingQuantity = finiteNumber(payload.missingQuantity)
    const params: ActivityParams = requiredQuantity !== null && coveredQuantity !== null && missingQuantity !== null
      ? { requiredQuantity, coveredQuantity, missingQuantity }
      : {}
    return entry({
      ...base,
      kind: 'analysis_completed',
      status: 'success',
      titleKey: 'supply_cases.activity.offerComparedWithDemand',
      detailKey: requiredQuantity !== null ? 'supply_cases.activity.offerComparedWithDemandDetail' : 'supply_cases.activity.analysisCompletedDetail',
      params,
      dedupeKey: `analysis:${operationId}:completed`,
      groupKey: analysisGroupKey(isInitialImpact ? 'initialImpact' : 'inboundTriage', caseId, inboundMessageId, operationId),
      sourceOccurrenceId: operationId,
    })
  }

  if (eventName === 'supply_cases.analysis.failed' && operationId) {
    const reasonCode = readReasonCode(payload.reasonCode)
    return entry({
      ...base,
      kind: 'operation_failed',
      status: 'error',
      titleKey: 'supply_cases.activity.analysisFailed',
      detailKey: 'supply_cases.activity.analysisFailedDetail',
      params: { reasonCode, retryable: payload.retryable === true },
      dedupeKey: `operation:${operationId}:failed:${reasonCode}`,
      groupKey: analysisGroupKey(payload.kind === 'initial_impact' ? 'initialImpact' : 'inboundTriage', caseId, inboundMessageId, operationId),
      sourceOccurrenceId: operationId,
    })
  }

  if (eventName === 'supply_cases.case.risk_detected' && caseId) {
    const missingQuantity = finiteNumber(payload.missingQuantity)
    const requiredDate = validDate(payload.requiredDate)
    if (missingQuantity === null || !requiredDate) return null
    return entry({
      ...base,
      kind: 'risk_detected',
      status: 'warning',
      titleKey: 'supply_cases.activity.riskDetected',
      detailKey: 'supply_cases.activity.riskDetectedDetail',
      params: { missingQuantity, requiredDate },
      dedupeKey: `case:${caseId}:risk:${nonEmpty(payload.factsHash) ?? `${missingQuantity}:${requiredDate}`}`,
      groupKey: `case:${caseId}:risk`,
      sourceOccurrenceId: nonEmpty(payload.factsHash) ?? `${missingQuantity}:${requiredDate}`,
    })
  }

  if (eventName === 'supply_cases.case.stage_changed' && caseId) {
    const status = readStage(payload.toStatus)
    if (!status) return null
    const waiting = ['WAITING_FOR_ALTERNATIVE_OFFER', 'WAITING_FOR_SUPPLIER_CONFIRMATIONS'].includes(status)
    const version = nonEmpty(payload.version) ?? status
    return entry({
      ...base,
      kind: waiting ? 'waiting_external' : 'stage_changed',
      status: waiting ? 'waiting' : 'info',
      titleKey: waiting ? 'supply_cases.activity.waitingExternal' : 'supply_cases.activity.stageChanged',
      detailKey: 'supply_cases.activity.stageChangedDetail',
      params: { stage: status },
      dedupeKey: `case:${caseId}:stage:${status}:${version}`,
      groupKey: `case:${caseId}:stages`,
      sourceOccurrenceId: `${status}:${version}`,
    })
  }

  if (eventName === 'supply_cases.case.confirmation_recorded' && caseId) {
    const role = readSupplierRole(payload.role)
    const verdict = readVerdict(payload.verdict)
    const deliveries = readDeliveries(payload.confirmedCommitments)
    if (!role || !verdict) return null
    const messageId = inboundMessageId ?? nonEmpty(payload.id) ?? role
    return entry({
      ...base,
      kind: 'confirmation_recorded',
      status: 'success',
      titleKey: 'supply_cases.activity.confirmationRecorded',
      detailKey: deliveries.length > 0 ? 'supply_cases.activity.confirmationRecordedDetail' : 'supply_cases.activity.confirmationRecordedGeneric',
      params: deliveries.length > 0 ? { supplierRole: role, verdict, deliveries } : { supplierRole: role, verdict },
      dedupeKey: `case:${caseId}:confirmation:${messageId}`,
      groupKey: `case:${caseId}:confirmations`,
      sourceOccurrenceId: messageId,
    })
  }

  if (eventName === 'supply_cases.case.resolved' && caseId) {
    const coveredQuantity = finiteNumber(payload.coveredQuantity)
    const requiredQuantity = finiteNumber(payload.requiredQuantity)
    const riskStatus = readRiskStatus(payload.riskStatus)
    if (coveredQuantity === null || requiredQuantity === null || !riskStatus) return null
    const planId = nonEmpty(payload.planId) ?? caseId
    return entry({
      ...base,
      kind: 'case_resolved',
      status: 'success',
      titleKey: 'supply_cases.activity.caseResolved',
      detailKey: 'supply_cases.activity.caseResolvedDetail',
      params: { coveredQuantity, requiredQuantity, riskStatus },
      dedupeKey: `case:${caseId}:resolved:${planId}`,
      groupKey: `case:${caseId}`,
      sourceOccurrenceId: planId,
    })
  }

  return null
}

function entry(input: Omit<SupplyActivityEntryInput, 'tenantId' | 'organizationId'> & { tenantId: string; organizationId: string }): SupplyActivityEntryInput {
  return input
}

function asRecord(value: unknown): ActivityPayload | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ActivityPayload : null
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function isoOrDefault(value: unknown, fallback: string): string {
  const candidate = nonEmpty(value)
  return candidate && !Number.isNaN(Date.parse(candidate)) ? new Date(candidate).toISOString() : fallback
}

function validDate(value: unknown): string | null {
  const candidate = nonEmpty(value)
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null
}

function readSupplierRole(value: unknown): 'SUPPLIER_1' | 'SUPPLIER_2' | null {
  return value === 'SUPPLIER_1' || value === 'SUPPLIER_2' ? value : null
}

function readReasonCode(value: unknown): ActivityReasonCode {
  const parsed = activityReasonCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'ANALYSIS_FAILED'
}

function readRiskStatus(value: unknown): ActivityRiskStatus | null {
  const parsed = activityRiskStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function readStage(value: unknown): ActivityStage | null {
  const parsed = activityStageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function readVerdict(value: unknown): ActivityVerdict | null {
  const parsed = activityVerdictSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function readClassification(value: unknown): 'SUPPLIER' | 'NON_SUPPLIER' | 'UNKNOWN' {
  return value === 'SUPPLIER' || value === 'NON_SUPPLIER' ? value : 'UNKNOWN'
}

function readTriageOutcome(value: unknown): 'AUTO_APPLIED' | 'NEEDS_ATTENTION' | 'QUARANTINED' | null {
  return value === 'AUTO_APPLIED' || value === 'NEEDS_ATTENTION' || value === 'QUARANTINED' ? value : null
}

function readDeliveries(value: unknown): Array<{ quantity: number; date: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    const quantity = finiteNumber(record?.quantity)
    const date = nonEmpty(record?.date) ?? nonEmpty(record?.deliveryDate)
    return quantity !== null && date && !Number.isNaN(Date.parse(date)) ? [{ quantity, date }] : []
  }).slice(0, 20)
}

function analysisGroupKey(agentKey: 'inboundTriage' | 'initialImpact', caseId: string | null, inboundMessageId: string | null, operationId: string): string {
  return `analysis:${agentKey}:${inboundMessageId ?? caseId ?? operationId}`
}

function hasOpenFailureOrStale(entries: SupplyActivityEntry[], groupKey: string, occurredAt: string, impact: boolean): boolean {
  const terminal = entries.some((candidate) => candidate.groupKey === groupKey && ['analysis_completed', 'sender_classified', 'operation_failed'].includes(candidate.kind))
  if (terminal) return entries.some((candidate) => candidate.groupKey === groupKey && candidate.kind === 'operation_failed')
  const threshold = (impact ? 5 : 2) * 60_000
  return entries.some((candidate) => ['analysis_started', 'retry_started'].includes(candidate.kind) && candidate.groupKey === groupKey && Date.parse(occurredAt) - Date.parse(candidate.occurredAt) >= threshold)
}
