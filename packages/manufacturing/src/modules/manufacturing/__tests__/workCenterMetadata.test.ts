import features from '../acl'
import setup from '../setup'
import { eventsConfig } from '../events'
import extensionPoints from '../extension-points'
import { WORK_CENTER_ERROR_CODES } from '../lib/work-centers/errors'

const VIEW = 'manufacturing.work_center.view'
const MANAGE = 'manufacturing.work_center.manage'

describe('Work Centre ACL', () => {
  const byId = new Map(features.map((feature) => [feature.id, feature]))

  it('registers exactly view and manage', () => {
    expect(byId.has(VIEW)).toBe(true)
    expect(byId.has(MANAGE)).toBe(true)
  })

  it('does not register execute or reverse — they belong to later flows', () => {
    expect(byId.has('manufacturing.work_center.execute')).toBe(false)
    expect(byId.has('manufacturing.work_center.reverse')).toBe(false)
  })

  it('makes manage depend on view', () => {
    expect((byId.get(MANAGE) as { dependsOn?: string[] }).dependsOn).toEqual([VIEW])
  })

  it('preserves the existing BOM features', () => {
    expect(byId.has('manufacturing.bom.view')).toBe(true)
    expect(byId.has('manufacturing.bom.manage')).toBe(true)
  })
})

describe('Work Centre default role grants', () => {
  it('pins the merged superadmin array', () => {
    expect(setup.defaultRoleFeatures?.superadmin).toEqual([
      'manufacturing.bom.view',
      'manufacturing.bom.manage',
      VIEW,
      MANAGE,
    ])
  })

  it('pins the merged admin array', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual([
      'manufacturing.bom.view',
      'manufacturing.bom.manage',
      VIEW,
      MANAGE,
    ])
  })

  it('grants employees view only, and no resources feature', () => {
    expect(setup.defaultRoleFeatures?.employee).toEqual([VIEW])
  })

  it('never grants a resources feature from Manufacturing', () => {
    const granted = Object.values(setup.defaultRoleFeatures ?? {}).flat()
    expect(granted.some((feature) => feature.startsWith('resources.'))).toBe(false)
  })
})

describe('Work Centre events', () => {
  const ids = eventsConfig.events.map((definition) => definition.id)

  it('declares the three canonical CRUD events', () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        'manufacturing.work_center.created',
        'manufacturing.work_center.updated',
        'manufacturing.work_center.deleted',
      ]),
    )
  })

  it('declares no membership-level public event', () => {
    expect(ids.some((id) => id.includes('work_center_resource'))).toBe(false)
  })

  it('keeps the existing BOM events', () => {
    expect(ids).toEqual(expect.arrayContaining(['manufacturing.bom.created', 'manufacturing.bom.updated']))
  })
})

describe('Work Centre extension hosts', () => {
  it('registers the stable DataTable host id', () => {
    expect(extensionPoints.hosts.workCentersTable.tableId).toBe('manufacturing.work_center')
  })

  it('registers the CrudForm spot id', () => {
    expect(extensionPoints.hosts.workCenterForm.spotId).toBe('crud-form:manufacturing.work_center')
  })

  it('leaves the BOM hosts untouched', () => {
    expect(extensionPoints.hosts.bomsTable.tableId).toBe('manufacturing.bom')
  })
})

describe('Work Centre stable error codes', () => {
  it('publishes the documented code set', () => {
    expect([...WORK_CENTER_ERROR_CODES].sort()).toEqual(
      [
        'optimistic_lock_conflict',
        'optional_provider_unavailable',
        'resource_inactive',
        'resource_lookup_forbidden',
        'resource_membership_limit_exceeded',
        'resource_not_found',
        'work_center_code_conflict',
        'work_center_not_found',
        'work_center_redo_forbidden',
        'work_center_restore_code_conflict',
        'work_center_undo_forbidden',
      ].sort(),
    )
  })

  it('does not pre-publish a consumer-only referenced code', () => {
    expect(WORK_CENTER_ERROR_CODES).not.toContain('work_center_referenced')
  })
})
