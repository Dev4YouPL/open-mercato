import type { StoreScope, SupplyCasesStore } from '../../data/repositories'
import type {
  InboundMessage,
  InboundMessageTriageInput,
  ProductionPlan,
  SupplyCase,
  TriageDisposition,
} from '../../data/types'
import { DuplicateRecordKeyError, RecordNotFoundError } from '../../data/errors'
import { assembleTriageContext } from '../inbound/triageContext'
import { decideTriage, type TriageDecision } from './applyTriage'
import { runInboundTriage, type InboundTriageInvoker } from './runInboundTriage'
import { resolveTriageConfig } from './triageConfig'

/**
 * Turns one agent answer into persisted facts — the whole of
 * `supply_cases.inbound.apply_triage`, minus the command envelope.
 *
 * The bar lives INSIDE this step rather than at its caller. A caller that could
 * hand in a finished decision could hand in one that never cleared the bar, so
 * what it hands in is the agent's raw answer; the candidate list, the schema
 * bound and the auto-apply rules are all rebuilt here from scoped records.
 *
 * What it writes is deliberately small. An auto-applied message is LINKED to
 * its case; the case's own business fields (proposals, plans, commitments)
 * belong to the later phases and are not touched here, because triage knows
 * which case a message is about, not what the case should now do about it.
 */

export type ApplyTriageOutcome =
  | {
      status: 'applied'
      decision: TriageDecision
      message: InboundMessage
      /** The case the message was linked to, created or existing. Null unless auto-applied. */
      supplyCase: SupplyCase | null
    }
  | {
      /** The message already carried a disposition; nothing was re-decided or rewritten. */
      status: 'already_settled'
      disposition: TriageDisposition | null
      message: InboundMessage
      supplyCase: SupplyCase | null
    }

export type ApplyTriageDeps = {
  store: SupplyCasesStore
  scope: StoreScope
  invoke: InboundTriageInvoker
  confidenceThreshold?: number
}

export async function applyTriageOutcome(
  deps: ApplyTriageDeps,
  inboundMessageId: string,
): Promise<ApplyTriageOutcome> {
  const { store, scope } = deps
  const message = await store.inboundMessages.findById(scope, inboundMessageId)
  if (!message) throw new RecordNotFoundError('InboundMessage', inboundMessageId)

  // At-least-once delivery means this step runs again on messages it already
  // settled. A settled message is reported as it stands rather than re-decided:
  // a redelivery must not be able to move a message off the case it is on.
  if (message.triageDisposition !== null || message.triageOutcome !== null) {
    return {
      status: 'already_settled',
      disposition: message.triageDisposition,
      message,
      supplyCase: message.caseId ? await store.supplyCases.findById(scope, message.caseId) : null,
    }
  }

  const context = await assembleTriageContext(store, scope, message)
  if (!context.ok) {
    return settle(deps, message, {
      outcome: 'QUARANTINE',
      disposition: 'QUARANTINED',
      reason: 'EMPTY_BODY',
      needsAttention: false,
    })
  }

  const result = await runInboundTriage({
    sanitizedBody: context.input.sanitizedBody,
    senderEmail: context.input.senderEmail,
    candidates: context.input.candidates,
    invoke: deps.invoke,
  })

  const decision = decideTriage({
    result,
    candidates: context.input.candidates,
    confidenceThreshold: deps.confidenceThreshold ?? resolveTriageConfig().confidenceThreshold,
  })

  if (decision.outcome !== 'AUTO_APPLY') return settle(deps, message, decision)

  if (decision.target.kind === 'EXISTING_CASE') {
    const supplyCase = await store.supplyCases.requireById(scope, decision.target.caseId)
    return settle(deps, message, decision, supplyCase)
  }

  // A new case needs LOCAL demand, which a supplier e-mail does not carry. The
  // production plan for the extracted SKU supplies it; without one there is
  // nothing this message is an exception TO, so a human decides rather than the
  // module inventing a quantity and a date to keep the flow moving.
  const plan = await findPlanForSku(deps, decision.signal.sku)
  if (!plan) {
    return settle(deps, message, {
      outcome: 'NEEDS_ATTENTION',
      disposition: null,
      reason: 'NO_LOCAL_DEMAND',
      signal: decision.signal,
      candidateIndexes: context.input.candidates.map((candidate) => candidate.index),
    })
  }

  return settle(deps, message, decision, await createCaseFromPlan(deps, message, plan))
}

