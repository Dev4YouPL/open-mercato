import { describe, expect, it } from '@jest/globals'
import { buildSupplierAiExposureInventory } from '../exposure'

describe('supplier AI exposure inventory', () => {
  it('records generic chat/object/MCP surfaces and the Q-206 live gate', () => {
    const inventory = buildSupplierAiExposureInventory()
    expect(inventory.enabledModules).toContain('ai_assistant')
    expect(inventory.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/ai_assistant/ai/chat', mode: 'chat' }),
      expect.objectContaining({ path: '/api/ai_assistant/ai/run-object', mode: 'object' }),
    ]))
    expect(inventory.supplierAgent).toBe('registered_toolless_object_only')
    expect(inventory.q206).toBe('pending_before_live_rollout')
  })
})
