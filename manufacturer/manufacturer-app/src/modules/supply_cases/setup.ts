import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { FIXTURE_CORRELATION_ID } from './data/fixtures'
import { getSupplyCasesStore } from './di'

export const setup: ModuleSetupConfig = {
  /**
   * Seeds the Manufacturer A demo scenario into the local JSON store. Guarded by
   * a lookup rather than `resetScenario` so re-running init never discards a case
   * someone is part-way through.
   */
  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const store = getSupplyCasesStore()
    const existing = await store.supplyCases.findByCorrelationId(scope, FIXTURE_CORRELATION_ID)
    if (existing) return
    await store.seedScenario(scope)
  },

  defaultRoleFeatures: {
    admin: ['supply_cases.*'],
  },
}

export default setup
