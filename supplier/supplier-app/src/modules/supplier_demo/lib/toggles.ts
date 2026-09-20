export const supplierDemoToggleId = 'supplier_demo_auto_supply_proposal'
export const supplierDemoReplyToggleId = 'supplier_demo_auto_supply_reply'
export const supplierDemoNegotiationToggleId = 'supplier_demo_auto_negotiation'
export const supplierDemoFreeformUnderstandingToggleId = 'supplier_demo_freeform_understanding'
export const supplierDemoFreeformAutoShadowToggleId = 'supplier_demo_freeform_auto_shadow'
export const supplierDemoFreeformAutoNegotiationToggleId = 'supplier_demo_freeform_auto_negotiation'

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

export async function isFreeformUnderstandingEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoFreeformUnderstandingToggleId, tenantId)
    return result.ok && result.value === true
  } catch {
    return false
  }
}

// Shadow mode is the safety default: it stays on unless the toggle explicitly resolves to false. A missing toggle
// row (a tenant that never ran setup) or a service failure must never silently enable automatic sending.
export async function isFreeformAutoShadowEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoFreeformAutoShadowToggleId, tenantId)
    return result.ok ? result.value !== false : true
  } catch {
    return true
  }
}

export async function isFreeformAutoNegotiationEnabled(container: { resolve: (name: string) => unknown }, tenantId: string): Promise<boolean> {
  try {
    const service = container.resolve('featureTogglesService') as FeatureToggleService
    const result = await service.getBoolConfig(supplierDemoFreeformAutoNegotiationToggleId, tenantId)
    return result.ok && result.value === true
  } catch {
    return false
  }
}
