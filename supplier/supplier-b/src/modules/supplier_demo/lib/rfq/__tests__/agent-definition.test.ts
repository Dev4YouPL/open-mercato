import { describe, expect, it } from '@jest/globals'
import { aiAgents, SUPPLIER_RFQ_INTERPRETER_AGENT_ID, supplierRfqInterpretationSchema } from '../../../ai-agents'

describe('RFQ interpreter agent definition', () => {
  it('pins the new RFQ agent to the requested model and keeps it toolless', () => {
    const agent = aiAgents.find((candidate) => candidate.id === SUPPLIER_RFQ_INTERPRETER_AGENT_ID)
    expect(agent).toBeDefined()
    expect(agent?.defaultProvider).toBe('openrouter')
    expect(agent?.defaultModel).toBe('openai/gpt-4o-mini')
    expect(agent?.allowedTools).toEqual([])
    expect(agent?.mutationPolicy).toBe('read-only')
    expect(agent?.output?.schema).toBe(supplierRfqInterpretationSchema)
  })
})
