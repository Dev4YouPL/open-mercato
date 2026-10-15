/** @jest-environment node */

import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import {
  createWmsInventoryPolicyReader,
  WMS_INVENTORY_PROFILE_ENTITY_ID,
  WMS_LOCATION_PAGE_SIZE,
  WMS_WAREHOUSE_LOCATION_ENTITY_ID,
} from '../wmsInventoryPolicyReader'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

type QueryCall = [string, QueryOptions | undefined]

function resultOf(items: unknown[]): QueryResult<unknown> {
  return { items, page: 1, pageSize: items.length, total: items.length }
}

function buildReader(pages: unknown[][], isWmsEnabled = () => true) {
  const remaining = [...pages]
  const query = jest.fn(async (..._args: QueryCall) => resultOf(remaining.shift() ?? []))
  const queryEngine = { query } as unknown as QueryEngine
  return { reader: createWmsInventoryPolicyReader({ queryEngine, isWmsEnabled }), query }
}

function locationRow(index: number) {
  return { id: `location-${index}`, warehouse_id: 'warehouse-1', code: `A-${index}`, type: 'bin' }
}

describe('WMS inventory policy reader', () => {
  it('reads the profile of exactly the given variant within the scope', async () => {
    const { reader, query } = buildReader([[{ track_lot: false, track_serial: false, track_expiration: false }]])
    await reader.getTrackingPolicy('variant-1', scope)

    const [entityId, options] = query.mock.calls[0]
    expect(entityId).toBe(WMS_INVENTORY_PROFILE_ENTITY_ID)
    expect(options).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      filters: { catalog_variant_id: { $eq: 'variant-1' } },
    })
  })

  it('maps the WMS profile flags to the tracking policy', async () => {
    const { reader } = buildReader([[{ track_lot: true, track_serial: false, track_expiration: true }]])

    expect(await reader.getTrackingPolicy('variant-1', scope)).toEqual({
      status: 'resolved',
      policy: { tracksLot: true, tracksSerial: false, tracksExpiry: true },
    })
  })

  it('treats a variant without a profile as untracked', async () => {
    const { reader } = buildReader([[]])

    expect(await reader.getTrackingPolicy('variant-1', scope)).toEqual({
      status: 'resolved',
      policy: { tracksLot: false, tracksSerial: false, tracksExpiry: false },
    })
  })

  it('reports the policy as unavailable without querying when WMS is disabled', async () => {
    const { reader, query } = buildReader([], () => false)

    expect(await reader.getTrackingPolicy('variant-1', scope)).toEqual({ status: 'unavailable' })
    expect(query).not.toHaveBeenCalled()
  })

  it('lists only active locations, optionally narrowed to one warehouse', async () => {
    const { reader, query } = buildReader([[locationRow(1)], [locationRow(2)]])

    await reader.listActiveLocations(scope)
    await reader.listActiveLocations(scope, { warehouseId: 'warehouse-1' })

    expect(query.mock.calls[0][0]).toBe(WMS_WAREHOUSE_LOCATION_ENTITY_ID)
    expect(query.mock.calls[0][1]?.filters).toEqual({ is_active: { $eq: true } })
    expect(query.mock.calls[1][1]?.filters).toEqual({ is_active: { $eq: true }, warehouse_id: { $eq: 'warehouse-1' } })
  })

  it('maps location rows', async () => {
    const { reader } = buildReader([[locationRow(1)]])

    expect(await reader.listActiveLocations(scope)).toEqual([
      { id: 'location-1', warehouseId: 'warehouse-1', code: 'A-1', type: 'bin' },
    ])
  })

  it('fails loudly when a WMS location row no longer matches the expected shape', async () => {
    const { reader } = buildReader([[locationRow(1), { id: 'location-2', location_code: 'X' }]])

    await expect(reader.listActiveLocations(scope)).rejects.toThrow(`[internal] ${WMS_WAREHOUSE_LOCATION_ENTITY_ID}`)
  })

  it('fails loudly instead of treating a variant as untracked when the WMS profile shape changes', async () => {
    const { reader } = buildReader([[{ lot_tracking: true, track_serial: false, track_expiration: false }]])

    await expect(reader.getTrackingPolicy('variant-1', scope)).rejects.toThrow(`[internal] ${WMS_INVENTORY_PROFILE_ENTITY_ID}`)
  })

  it('reads every page of locations', async () => {
    const fullPage = Array.from({ length: WMS_LOCATION_PAGE_SIZE }, (_unused, index) => locationRow(index))
    const { reader, query } = buildReader([fullPage, [locationRow(1000)]])

    const locations = await reader.listActiveLocations(scope)

    expect(locations).toHaveLength(WMS_LOCATION_PAGE_SIZE + 1)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][1]?.page).toEqual({ page: 2, pageSize: WMS_LOCATION_PAGE_SIZE })
  })

  it('returns no locations without querying when WMS is disabled', async () => {
    const { reader, query } = buildReader([], () => false)

    expect(await reader.listActiveLocations(scope)).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })
})
