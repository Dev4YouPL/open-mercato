import { z } from 'zod'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { SortDir, type QueryEngine, type Where } from '@open-mercato/shared/lib/query/types'
import type { ManufacturingScope } from '../../domain/manufacturingScope'
import type {
  InventoryLocationDto,
  InventoryLocationFilter,
  InventoryPolicyReader,
  TrackingPolicyDto,
  TrackingPolicyResultDto,
} from '../../ports/inventoryPolicyReader'

export const WMS_MODULE_ID = 'wms'
export const WMS_INVENTORY_PROFILE_ENTITY_ID = 'wms:product_inventory_profile'
export const WMS_WAREHOUSE_LOCATION_ENTITY_ID = 'wms:warehouse_location'
export const WMS_LOCATION_PAGE_SIZE = 100

const NO_TRACKING: TrackingPolicyDto = { tracksLot: false, tracksSerial: false, tracksExpiry: false }

const inventoryProfileRowSchema = z.object({
  track_lot: z.boolean(),
  track_serial: z.boolean(),
  track_expiration: z.boolean(),
})

const warehouseLocationRowSchema = z.object({
  id: z.string(),
  warehouse_id: z.string(),
  code: z.string(),
  type: z.string(),
})

type WmsPolicyReaderDeps = {
  queryEngine: QueryEngine
  isWmsEnabled: () => boolean
}

function isWmsModuleEnabled(): boolean {
  const modules = tryGetModules()

  return modules === null || modules.some((module) => module.id === WMS_MODULE_ID)
}

function parseWmsRow<TSchema extends z.ZodTypeAny>(schema: TSchema, entityId: string, row: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    throw new Error(`[internal] ${entityId} row does not match the shape Manufacturing expects`, { cause: parsed.error })
  }

  return parsed.data
}

function toTrackingPolicy(row: unknown): TrackingPolicyDto {
  const profile = parseWmsRow(inventoryProfileRowSchema, WMS_INVENTORY_PROFILE_ENTITY_ID, row)

  return { tracksLot: profile.track_lot, tracksSerial: profile.track_serial, tracksExpiry: profile.track_expiration }
}

function toLocation(row: unknown): InventoryLocationDto {
  const location = parseWmsRow(warehouseLocationRowSchema, WMS_WAREHOUSE_LOCATION_ENTITY_ID, row)
  
  return { id: location.id, warehouseId: location.warehouse_id, code: location.code, type: location.type }
}

async function readTrackingPolicy(
  deps: WmsPolicyReaderDeps,
  variantId: string,
  scope: ManufacturingScope,
): Promise<TrackingPolicyResultDto> {

  if (!deps.isWmsEnabled()) return { status: 'unavailable' }
  
  const result = await deps.queryEngine.query<unknown>(WMS_INVENTORY_PROFILE_ENTITY_ID, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { catalog_variant_id: { $eq: variantId } },
    fields: ['track_lot', 'track_serial', 'track_expiration'],
    page: { page: 1, pageSize: 1 },
  })
  
  const profile = result.items[0]
  
  return { status: 'resolved', policy: profile ? toTrackingPolicy(profile) : NO_TRACKING }
}

async function readActiveLocations(
  deps: WmsPolicyReaderDeps,
  scope: ManufacturingScope,
  filter: InventoryLocationFilter,
): Promise<InventoryLocationDto[]> {
  if (!deps.isWmsEnabled()) return []

  const filters: Where = { is_active: { $eq: true } }
  
  if (filter.warehouseId) filters.warehouse_id = { $eq: filter.warehouseId }
  
  const locations: InventoryLocationDto[] = []
  
  let page = 1
  let lastPageSize = WMS_LOCATION_PAGE_SIZE
  
  while (lastPageSize === WMS_LOCATION_PAGE_SIZE) {
    const result = await deps.queryEngine.query<unknown>(WMS_WAREHOUSE_LOCATION_ENTITY_ID, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      filters,
      fields: ['id', 'warehouse_id', 'code', 'type'],
      sort: [{ field: 'code', dir: SortDir.Asc }],
      page: { page, pageSize: WMS_LOCATION_PAGE_SIZE },
    })
    
    locations.push(...result.items.map(toLocation))
    
    lastPageSize = result.items.length
    
    page += 1
  }
  
  return locations
}

export function createWmsInventoryPolicyReader(options: {
  queryEngine: QueryEngine
  isWmsEnabled?: () => boolean
}): InventoryPolicyReader {
  const deps: WmsPolicyReaderDeps = {
    queryEngine: options.queryEngine,
    isWmsEnabled: options.isWmsEnabled ?? isWmsModuleEnabled,
  }
  
  return {
    getTrackingPolicy: (variantId, scope) => readTrackingPolicy(deps, variantId, scope),
    listActiveLocations: (scope, filter = {}) => readActiveLocations(deps, scope, filter),
  }
}
