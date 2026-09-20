import { describe, expect, it, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { buildSupplierAgentOfflinePreflight, inspectSupplierAgentAiState, parseSupplierAgentConfig } from '../config'

const validEnv = {
  OM_AI_SUPPLIER_DEMO_PROVIDER: 'openrouter',
  OM_AI_SUPPLIER_DEMO_MODEL: 'meta/muse-spark-1.3-contributor',
}

describe('supplier agent configuration', () => {
  it('uses bounded defaults without exposing secret fields', () => {
    const result = parseSupplierAgentConfig(validEnv)
    expect(result).toEqual({
      ok: true,
      config: {
        provider: 'openrouter',
        model: 'meta/muse-spark-1.3-contributor',
        timeoutMs: 20_000,
        maxRunsPerCase: 4,
        maxRunsPerDay: 50,
        maxOutputTokens: 4_000,
        maxNegotiationTurns: 3,
      },
    })
  })

  it('rejects missing required provider/model values', () => {
    const result = parseSupplierAgentConfig({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      { key: 'OM_AI_SUPPLIER_DEMO_PROVIDER', code: 'required' },
      { key: 'OM_AI_SUPPLIER_DEMO_MODEL', code: 'required' },
    ])
  })

  it('rejects malformed and out-of-range numeric configuration', () => {
    const result = parseSupplierAgentConfig({
      ...validEnv,
      SUPPLIER_DEMO_AGENT_TIMEOUT_MS: '999',
      SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_CASE: 'many',
      SUPPLIER_DEMO_AGENT_MAX_OUTPUT_TOKENS: '33000',
      SUPPLIER_DEMO_MAX_NEGOTIATION_TURNS: '4',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      { key: 'SUPPLIER_DEMO_AGENT_TIMEOUT_MS', code: 'bounds' },
      { key: 'SUPPLIER_DEMO_AGENT_MAX_RUNS_PER_CASE', code: 'integer' },
      { key: 'SUPPLIER_DEMO_AGENT_MAX_OUTPUT_TOKENS', code: 'bounds' },
      { key: 'SUPPLIER_DEMO_MAX_NEGOTIATION_TURNS', code: 'bounds' },
    ])
  })

  it('keeps unverified database seams pending instead of claiming a pass', () => {
    const result = buildSupplierAgentOfflinePreflight({
      env: validEnv,
      enabledModules: ['ai_assistant', 'scheduler'],
      scopePresent: true,
      schedulerPresent: true,
      runtimeOverridePresent: false,
    })
    expect(result.failed).toBe(false)
    expect(result.checks).toEqual(expect.arrayContaining([
      { id: 'schema.ai_assistant', status: 'pending' },
      { id: 'model_allowlist', status: 'pending' },
      { id: 'provider_network', status: 'pass' },
    ]))
  })

  it('keeps AI state inspection tenant-scoped and rejects applicable overrides', async () => {
    const rows = new Map<string, unknown>([
      ['runtime', null],
      ['allowlist', { allowedProviders: ['openrouter'], allowedModelsByProvider: { openrouter: ['meta/muse-spark-1.3-contributor'] } }],
      ['prompt', { agentId: 'supplier_demo.counter_negotiator' }],
    ])
    const count = jest.fn(async (..._args: unknown[]) => 0)
    const findOne = jest.fn(async (entity: unknown) => {
        const name = typeof entity === 'function' && entity.name.includes('Runtime')
          ? 'runtime'
          : typeof entity === 'function' && entity.name.includes('Allowlist') ? 'allowlist' : 'prompt'
        return rows.get(name) ?? null
      })
    const em = { count, findOne } as unknown as EntityManager

    const result = await inspectSupplierAgentAiState(em, { tenantId: 'tenant-1', organizationId: 'org-1' }, { provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor' })
    expect(result).toEqual({ schemaPresent: true, runtimeOverridePresent: true, allowlistCompatible: true })
    expect(count).toHaveBeenCalledTimes(3)
    expect(findOne).toHaveBeenCalledTimes(4)
  })
})
