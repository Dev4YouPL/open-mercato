/**
 * Every existing-draft mutation advances the revision/family aggregate
 * timestamp to max(now, previous + 1ms) so two writes serialized by the
 * graph/row locks can never expose the same optimistic-lock token.
 */
export function nextMonotonicTimestamp(previous: Date | null | undefined): Date {
  const now = new Date()
  if (!previous) return now
  const incremented = new Date(previous.getTime() + 1)
  return incremented.getTime() > now.getTime() ? incremented : now
}
