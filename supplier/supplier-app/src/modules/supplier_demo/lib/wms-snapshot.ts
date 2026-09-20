import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InventoryBalance, InventoryReservation } from '@open-mercato/core/modules/wms/data/entities'

export type WmsSnapshotScope = {
  tenantId: string
  organizationId: string
}

export type WmsSnapshotInput = WmsSnapshotScope & {
  catalogVariantId: string
  salesOrderId: string
  warehouseIds?: string[]
  now?: Date
}

export type WmsStockSnapshot = {
  takenAt: string
  variantId: string
  reservedForOrder: number
  onHand: number
  available: number
  allocated: number
  warehouses: number
  source: 'wms'
  fingerprint: string
}

function numberValue(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`[internal] WMS snapshot contains an invalid ${field} quantity.`)
  return parsed
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id?: unknown }).id ?? '') || null
  return null
}

function scopedWarehouse(row: { warehouse?: unknown }, warehouseIds: string[] | undefined): boolean {
  if (!warehouseIds?.length) return true
  const warehouseId = relationId(row.warehouse)
  return warehouseId !== null && warehouseIds.includes(warehouseId)
}

export async function readWmsSnapshot(em: EntityManager, input: WmsSnapshotInput): Promise<WmsStockSnapshot> {
  if (!input.tenantId || !input.organizationId || !input.catalogVariantId || !input.salesOrderId) {
    throw new Error('[internal] WMS snapshot requires tenant, organization, variant and sales order scope.')
  }
  const now = input.now ?? new Date()
  const [balances, reservations] = await Promise.all([
    em.find(InventoryBalance, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      catalogVariantId: input.catalogVariantId,
      deletedAt: null,
    }),
    em.find(InventoryReservation, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      catalogVariantId: input.catalogVariantId,
      sourceType: 'order',
      sourceId: input.salesOrderId,
      status: 'active',
      deletedAt: null,
    }),
  ])
  const scopedBalances = balances.filter((balance) => scopedWarehouse(balance, input.warehouseIds))
  const scopedReservations = reservations.filter((reservation) => {
    if (!scopedWarehouse(reservation, input.warehouseIds)) return false
    return !reservation.expiresAt || reservation.expiresAt > now
  })
  const rows = scopedBalances.map((balance) => ({
    id: balance.id,
    warehouseId: relationId(balance.warehouse),
    onHand: numberValue(balance.quantityOnHand, 'onHand'),
    available: numberValue(balance.quantityAvailable ?? Number(balance.quantityOnHand) - Number(balance.quantityReserved) - Number(balance.quantityAllocated), 'available'),
    allocated: numberValue(balance.quantityAllocated, 'allocated'),
  })).sort((left, right) => left.id.localeCompare(right.id))
  const reservationRows = scopedReservations.map((reservation) => ({ id: reservation.id, quantity: numberValue(reservation.quantity, 'reservedForOrder') })).sort((left, right) => left.id.localeCompare(right.id))
  const snapshotValues = {
    variantId: input.catalogVariantId,
    reservedForOrder: reservationRows.reduce((total, row) => total + row.quantity, 0),
    onHand: rows.reduce((total, row) => total + row.onHand, 0),
    available: rows.reduce((total, row) => total + row.available, 0),
    allocated: rows.reduce((total, row) => total + row.allocated, 0),
    warehouses: new Set(rows.map((row) => row.warehouseId).filter((id): id is string => Boolean(id))).size,
    balances: rows,
    reservations: reservationRows,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshotValues)).digest('hex')
  return {
    takenAt: now.toISOString(),
    variantId: input.catalogVariantId,
    reservedForOrder: snapshotValues.reservedForOrder,
    onHand: snapshotValues.onHand,
    available: snapshotValues.available,
    allocated: snapshotValues.allocated,
    warehouses: snapshotValues.warehouses,
    source: 'wms',
    fingerprint,
  }
}

export const readWmsStockSnapshot = readWmsSnapshot
