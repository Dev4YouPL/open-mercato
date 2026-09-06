import { addEdge, detectCycle, type DirectedGraphEdges } from '../graph'

describe('cycle detection', () => {
  it('reports no cycle for an acyclic graph', () => {
    const edges: DirectedGraphEdges = new Map()
    addEdge(edges, 'a', 'b')
    addEdge(edges, 'b', 'c')
    expect(detectCycle(edges)).toEqual({ cyclic: false })
  })

  it('detects a direct self-reference', () => {
    const edges: DirectedGraphEdges = new Map()
    addEdge(edges, 'a', 'a')
    expect(detectCycle(edges)).toEqual({ cyclic: true, path: ['a', 'a'] })
  })

  it('detects an indirect cycle', () => {
    const edges: DirectedGraphEdges = new Map()
    addEdge(edges, 'a', 'b')
    addEdge(edges, 'b', 'c')
    addEdge(edges, 'c', 'a')
    const result = detectCycle(edges)
    expect(result.cyclic).toBe(true)
    if (result.cyclic) {
      expect(result.path[0]).toBe(result.path[result.path.length - 1])
      expect(new Set(result.path.slice(0, -1))).toEqual(new Set(['a', 'b', 'c']))
    }
  })

  it('does not flag repeated occurrences sharing the same edge as a cycle', () => {
    const edges: DirectedGraphEdges = new Map()
    addEdge(edges, 'a', 'b')
    addEdge(edges, 'a', 'b')
    expect(detectCycle(edges)).toEqual({ cyclic: false })
  })
})
