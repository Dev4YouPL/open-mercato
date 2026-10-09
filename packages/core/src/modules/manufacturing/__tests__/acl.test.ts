/** @jest-environment node */

import { hasAllFeatures, hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as manufacturingFeatures } from '../acl'
import { setup } from '../setup'
import {
  CORRECTION_RECORD_FEATURES,
  EXECUTION_RECORD_FEATURES,
  MANUFACTURING_WMS_REQUIRED_FEATURES,
} from '../lib/accessControl'
import { features as wmsFeatures } from '../../wms/acl'

const manufacturingDescriptors: FeatureDescriptor[] = manufacturingFeatures
const resolvedCatalog: FeatureDescriptor[] = [...manufacturingDescriptors, ...wmsFeatures]

const areas = ['execution', 'corrections'] as const

function findFeature(id: string): FeatureDescriptor | undefined {
  return manufacturingDescriptors.find((feature) => feature.id === id)
}

describe('manufacturing execution and corrections ACL', () => {
  it.each(areas)('declares view and manage levels for the %s area', (area) => {
    expect(findFeature(`manufacturing.${area}.view`)).toBeDefined()
    expect(findFeature(`manufacturing.${area}.manage`)).toBeDefined()
  })

  it.each(areas)('makes %s manage depend on its own view and every required WMS feature', (area) => {
    expect([...(findFeature(`manufacturing.${area}.manage`)?.dependsOn ?? [])].sort()).toEqual(
      [`manufacturing.${area}.view`, ...MANUFACTURING_WMS_REQUIRED_FEATURES].sort(),
    )
  })

  it('keeps every manufacturing area independent of the other manufacturing areas', () => {
    for (const feature of manufacturingDescriptors) {
      const areaPrefix = feature.id.split('.').slice(0, -1).join('.')
      const foreignManufacturingDeps = (feature.dependsOn ?? []).filter(
        (dependency) => dependency.startsWith('manufacturing.') && !dependency.startsWith(`${areaPrefix}.`),
      )
      expect({ feature: feature.id, foreignManufacturingDeps }).toEqual({ feature: feature.id, foreignManufacturingDeps: [] })
    }
  })

  it('declares dependsOn only against features registered in manufacturing or WMS', () => {
    const granted = resolvedCatalog.map((feature) => feature.id)
    const diagnostics = resolveAclDependencyDiagnostics(granted, resolvedCatalog)
    expect(diagnostics.unknownReferences).toEqual([])
    expect(diagnostics.missingDependencies).toEqual([])
  })

  it('flags missing WMS features when manage is granted without them', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['manufacturing.execution.view', 'manufacturing.execution.manage', 'wms.view'],
      resolvedCatalog,
    )
    expect(diagnostics.missingDependencies).toEqual([
      { feature: 'manufacturing.execution.manage', missing: ['wms.adjust_inventory', 'wms.receive_inventory'] },
    ])
  })

  it.each([
    ['execution', EXECUTION_RECORD_FEATURES],
    ['corrections', CORRECTION_RECORD_FEATURES],
  ] as const)('requires %s manage together with all WMS features to record', (area, recordFeatures) => {
    const fullGrant = [`manufacturing.${area}.manage`, ...MANUFACTURING_WMS_REQUIRED_FEATURES]
    expect(hasAllFeatures(fullGrant, recordFeatures)).toBe(true)

    for (const missing of fullGrant) {
      const partialGrant = fullGrant.filter((feature) => feature !== missing)
      expect({ missing, allowed: hasAllFeatures(partialGrant, recordFeatures) }).toEqual({ missing, allowed: false })
    }
  })

  it('does not let execution manage satisfy corrections and vice versa', () => {
    const executionGrant = ['manufacturing.execution.manage', ...MANUFACTURING_WMS_REQUIRED_FEATURES]
    const correctionGrant = ['manufacturing.corrections.manage', ...MANUFACTURING_WMS_REQUIRED_FEATURES]
    expect(hasAllFeatures(executionGrant, CORRECTION_RECORD_FEATURES)).toBe(false)
    expect(hasAllFeatures(correctionGrant, EXECUTION_RECORD_FEATURES)).toBe(false)
  })

  it('grants every declared feature to at least one default role', () => {
    const roleGrants = Object.values(setup.defaultRoleFeatures ?? {})
    for (const feature of manufacturingDescriptors) {
      expect({ feature: feature.id, granted: roleGrants.some((grants) => hasFeature(grants, feature.id)) }).toEqual({
        feature: feature.id,
        granted: true,
      })
    }
  })
})
