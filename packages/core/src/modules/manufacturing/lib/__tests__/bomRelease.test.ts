import {
  collectReleaseVariantIds,
  findTrackingViolations,
  hasReleaseItemsChanged,
  isIncompleteRelease,
} from '../bomRelease'

import type { TrackingPolicy } from '../wmsTrackingPolicy'

const outputVariantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const componentVariantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const firstItemId = '11111111-1111-4111-8111-111111111111'
const secondItemId = '22222222-2222-4222-8222-222222222222'

const timestamp = '2026-10-08T13:00:00.000Z'

describe('collectReleaseVariantIds', () => {
  it('collects the output and unique component variants', () => {
    expect(collectReleaseVariantIds(
      { outputVariantId },
      [
        { componentVariantId },
        { componentVariantId },
        { componentVariantId: outputVariantId.toUpperCase() },
      ],
    )).toEqual([
      outputVariantId,
      componentVariantId,
    ])
  })

  it('includes the output variant for an empty BOM', () => {
    expect(collectReleaseVariantIds(
      { outputVariantId },
      [],
    )).toEqual([outputVariantId])
  })
})

describe('findTrackingViolations', () => {
  const variants = [
    {
      id: outputVariantId,
      name: 'Finished product',
      sku: 'OUTPUT-01',
    },
    {
      id: componentVariantId,
      name: 'Component',
      sku: 'COMP-01',
    },
  ]

  it('returns no violations when profiles are absent', () => {
    expect(findTrackingViolations(
      variants,
      new Map(),
      outputVariantId,
    )).toEqual([])
  })

  it('reports output and component requirements', () => {
    const policies = new Map<string, TrackingPolicy>([
      [
        outputVariantId,
        {
          requiresLot: true,
          requiresSerial: false,
          requiresExpiration: true,
        },
      ],
      [
        componentVariantId,
        {
          requiresLot: false,
          requiresSerial: true,
          requiresExpiration: false,
        },
      ],
    ])

    expect(findTrackingViolations(
      variants,
      policies,
      outputVariantId.toUpperCase(),
    )).toEqual([
      {
        variantId: outputVariantId,
        role: 'output',
        name: 'Finished product',
        sku: 'OUTPUT-01',
        requirements: ['lot', 'expiration'],
      },
      {
        variantId: componentVariantId,
        role: 'component',
        name: 'Component',
        sku: 'COMP-01',
        requirements: ['serial'],
      },
    ])
  })

  it('ignores profiles without tracking requirements', () => {
    const policies = new Map<string, TrackingPolicy>([
      [
        outputVariantId,
        {
          requiresLot: false,
          requiresSerial: false,
          requiresExpiration: false,
        },
      ],
    ])

    expect(findTrackingViolations(
      variants,
      policies,
      outputVariantId,
    )).toEqual([])
  })
})

describe('isIncompleteRelease', () => {
  it('marks an empty BOM as incomplete', () => {
    expect(isIncompleteRelease([])).toBe(true)
  })

  it('does not mark a BOM with items as incomplete', () => {
    expect(isIncompleteRelease([
      { id: firstItemId },
    ])).toBe(false)
  })
})

describe('hasReleaseItemsChanged', () => {
  const expectedItems = [
    { id: firstItemId, updatedAt: timestamp },
    { id: secondItemId, updatedAt: timestamp },
  ]

  const activeItems = [
    { id: firstItemId, updatedAt: new Date(timestamp) },
    { id: secondItemId, updatedAt: new Date(timestamp) },
  ]

  it('accepts two empty item sets', () => {
    expect(hasReleaseItemsChanged([], [])).toBe(false)
  })

  it('accepts unchanged items regardless of order', () => {
    expect(hasReleaseItemsChanged(
      expectedItems,
      [...activeItems].reverse(),
    )).toBe(false)
  })

  it('compares timestamps as instants rather than strings', () => {
    expect(hasReleaseItemsChanged(
      [{
        id: firstItemId,
        updatedAt: '2026-10-08T15:00:00+02:00',
      }],
      [activeItems[0]],
    )).toBe(false)
  })

  it('detects an added item', () => {
    expect(hasReleaseItemsChanged(
      [expectedItems[0]],
      activeItems,
    )).toBe(true)
  })

  it('detects a deleted item', () => {
    expect(hasReleaseItemsChanged(
      expectedItems,
      [activeItems[0]],
    )).toBe(true)
  })

  it('detects a replaced item even when counts match', () => {
    expect(hasReleaseItemsChanged(
      [expectedItems[0]],
      [activeItems[1]],
    )).toBe(true)
  })

  it('detects an updated item version', () => {
    expect(hasReleaseItemsChanged(
      [expectedItems[0]],
      [{
        id: firstItemId,
        updatedAt: new Date('2026-10-08T13:00:00.001Z'),
      }],
    )).toBe(true)
  })

  it('rejects duplicate expected item IDs', () => {
    expect(hasReleaseItemsChanged(
      [expectedItems[0], expectedItems[0]],
      activeItems,
    )).toBe(true)
  })

  it('rejects duplicate active item IDs', () => {
    expect(hasReleaseItemsChanged(
      expectedItems,
      [activeItems[0], activeItems[0]],
    )).toBe(true)
  })
})