import type { AwilixContainer } from 'awilix'
import type { StoreScope } from '../../data/repositories'
import { INBOUND_TRIAGE_AGENT_ID } from '../../ai-agents'
import type { InboundTriageAgentInput } from './triageInput'
import type { InboundTriageInvoker } from './runInboundTriage'

/**
 * Binds the triage port to the real agent runtime.
 *
 * Everything the runtime hands back passes through `runInboundTriage`'s schema
 * check before anything reads it, so this adapter's only job is to unwrap the
 * envelope and refuse the kinds that are not an extraction. The agent is
 * registered as `research`, whose result carries `data` untouched; a
 * `proposal`-shaped answer would mean the registration changed underneath us,
 * and guessing at its contents is exactly how a fabricated correlation would
 * get in.
 *
 * A missing runtime, a missing provider or a model error all surface as a throw
 * and become `AGENT_UNAVAILABLE`, which the apply step quarantines and raises
 * for an operator. Nothing here invents a result to keep the flow moving.
 */

type AgentRuntimeLike = {
  run(
    agentId: string,
    input: unknown,
    ctx: { tenantId: string; organizationId: string; userId: string },
  ): Promise<unknown>
}

export type AgentRuntimeInvokerDeps = {
  container: AwilixContainer
  scope: StoreScope
  /** The actor the run is attributed to. Workflow-originated runs pass the system actor. */
  userId: string
}

export function createAgentRuntimeInvoker(deps: AgentRuntimeInvokerDeps): InboundTriageInvoker {
  return async (input: InboundTriageAgentInput) => {
    const runtime = resolveAgentRuntime(deps.container)
    const result = await runtime.run(INBOUND_TRIAGE_AGENT_ID, input, {
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
      userId: deps.userId,
    })
    return unwrapResearchResult(result)
  }
}

function resolveAgentRuntime(container: AwilixContainer): AgentRuntimeLike {
  try {
    return container.resolve<AgentRuntimeLike>('agentRuntime')
  } catch {
    throw new Error('[internal] agentRuntime is not registered; enable the agent orchestrator module')
  }
}

function unwrapResearchResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    throw new Error('[internal] the agent runtime returned no result')
  }
  const envelope = result as { kind?: unknown; data?: unknown }
  if (envelope.kind !== 'research') {
    throw new Error(`[internal] expected a research result from ${INBOUND_TRIAGE_AGENT_ID}, got ${String(envelope.kind)}`)
  }
  return envelope.data
}
