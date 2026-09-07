import { assertWorkCenterProfileManifest, createWorkCenterProfileManifest, workCenterProfiles, type WorkCenterProfile } from '../profiles'

const baseline = ['auth', 'directory', 'query_index', 'audit_logs', 'catalog', 'planner', 'resources', 'staff'].map((id) => ({ id, from: '@open-mercato/core' }))

describe('Work Centre isolated profile manifests', () => {
  it.each(Object.keys(workCenterProfiles) as WorkCenterProfile[])('preserves framework modules in %s', (profile) => {
    const entries = createWorkCenterProfileManifest(baseline, profile)
    expect(entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(['auth', 'directory', 'query_index', 'audit_logs', 'catalog']))
    expect(() => assertWorkCenterProfileManifest(entries, profile)).not.toThrow()
    expect(baseline.map((entry) => entry.id)).not.toContain('manufacturing')
  })

  it.each(['no-resources', 'no-planner'] as const)('omits dependent staff in %s', (profile) => {
    expect(createWorkCenterProfileManifest(baseline, profile).map((entry) => entry.id)).not.toContain('staff')
  })

  it('rejects resources enabled without planner', () => {
    expect(() => assertWorkCenterProfileManifest(baseline.filter((entry) => entry.id !== 'planner'), 'full')).toThrow('resources requires planner')
  })

  it('removes an existing manufacturing entry for the disabled profile', () => {
    const entries = createWorkCenterProfileManifest([...baseline, { id: 'manufacturing', from: '@open-mercato/manufacturing' }], 'manufacturing-off')
    expect(entries.map((entry) => entry.id)).not.toContain('manufacturing')
  })
})
