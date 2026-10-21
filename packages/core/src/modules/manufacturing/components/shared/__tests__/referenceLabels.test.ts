/** @jest-environment node */

import { referenceIdsQuery, toLocationLabels, toOptions, toVariantLabels } from '../referenceLabels'

describe('reference labels', () => {
  it('labels variants by name and SKU, falling back to whichever exists', () => {
    expect(
      toVariantLabels({
        items: [
          { id: 'variant-1', name: 'Oak table', sku: 'TBL-OAK' },
          { id: 'variant-2', name: null, sku: 'TBL-PINE' },
          { id: 'variant-3', name: 'Chair', sku: 'Chair' },
          { id: 'variant-4', name: null, sku: null },
        ],
      }),
    ).toEqual({ 'variant-1': 'Oak table (TBL-OAK)', 'variant-2': 'TBL-PINE', 'variant-3': 'Chair', 'variant-4': 'variant-4' })
  })

  it('labels locations by warehouse and code', () => {
    expect(
      toLocationLabels({
        items: [
          { id: 'location-1', code: 'A-1', warehouse_code: 'WH1' },
          { id: 'location-2', code: 'B-1', warehouse_code: null, warehouse_name: 'Main' },
          { id: 'location-3', code: null },
        ],
      }),
    ).toEqual({ 'location-1': 'WH1 / A-1', 'location-2': 'Main / B-1', 'location-3': 'location-3' })
  })

  it('tolerates unexpected responses and builds options and id queries', () => {
    expect(toVariantLabels({ error: 'forbidden' })).toEqual({})
    expect(toLocationLabels(undefined)).toEqual({})
    expect(toOptions({ a: 'A' })).toEqual([{ value: 'a', label: 'A' }])
    expect(referenceIdsQuery(['a', 'b'])).toBe('ids=a%2Cb&pageSize=100')
  })
})
