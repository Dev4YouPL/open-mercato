import { describe, expect, it, jest } from '@jest/globals'

// The runner's ESM runtime dependencies are not needed to build the request object.
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({ runAiAgentObject: jest.fn() }))
import { aiAgents, SUPPLIER_COUNTER_NEGOTIATOR_AGENT_ID, supplierCounterAgentOutputSchema } from '../../../ai-agents'

describe('supplier counter agent contract', () => {
  it('is object-only and toolless', () => {
    const agent = aiAgents.find((candidate) => candidate.id === SUPPLIER_COUNTER_NEGOTIATOR_AGENT_ID)
    expect(agent).toMatchObject({ executionMode: 'object', allowedTools: [], readOnly: true, allowRuntimeOverride: false })
  })

  it('accepts only an existing-option selection shape', () => {
    expect(supplierCounterAgentOutputSchema.safeParse({ optionId: 'requested', decision: 'accept_requested', reasonCodes: ['requested_feasible_within_policy'], rationale: 'Feasible within policy.', confidence: 0.9 }).success).toBe(true)
    // O1: reason codes come from the fixed list, and the rationale is required.
    expect(supplierCounterAgentOutputSchema.safeParse({ optionId: 'requested', decision: 'accept_requested', reasonCodes: ['within_policy'], rationale: 'x', confidence: 0.9 }).success).toBe(false)
    expect(supplierCounterAgentOutputSchema.safeParse({ optionId: 'requested', decision: 'accept_requested', reasonCodes: ['requested_feasible_within_policy'] }).success).toBe(false)
    expect(supplierCounterAgentOutputSchema.safeParse({ optionId: 'invented', decision: 'accept_requested', reasonCodes: [] }).success).toBe(false)
  })
})

describe('supplier counter agent runtime request', () => {
  it('never sends a per-call loop override (the agent forbids it and the runtime rejects the whole call)', async () => {
    const { buildRuntimeRequest } = await import('../runner')
    const request = buildRuntimeRequest({
      serializedInput: '{}',
      config: { provider: 'openrouter', model: 'meta/muse-spark-1.3-contributor', timeoutMs: 20_000, maxRunsPerCase: 4, maxRunsPerDay: 50, maxOutputTokens: 4_000, maxNegotiationTurns: 3 },
      runId: '00000000-0000-4000-8000-000000000001',
      scope: { tenantId: 't', organizationId: 'o' },
      effective: { provider: null, model: null, systemPrompt: null },
    })
    expect(request.loop).toBeUndefined()
    expect(request.enableTools).toBe(false)
    const agent = aiAgents.find((candidate) => candidate.id === SUPPLIER_COUNTER_NEGOTIATOR_AGENT_ID)
    expect(agent?.loop?.allowRuntimeOverride).toBe(false)
  })
})
