import { aiAgents } from '../ai-agents'

const ORCHESTRATOR_PROVIDER = 'openrouter'
const ORCHESTRATOR_MODEL = 'meta/muse-spark-1.3-contributor'

describe('agent orchestrator model policy', () => {
  it('pins every module-owned agent to OpenRouter Muse Spark Contributor', () => {
    expect(aiAgents.length).toBeGreaterThan(0)

    for (const agent of aiAgents) {
      expect(agent.moduleId).toBe('agent_orchestrator')
      expect(agent.defaultProvider).toBe(ORCHESTRATOR_PROVIDER)
      expect(agent.defaultModel).toBe(ORCHESTRATOR_MODEL)
      expect(agent.allowRuntimeOverride).toBe(false)
    }
  })
})
