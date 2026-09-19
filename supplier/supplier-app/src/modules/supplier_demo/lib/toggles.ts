export const supplierDemoToggleId = 'supplier_demo_auto_supply_proposal'
export const supplierDemoReplyToggleId = 'supplier_demo_auto_supply_reply'
export const supplierDemoNegotiationToggleId = 'supplier_demo_auto_negotiation'

type FeatureToggleService = {
  getBoolConfig: (identifier: string, tenantId: string) => Promise<{ ok: boolean; value?: boolean }>
}

export async function isAutoSupplyProposalEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoToggleId, tenantId)
    return result.ok && result.value === true
  } catch {
    return false
  }
}

export async function isAutoSupplyReplyEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoReplyToggleId, tenantId)
    return result.ok && result.value === true
  } catch {
    return false
  }
}

export async function isAutoNegotiationEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoNegotiationToggleId, tenantId)
    return result.ok && result.value === true
  } catch {
    return false
  }
}
