export const supplierDemoToggleId = 'supplier_demo_auto_supply_proposal'

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
