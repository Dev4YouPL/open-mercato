import type { EntityManager } from '@mikro-orm/postgresql'
import { AiAgentPromptOverride, AiAgentRuntimeOverride, AiTenantModelAllowlist } from '@open-mercato/ai-assistant/modules/ai_assistant/data/entities'

export const supplierAgentConfigKeys = {
  provider: 'OM_AI_SUPPLIER_DEMO_PROVIDER',
  model: 'OM_AI_SUPPLIER_DEMO_MODEL',
  timeoutMs: 'SUPPLIER_DEMO_AGENT_TIMEOUT_MS',
  maxRunsPerCase: 'SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_CASE',
  maxRunsPerDay: 'SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_DAY',
  maxOutputTokens: 'SUPPLIER_DEMO_AGENT_MAX_OUTPUT_TOKENS',
  maxNegotiationTurns: 'SUPPLIER_DEMO_MAX_NEGOTIATION_TURNS',
} as const

export type SupplierAgentConfig = {
  provider: string
  model: string
  timeoutMs: number
  maxRunsPerCase: number
  maxRunsPerDay: number
  maxOutputTokens: number
  maxNegotiationTurns: number
}

export type SupplierAgentConfigIssue = {
  key: string
  code: 'required' | 'integer' | 'bounds'
}

export type SupplierAgentConfigResult =
  | { ok: true; config: SupplierAgentConfig }
  | { ok: false; issues: SupplierAgentConfigIssue[] }

export type SupplierAgentPreflightCheck = {
  id: string
  status: 'pass' | 'fail' | 'pending'
}

export type SupplierAgentPreflightResult = {
  checks: SupplierAgentPreflightCheck[]
  failed: boolean
}

export type SupplierAgentAiState = {
  schemaPresent: boolean
  runtimeOverridePresent: boolean
  allowlistCompatible: boolean
}

type Env = Record<string, string | undefined>

const requiredValue = (env: Env, key: string): string | null => {
  const value = env[key]?.trim()
  return value ? value : null
}

function boundedInteger(
  env: Env,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): { value: number | null; issue: SupplierAgentConfigIssue | null } {
  const raw = env[key]?.trim()
  if (!raw) return { value: defaultValue, issue: null }
  if (!/^\d+$/.test(raw)) return { value: null, issue: { key, code: 'integer' } }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return { value: null, issue: { key, code: 'integer' } }
  if (value < minimum || value > maximum) return { value: null, issue: { key, code: 'bounds' } }
  return { value, issue: null }
}

export function parseSupplierAgentConfig(env: Env = process.env): SupplierAgentConfigResult {
  const issues: SupplierAgentConfigIssue[] = []
  const provider = requiredValue(env, supplierAgentConfigKeys.provider)
  const model = requiredValue(env, supplierAgentConfigKeys.model)
  if (!provider) issues.push({ key: supplierAgentConfigKeys.provider, code: 'required' })
  if (!model) issues.push({ key: supplierAgentConfigKeys.model, code: 'required' })

  const timeoutMs = boundedInteger(env, supplierAgentConfigKeys.timeoutMs, 20_000, 1_000, 60_000)
  const maxRunsPerCase = boundedInteger(env, supplierAgentConfigKeys.maxRunsPerCase, 4, 1, 10)
  const maxRunsPerDay = boundedInteger(env, supplierAgentConfigKeys.maxRunsPerDay, 50, 1, 1_000)
  const maxOutputTokens = boundedInteger(env, supplierAgentConfigKeys.maxOutputTokens, 4_000, 500, 32_000)
  const maxNegotiationTurns = boundedInteger(env, supplierAgentConfigKeys.maxNegotiationTurns, 3, 1, 3)
  for (const parsed of [timeoutMs, maxRunsPerCase, maxRunsPerDay, maxOutputTokens, maxNegotiationTurns]) {
    if (parsed.issue) issues.push(parsed.issue)
  }

  if (issues.length || !provider || !model || timeoutMs.value === null || maxRunsPerCase.value === null || maxRunsPerDay.value === null || maxOutputTokens.value === null || maxNegotiationTurns.value === null) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    config: {
      provider,
      model,
      timeoutMs: timeoutMs.value,
      maxRunsPerCase: maxRunsPerCase.value,
      maxRunsPerDay: maxRunsPerDay.value,
      maxOutputTokens: maxOutputTokens.value,
      maxNegotiationTurns: maxNegotiationTurns.value,
    },
  }
}

export function buildSupplierAgentOfflinePreflight(input: {
  env?: Env
  enabledModules: ReadonlyArray<string>
  scopePresent: boolean
  schedulerPresent: boolean
  schemaPresent?: boolean
  runtimeOverridePresent: boolean
  allowlistCompatible?: boolean
}): SupplierAgentPreflightResult {
  const config = parseSupplierAgentConfig(input.env)
  const checks: SupplierAgentPreflightCheck[] = [
    { id: 'config', status: config.ok ? 'pass' : 'fail' },
    { id: 'module.ai_assistant', status: input.enabledModules.includes('ai_assistant') ? 'pass' : 'fail' },
    { id: 'module.scheduler', status: input.enabledModules.includes('scheduler') && input.schedulerPresent ? 'pass' : 'fail' },
    { id: 'schema.ai_assistant', status: input.schemaPresent === undefined ? 'pending' : input.schemaPresent ? 'pass' : 'fail' },
    { id: 'principal.scope', status: input.scopePresent ? 'pass' : 'fail' },
    { id: 'runtime_override.supplier_demo.counter_negotiator', status: input.runtimeOverridePresent ? 'fail' : 'pass' },
    { id: 'model_allowlist', status: input.allowlistCompatible === undefined ? 'pending' : input.allowlistCompatible ? 'pass' : 'fail' },
    { id: 'agent_schema', status: 'pass' },
    { id: 'provider_network', status: 'pass' },
  ]
  return { checks, failed: checks.some((check) => check.status === 'fail') }
}

export async function inspectSupplierAgentAiState(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  config: Pick<SupplierAgentConfig, 'provider' | 'model'>,
  agentId = 'supplier_demo.counter_negotiator',
): Promise<SupplierAgentAiState> {
  try {
    await em.count(AiAgentRuntimeOverride, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
    await em.count(AiTenantModelAllowlist, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
    await em.count(AiAgentPromptOverride, { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId })
  } catch {
    return { schemaPresent: false, runtimeOverridePresent: false, allowlistCompatible: false }
  }

  const [agentRuntimeOverride, tenantRuntimeOverride, agentPromptOverride, allowlist] = await Promise.all([
    em.findOne(AiAgentRuntimeOverride, { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId, deletedAt: null }),
    em.findOne(AiAgentRuntimeOverride, { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: null, deletedAt: null }),
    em.findOne(AiAgentPromptOverride, { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId }),
    em.findOne(AiTenantModelAllowlist, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }),
  ])
  const providerAllowed = !allowlist?.allowedProviders || allowlist.allowedProviders.includes(config.provider)
  const modelAllowlist = allowlist?.allowedModelsByProvider?.[config.provider]
  const modelAllowed = !modelAllowlist || modelAllowlist.includes(config.model)
  return {
    schemaPresent: true,
    runtimeOverridePresent: Boolean(agentRuntimeOverride || tenantRuntimeOverride || agentPromptOverride),
    allowlistCompatible: providerAllowed && modelAllowed,
  }
}
