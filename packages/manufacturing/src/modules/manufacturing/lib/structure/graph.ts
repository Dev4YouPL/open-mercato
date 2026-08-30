export type DirectedGraphEdges = Map<string, Set<string>>

export type CycleDetectionResult =
  | { cyclic: false }
  | { cyclic: true; path: string[] }

const WHITE = 0
const GRAY = 1
const BLACK = 2

/**
 * Deterministic tri-color DFS over a directed graph. Detects any cycle
 * reachable from the graph's nodes, independent of insertion order, and
 * reports the exact path (including the closing repeated node) so callers
 * can surface which occurrences form the cycle.
 */
export function detectCycle(edges: DirectedGraphEdges): CycleDetectionResult {
  const color = new Map<string, number>()
  const nodes = Array.from(edges.keys()).sort()

  for (const start of nodes) {
    if (color.get(start) === BLACK) continue
    const stack: { node: string; iterator: IterableIterator<string> }[] = []
    const path: string[] = []

    color.set(start, GRAY)
    path.push(start)
    stack.push({ node: start, iterator: (edges.get(start) ?? new Set()).values() })

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const next = frame.iterator.next()
      if (next.done) {
        color.set(frame.node, BLACK)
        path.pop()
        stack.pop()
        continue
      }
      const child = next.value
      const childColor = color.get(child) ?? WHITE
      if (childColor === GRAY) {
        return { cyclic: true, path: [...path, child] }
      }
      if (childColor === BLACK) continue
      color.set(child, GRAY)
      path.push(child)
      stack.push({ node: child, iterator: (edges.get(child) ?? new Set()).values() })
    }
  }

  return { cyclic: false }
}

export function addEdge(edges: DirectedGraphEdges, from: string, to: string): void {
  const existing = edges.get(from)
  if (existing) {
    existing.add(to)
    return
  }
  edges.set(from, new Set([to]))
}

export function cloneEdges(edges: DirectedGraphEdges): DirectedGraphEdges {
  const clone: DirectedGraphEdges = new Map()
  for (const [from, targets] of edges) clone.set(from, new Set(targets))
  return clone
}
