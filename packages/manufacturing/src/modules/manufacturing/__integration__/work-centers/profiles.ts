export const workCenterProfiles = {
  full: { enabled: ['catalog', 'manufacturing', 'resources', 'planner'], omitted: [] },
  'no-resources': { enabled: ['catalog', 'manufacturing', 'planner'], omitted: ['resources', 'staff'] },
  'no-planner': { enabled: ['catalog', 'manufacturing'], omitted: ['resources', 'planner', 'staff'] },
  'manufacturing-off': { enabled: ['catalog'], omitted: ['manufacturing'] },
} as const

export type WorkCenterProfile = keyof typeof workCenterProfiles

type ModuleEntry = { id: string; from?: string }

export function createWorkCenterProfileManifest(baseline: readonly ModuleEntry[], profile: WorkCenterProfile): ModuleEntry[] {
  const configuration = workCenterProfiles[profile]
  const omitted = new Set<string>(configuration.omitted)
  const entries = baseline.filter((entry) => !omitted.has(entry.id)).map((entry) => ({ ...entry }))
  for (const moduleId of configuration.enabled) {
    if (!entries.some((entry) => entry.id === moduleId)) {
      entries.push({ id: moduleId, from: moduleId === 'manufacturing' ? '@open-mercato/manufacturing' : '@open-mercato/core' })
    }
  }
  assertWorkCenterProfileManifest(entries, profile)
  return entries
}

export function assertWorkCenterProfileManifest(entries: readonly ModuleEntry[], profile: WorkCenterProfile): void {
  const ids = new Set(entries.map((entry) => entry.id))
  if (ids.has('resources') && !ids.has('planner')) throw new Error('[internal] resources requires planner')
  if (ids.has('staff') && (!ids.has('resources') || !ids.has('planner'))) throw new Error('[internal] staff requires resources and planner')
  for (const moduleId of workCenterProfiles[profile].enabled) {
    if (!ids.has(moduleId)) throw new Error(`[internal] profile ${profile} requires ${moduleId}`)
  }
  for (const moduleId of workCenterProfiles[profile].omitted) {
    if (ids.has(moduleId)) throw new Error(`[internal] profile ${profile} must omit ${moduleId}`)
  }
}