async function findPlanForSku(deps: ApplyTriageDeps, sku: string | null): Promise<ProductionPlan | null> {
  if (!sku) return null
  const plans = await deps.store.productionPlans.list(deps.scope)
  return plans.find((plan) => plan.materialSku === sku) ?? null
}

/**
 * The correlation id is what a person says out loud about this case, so it is a
 * short sequence rather than a UUID. The store enforces uniqueness inside the
 * scope, so a concurrent claim loses the insert and retries with the next
 * number instead of two cases sharing a name.
 */
async function createCaseFromPlan(
  deps: ApplyTriageDeps,
  message: InboundMessage,
  plan: ProductionPlan,
): Promise<SupplyCase> {
  const existing = await deps.store.supplyCases.list(deps.scope, { includeDeleted: true })
  let sequence = existing.length + 1
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await deps.store.supplyCases.create(deps.scope, {
        correlationId: formatCorrelationId(sequence),
        status: 'RECEIVED',
        sku: plan.materialSku,
        requiredQuantity: plan.requiredQuantity,
        requiredDate: plan.requiredDate,
        supplier1Email: message.senderEmail,
        productionPlanId: plan.id,
        productionOrderIds: plan.productionOrderIds,
      })
    } catch (error) {
      if (!(error instanceof DuplicateRecordKeyError)) throw error
      sequence += 1
    }
  }
  throw new Error('[internal] could not allocate a free supply case correlation id')
}

function formatCorrelationId(sequence: number): string {
  return `SC-${String(sequence).padStart(3, '0')}`
}

async function settle(
  deps: ApplyTriageDeps,
  message: InboundMessage,
  decision: TriageDecision,
  supplyCase: SupplyCase | null = null,
): Promise<ApplyTriageOutcome> {
  const recorded = await deps.store.inboundMessages.recordTriage(
    deps.scope,
    message.id,
    buildTriagePatch(decision, supplyCase),
  )
  return { status: 'applied', decision, message: recorded, supplyCase }
}

/**
 * Only an auto-applied message is linked. A message under review keeps its
 * extraction beside the original text — which is what a reviewer compares — but
 * no `caseId`, because linking it would assert the correlation the bar just
 * declined to trust.
 */
function buildTriagePatch(decision: TriageDecision, supplyCase: SupplyCase | null): InboundMessageTriageInput {
  if (decision.outcome === 'AUTO_APPLY') {
    return {
      caseId: supplyCase?.id ?? null,
      correlationId: supplyCase?.correlationId ?? null,
      messageIntent: decision.signal.intent,
      extraction: decision.signal,
      extractionConfidence: decision.signal.confidence,
      triageDisposition: 'AUTO_APPLIED',
      triageOutcome: 'AUTO_APPLIED',
      candidateIndexes: decision.target.kind === 'EXISTING_CASE' ? [decision.target.candidateIndex] : [],
      needsAttention: false,
      failureReason: null,
    }
  }
  if (decision.outcome === 'NEEDS_ATTENTION') {
    return {
      caseId: null,
      correlationId: null,
      messageIntent: decision.signal.intent,
      extraction: decision.signal,
      extractionConfidence: decision.signal.confidence,
      triageDisposition: null,
      triageOutcome: 'NEEDS_ATTENTION',
      candidateIndexes: [...decision.candidateIndexes],
      needsAttention: true,
      failureReason: `NEEDS_ATTENTION:${decision.reason}`,
    }
  }
  return {
    caseId: null,
    correlationId: null,
    messageIntent: null,
    extraction: null,
    extractionConfidence: null,
    triageDisposition: 'QUARANTINED',
    triageOutcome: 'QUARANTINED',
    candidateIndexes: [],
    needsAttention: decision.needsAttention,
    failureReason: `QUARANTINED:${decision.reason}`,
  }
}
