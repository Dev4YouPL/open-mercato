import { WORK_CENTER_RESOURCE_LIMIT } from './entity-ids'
import { WorkCenterDomainError } from './errors'

/**
 * Canonical membership normalization: trim, de-duplicate, sort.
 *
 * Sorting is what makes `resourceIds` deterministic in responses, audit
 * snapshots and equal-set comparison, so every producer of a membership set
 * goes through here rather than sorting at the edges.
 */
export function normalizeResourceIds(ids: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed.length > 0) unique.add(trimmed)
  }
  return Array.from(unique).sort()
}

/**
 * The 100-member bound is enforced on the normalized set and before any
 * provider lookup or database write, so an oversized request costs no peer
 * query and leaves no partial state.
 */
export function assertMembershipLimit(ids: readonly string[]): void {
  if (ids.length > WORK_CENTER_RESOURCE_LIMIT) {
    throw new WorkCenterDomainError('resource_membership_limit_exceeded', { count: ids.length })
  }
}

export function normalizeAndAssertResourceIds(ids: readonly string[]): string[] {
  const normalized = normalizeResourceIds(ids)
  assertMembershipLimit(normalized)
  return normalized
}

/** Both sides must already be normalized; equality means the update is a membership no-op. */
export function isSameMembership(current: readonly string[], next: readonly string[]): boolean {
  if (current.length !== next.length) return false
  return current.every((id, index) => id === next[index])
}
