import type { AwilixContainer } from 'awilix'
import {
  initialImpactAdvisorInputSchema,
  initialImpactAdvisorResultSchema,
  type InitialImpactAdvisorInput,
  type InitialImpactAdvisorResult,
} from '../../data/initial-impact'
import { INITIAL_IMPACT_ADVISOR_AGENT_ID } from '../triage/agentId'

export type InitialImpactAdvisorInvoker = (input: InitialImpactAdvisorInput) => Promise<unknown>

export type InitialImpactAdvisorRunResult =
  | { ok: true; result: InitialImpactAdvisorResult }
  | { ok: false; reason: 'AGENT_UNAVAILABLE' | 'SCHEMA_INVALID' | 'FACTS_HASH_MISMATCH'; issues: string[] }

export async function runInitialImpactAdvisor(
  input: InitialImpactAdvisorInput,
  invoke: InitialImpactAdvisorInvoker,
): Promise<InitialImpactAdvisorRunResult> {
  const validInput = initialImpactAdvisorInputSchema.safeParse(input)
  if (!validInput.success) return { ok: false, reason: 'SCHEMA_INVALID', issues: validInput.error.issues.map(formatIssue) }
  let raw: unknown
  try {
    raw = await invoke(validInput.data)
  } catch (error) {
    return { ok: false, reason: 'AGENT_UNAVAILABLE', issues: [error instanceof Error ? error.message : String(error)] }
  }
  const unwrapped = unwrapResearchResult(raw)
  const parsed = initialImpactAdvisorResultSchema.safeParse(unwrapped)
  if (!parsed.success) return { ok: false, reason: 'SCHEMA_INVALID', issues: parsed.error.issues.map(formatIssue) }
  if (parsed.data.factsHash !== validInput.data.factsHash) {
    return { ok: false, reason: 'FACTS_HASH_MISMATCH', issues: ['factsHash'] }
  }
  const ids = new Set(parsed.data.optionAssessments.map((assessment) => assessment.optionId))
  if (ids.size !== 3) return { ok: false, reason: 'SCHEMA_INVALID', issues: ['optionAssessments.optionId'] }
  const allowedEvidence = new Set<string>([
    'impact.requiredQuantity',
    'impact.requiredDate',
    'impact.onTimePrimaryQuantity',
    'impact.latePrimaryQuantity',
    'impact.shortageWithoutStock',
    'impact.coverageWithoutStock',
    'impact.coverageWithStock',
    'impact.customerDeadlineStatus',
    'impact.latestSafeDecisionAt',
    'option.ACCEPT_PRIMARY_DELAY',
    'option.USE_INTERNAL_STOCK',
    'option.CHECK_ALTERNATIVE_SUPPLIER',
  ])
  if (parsed.data.optionAssessments.some((assessment) => assessment.evidenceRefs.some((ref) => !allowedEvidence.has(ref)))) {
    return { ok: false, reason: 'SCHEMA_INVALID', issues: ['optionAssessments.evidenceRefs'] }
  }
  const recommendedOption = parsed.data.recommendedOptionId
    ? validInput.data.options.find((option) => option.id === parsed.data.recommendedOptionId)
    : null
  return {
    ok: true,
    result: {
      ...parsed.data,
      recommendedOptionId: recommendedOption?.feasibility === 'INFEASIBLE' ? null : parsed.data.recommendedOptionId,
    },
  }
}

export function createInitialImpactAdvisorInvoker(deps: {
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string }
  userId: string
}): InitialImpactAdvisorInvoker {
  return async (input) => {
    const runtime = deps.container.resolve<{
      run(agentId: string, input: unknown, ctx: { tenantId: string; organizationId: string; userId: string }): Promise<unknown>
    }>('agentRuntime')
    return runtime.run(INITIAL_IMPACT_ADVISOR_AGENT_ID, input, {
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
      userId: deps.userId,
    })
  }
}

function unwrapResearchResult(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const envelope = raw as { kind?: unknown; data?: unknown }
  return envelope.kind === 'research' ? envelope.data : raw
}

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.join('.') || '<root>'}: ${issue.message}`
}
