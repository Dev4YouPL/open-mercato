import { buildBomDeletionVersion } from '../bomDeletionQueries'

describe('BOM deletion version', () => {
  const revision = { id: 'BOM-ID', updatedAt: new Date('2026-01-01T00:00:00.000Z') }
  const item = { id: 'ITEM-ID', updatedAt: new Date('2026-01-02T00:00:00.000Z') }

  it('is stable across input ordering and includes active item versions', () => {
    const expected = buildBomDeletionVersion([revision], new Map([[revision.id, [item]]]))
    expect(expected).toMatch(/^v1:[0-9a-f]{64}$/)
    expect(buildBomDeletionVersion([revision], new Map([[revision.id, [item]]]))).toBe(expected)
    expect(buildBomDeletionVersion([revision], new Map([[revision.id, [{ ...item, updatedAt: new Date('2026-01-03T00:00:00.000Z') }]]]))).not.toBe(expected)
  })

  it('changes when the selected revision set changes', () => {
    const one = buildBomDeletionVersion([revision], new Map())
    const two = buildBomDeletionVersion([revision, { id: 'other', updatedAt: revision.updatedAt }], new Map())
    expect(one).not.toBe(two)
  })
})
