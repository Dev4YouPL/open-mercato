import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { StoreScope, SupplyCasesStore } from '../data/repositories'
import { initialImpactAnalysisSchema } from '../data/initial-impact'
import { buildAdvisorInput, buildCanonicalInitialOptions, calculateInitialImpact, loadInitialImpactSnapshot } from '../lib/impact/initialImpactService'
import { runInitialImpactAdvisor, type InitialImpactAdvisorInvoker } from '../lib/impact/runInitialImpactAdvisor'
import { signalCaseWorkflow } from '../lib/workflow/phaseSignals'
import { INITIAL_IMPACT_READY_SIGNAL } from '../workflows'
import { emitSupplyCasesEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('supply_cases').child({ component: 'initial-impact-activity' })

export const RECORD_INITIAL_IMPACT_COMMAND_ID = 'supply_cases.analysis.record_initial'

const scopeSchema = z.object({ tenantId: z.string().min(1), organizationId: z.string().min(1) }).strict()
const inputSchema = z.object({ caseId: z.string().min(1), scope: scopeSchema.optional() }).strict()

export type RecordInitialImpactResult = {
  status: 'recorded' | 'already_recorded' | 'needs_attention'
  caseId: string
  initialProposalId: string | null
  factsHash: string | null
  reason: string | null
  selectedOptionId: null
}

const recordInitialImpactCommand: CommandHandler<Record<string, unknown>, RecordInitialImpactResult> = {
  id: RECORD_INITIAL_IMPACT_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inputSchema.parse(rawInput)
    const scope = resolveScope(ctx, input.scope)
    const store = ctx.container.resolve<SupplyCasesStore>('supplyCasesStore')
    const current = await store.supplyCases.requireById(scope, input.caseId)
    if (current.initialAnalysis !== null && current.initialProposalId !== null) {
      return {
        status: 'already_recorded',
        caseId: current.id,
        initialProposalId: current.initialProposalId,
        factsHash: current.initialFactsHash,
        reason: null,
        selectedOptionId: null,
      }
    }

    const operationId = randomUUID()
    await store.supplyCases.update(scope, current.id, { status: 'ANALYZING_INITIAL_IMPACT', needsAttentionReason: null })
    await emitActivityEvent('supply_cases.case.stage_changed', {
      caseId: current.id,
      correlationId: current.correlationId,
      fromStatus: current.status,
      toStatus: 'ANALYZING_INITIAL_IMPACT',
      version: current.updatedAt,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      occurredAt: new Date().toISOString(),
    }, scope)
    await emitActivityEvent('supply_cases.analysis.started', {
      operationId,
      kind: 'initial_impact',
      caseId: current.id,
      workflowInstanceId: current.workflowInstanceId,
      occurredAt: new Date().toISOString(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, scope)
    const loaded = await loadInitialImpactSnapshot(store, scope, current.id)
    if (!loaded.ok) {
      await store.supplyCases.update(scope, current.id, {
        status: 'NEEDS_ATTENTION',
        needsAttentionReason: 'MISSING_DATA',
        initialAnalysis: null,
        initialOptions: null,
      })
      await emitActivityEvent('supply_cases.analysis.failed', {
        operationId,
        kind: 'initial_impact',
        caseId: current.id,
        reasonCode: 'MISSING_DATA',
        retryable: false,
        occurredAt: new Date().toISOString(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }, scope)
      return {
        status: 'needs_attention',
        caseId: current.id,
        initialProposalId: null,
        factsHash: null,
        reason: loaded.reasonCodes.join(','),
        selectedOptionId: null,
      }
    }

    const impact = calculateInitialImpact(loaded.snapshot)
    const options = buildCanonicalInitialOptions(loaded.snapshot, impact)
    const advisorInput = buildAdvisorInput(loaded.snapshot, impact, options)
    const result = await runInitialImpactAdvisor(advisorInput, resolveInvoker(ctx, scope))
    if (!result.ok) {
      const failedAnalysis = initialImpactAnalysisSchema.parse({
        schemaVersion: 1,
        factsHash: options[0].factsHash,
        facts: impact,
        options,
        advisor: null,
        dataQuality: 'NEEDS_ATTENTION',
        failureReason: result.reason,
        recordedAt: new Date().toISOString(),
      })
      await store.supplyCases.update(scope, current.id, {
        status: 'NEEDS_ATTENTION',
        needsAttentionReason: 'ANALYSIS_FAILED',
        initialAnalysis: failedAnalysis,
        initialOptions: options,
        initialFactsHash: options[0].factsHash,
        initialAnalyzedAt: new Date().toISOString(),
      })
      await emitActivityEvent('supply_cases.analysis.failed', {
        operationId,
        kind: 'initial_impact',
        caseId: current.id,
        reasonCode: result.reason,
        retryable: result.reason === 'AGENT_UNAVAILABLE',
        occurredAt: new Date().toISOString(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }, scope)
      return {
        status: 'needs_attention',
        caseId: current.id,
        initialProposalId: null,
        factsHash: options[0].factsHash,
        reason: result.reason,
        selectedOptionId: null,
      }
    }

    const analysis = initialImpactAnalysisSchema.parse({
      schemaVersion: 1,
      factsHash: options[0].factsHash,
      facts: impact,
      options,
      advisor: result.result,
      dataQuality: 'VALID',
      failureReason: null,
      recordedAt: new Date().toISOString(),
    })
    const proposalId = randomUUID()
    await store.supplyCases.update(scope, current.id, {
      status: 'AWAITING_SOURCING_DECISION',
      needsAttentionReason: null,
      initialAnalysis: analysis,
      initialOptions: options,
      selectedInitialOptionId: null,
      initialProposalId: proposalId,
      initialAnalyzedAt: analysis.recordedAt,
      initialFactsHash: analysis.factsHash,
      initialDecisionIdempotencyKey: null,
      initialDecisionKind: null,
      initialDecisionReason: null,
    })
    await emitActivityEvent('supply_cases.analysis.completed', {
      operationId,
      kind: 'initial_impact',
      caseId: current.id,
      requiredQuantity: impact.requiredQuantity,
      coveredQuantity: impact.coverageWithStock,
      missingQuantity: impact.shortageAfterStock,
      workflowInstanceId: current.workflowInstanceId,
      occurredAt: new Date().toISOString(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, scope)
    if (impact.shortageAfterStock > 0) {
      await emitActivityEvent('supply_cases.case.risk_detected', {
        caseId: current.id,
        missingQuantity: impact.shortageAfterStock,
        requiredDate: current.requiredDate,
        riskStatus: 'AT_RISK',
        factsHash: analysis.factsHash,
        occurredAt: new Date().toISOString(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }, scope)
    }
    await emitActivityEvent('supply_cases.case.stage_changed', {
      caseId: current.id,
      correlationId: current.correlationId,
      fromStatus: 'ANALYZING_INITIAL_IMPACT',
      toStatus: 'AWAITING_SOURCING_DECISION',
      version: analysis.recordedAt,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      occurredAt: new Date().toISOString(),
    }, scope)
    await signalCaseWorkflow(ctx.container, scope, current.workflowInstanceId, INITIAL_IMPACT_READY_SIGNAL, {
      caseId: current.id,
      proposalId,
      factsHash: analysis.factsHash,
    })
    return {
      status: 'recorded',
      caseId: current.id,
      initialProposalId: proposalId,
      factsHash: analysis.factsHash,
      reason: null,
      selectedOptionId: null,
    }
  },
}

async function emitActivityEvent(event: Parameters<typeof emitSupplyCasesEvent>[0], payload: Record<string, unknown>, scope: StoreScope): Promise<void> {
  try {
    await emitSupplyCasesEvent(event, payload, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
  } catch (error) {
    logger.error('Durable activity event enqueue failed', { event, tenantId: scope.tenantId, organizationId: scope.organizationId })
    getTelemetryRuntime()?.reportError(new Error('[internal] durable activity event enqueue failed'), {
      module: 'supply_cases',
      code: 'activity.event_enqueue_failed',
      attributes: { event, tenantId: scope.tenantId, organizationId: scope.organizationId },
    })
    throw error
  }
}

registerCommand(recordInitialImpactCommand)
export default recordInitialImpactCommand

function resolveInvoker(ctx: CommandRuntimeContext, scope: StoreScope): InitialImpactAdvisorInvoker {
  const userId = ctx.auth?.sub ?? 'system:supply_cases'
  try {
    const factory = ctx.container.resolve<
      (invokerScope: StoreScope, invokerUserId?: string) => InitialImpactAdvisorInvoker
    >('initialImpactAdvisorInvokerFactory')
    if (typeof factory === 'function') return factory(scope, userId)
  } catch {
    return async () => {
      throw new Error('[internal] initial_impact_advisor runtime is unavailable')
    }
  }
  return async () => {
    throw new Error('[internal] initial_impact_advisor runtime is unavailable')
  }
}

function resolveScope(ctx: CommandRuntimeContext, requested: StoreScope | undefined): StoreScope {
  if (ctx.systemActor) {
    if (!requested) throw new CrudHttpError(400, { error: 'scope_required' })
    return requested
  }
  if (requested) throw new CrudHttpError(403, { error: 'scope_not_allowed' })
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: 'organization_scope_required' })
  return { tenantId, organizationId }
}
