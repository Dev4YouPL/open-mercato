import { enabledModules } from '../../../../modules'

export type SupplierAiExposureInventory = {
  enabledModules: string[]
  routes: Array<{ path: string; mode: 'chat' | 'object' | 'mcp'; feature: string }>
  supplierAgent: 'registered_toolless_object_only'
  objectRouteRestriction: 'generic_ai_assistant_view_only'
  q206: 'pending_before_live_rollout'
}

export function buildSupplierAiExposureInventory(): SupplierAiExposureInventory {
  return {
    enabledModules: enabledModules.map((entry) => entry.id),
    routes: [
      { path: '/api/ai_assistant/ai/chat', mode: 'chat', feature: 'ai_assistant.view' },
      { path: '/api/ai_assistant/ai/run-object', mode: 'object', feature: 'ai_assistant.view' },
      { path: 'OpenCode/MCP server', mode: 'mcp', feature: 'session-auth + per-tool ACL' },
    ],
    supplierAgent: 'registered_toolless_object_only',
    objectRouteRestriction: 'generic_ai_assistant_view_only',
    q206: 'pending_before_live_rollout',
  }
}
