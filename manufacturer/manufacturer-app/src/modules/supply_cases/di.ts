import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { SupplyCasesStore } from './data/repositories'
import { createJsonSupplyCasesStore } from './data/json/store'
import { createAgentRuntimeInvoker } from './lib/triage/agentRuntimeInvoker'
import type { InboundTriageInvoker } from './lib/triage/runInboundTriage'

let store: SupplyCasesStore | null = null

/**
 * Single store instance per process: each collection serializes its own writes,
 * so two stores over the same data directory would reintroduce the lost-update
 * race the serialization exists to prevent.
 */
export function getSupplyCasesStore(): SupplyCasesStore {
  if (!store) store = createJsonSupplyCasesStore()
  return store
}

/**
 * Swapping the local JSON backend for the ORM implementation is a change to
 * this factory only — the repository contracts stay the same.
 */
export function register(container: AppContainer) {
  const resolved = getSupplyCasesStore()
  container.register({
    supplyCasesStore: asValue(resolved),
    supplyCaseProductionOrders: asValue(resolved.productionOrders),
    supplyCaseProductionPlans: asValue(resolved.productionPlans),
    supplyCaseRepository: asValue(resolved.supplyCases),
    supplyCaseInboundMessages: asValue(resolved.inboundMessages),
    supplyCaseOutboundCorrelations: asValue(resolved.outboundCorrelations),
    inboundTriageInvokerFactory: asValue(
      (scope: { tenantId: string; organizationId: string }, userId = 'system:supply_cases'): InboundTriageInvoker =>
        createAgentRuntimeInvoker({ container, scope, userId }),
    ),
  })
}
