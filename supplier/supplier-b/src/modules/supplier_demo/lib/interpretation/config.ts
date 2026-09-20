import type { EntityManager } from '@mikro-orm/postgresql'
import { AiAgentPromptOverride, AiAgentRuntimeOverride, AiTenantModelAllowlist } from '@open-mercato/ai-assistant/modules/ai_assistant/data/entities'

export const interpreterConfigKeys = {
  provider: 'OM_AI_SUPPLIER_DEMO_INTERPRETER_PROVIDER',
  model: 'OM_AI_SUPPLIER_DEMO_INTERPRETER_MODEL',
  timeoutMs: 'SUPPLIER_DEMO_INTERPRETER_TIMEOUT_MS',
  maxAttemptsPerCase: 'SUPPLIER_DEMO_INTERPRETER_MAX_ATTEMPTS_PER_CASE',
  maxAttemptsPerDay: 'SUPPLIER_DEMO_INTERPRETER_MAX_ATTEMPTS_PER_DAY',
  maxOutputTokens: 'SUPPLIER_DEMO_INTERPRETER_MAX_OUTPUT_TOKENS',
} as const

export type ReplyInterpreterConfig = {
  provider: string
  model: string
  timeoutMs: number
  maxAttemptsPerCase: number
  maxAttemptsPerDay: number
  maxOutputTokens: number
}

export type ReplyInterpreterConfigResult =
  | { ok: true; config: ReplyInterpreterConfig }
  | { ok: false; issues: Array<{ key: string; code: 'required' | 'integer' | 'bounds' }> }

type Env = Record<string, string | undefined>

function boundedInteger(env: Env, key: string, defaultValue: number, minimum: number, maximum: number) {
  const raw = env[key]?.trim()
  if (!raw) return { value: defaultValue, issue: null }
  if (!/^\d+$/.test(raw)) return { value: null, issue: { key, code: 'integer' as const } }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return { value: null, issue: { key, code: 'integer' as const } }
  if (value < minimum || value > maximum) return { value: null, issue: { key, code: 'bounds' as const } }
  return { value, issue: null }
}

export function parseReplyInterpreterConfig(env: Env = process.env): ReplyInterpreterConfigResult {
  // The interpreter defaults to the orchestrator's configured provider/model. A missing configuration is a
  // structured failure, never a guessed model: an unconfigured runtime must not reach an unintended provider.
  const provider = env[interpreterConfigKeys.provider]?.trim() || env.OM_AI_SUPPLIER_DEMO_PROVIDER?.trim() || ''
  const model = env[interpreterConfigKeys.model]?.trim() || env.OM_AI_SUPPLIER_DEMO_MODEL?.trim() || ''
  // Measured live: gpt-4o-mini answers in ~8 s, the reasoning-heavy meta/muse-spark in ~38 s, so 15 s aborted
  // healthy calls. 45 s covers both and still leaves the case bounded.
  const timeoutMs = boundedInteger(env, interpreterConfigKeys.timeoutMs, 45_000, 1_000, 60_000)
  const maxAttemptsPerCase = boundedInteger(env, interpreterConfigKeys.maxAttemptsPerCase, 3, 1, 10)
  const maxAttemptsPerDay = boundedInteger(env, interpreterConfigKeys.maxAttemptsPerDay, 30, 1, 1_000)
  // Same budget as the counter agent: at 1500 the model spent the cap before emitting the object and the call came
  // back as "no object generated".
  const maxOutputTokens = boundedInteger(env, interpreterConfigKeys.maxOutputTokens, 4_000, 100, 8_000)
  const issues = [
    ...(provider ? [] : [{ key: interpreterConfigKeys.provider, code: 'required' as const }]),
    ...(model ? [] : [{ key: interpreterConfigKeys.model, code: 'required' as const }]),
    timeoutMs.issue,
    maxAttemptsPerCase.issue,
    maxAttemptsPerDay.issue,
    maxOutputTokens.issue,
  ].filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    config: {
      provider,
      model,
      timeoutMs: timeoutMs.value!,
      maxAttemptsPerCase: maxAttemptsPerCase.value!,
      maxAttemptsPerDay: maxAttemptsPerDay.value!,
      maxOutputTokens: maxOutputTokens.value!,
    },
  }
}

export async function hasReplyInterpreterOverride(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  try {
    const [agentRuntimeOverride, tenantRuntimeOverride, promptOverride] = await Promise.all([
      em.findOne(AiAgentRuntimeOverride, { ...scope, agentId: 'supplier_demo.reply_interpreter', deletedAt: null }),
      em.findOne(AiAgentRuntimeOverride, { ...scope, agentId: null, deletedAt: null }),
      em.findOne(AiAgentPromptOverride, { ...scope, agentId: 'supplier_demo.reply_interpreter' }),
    ])
    return Boolean(agentRuntimeOverride || tenantRuntimeOverride || promptOverride)
  } catch {
    return false
  }
}

export async function isReplyInterpreterModelAllowed(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  config: Pick<ReplyInterpreterConfig, 'provider' | 'model'>,
): Promise<boolean> {
  try {
    const allowlist = await em.findOne(AiTenantModelAllowlist, { ...scope, deletedAt: null })
    if (!allowlist) return true
    const providerAllowed = !allowlist.allowedProviders || allowlist.allowedProviders.includes(config.provider)
    const modelAllowlist = allowlist.allowedModelsByProvider?.[config.provider]
    return providerAllowed && (!modelAllowlist || modelAllowlist.includes(config.model))
  } catch {
    return false
  }
}
