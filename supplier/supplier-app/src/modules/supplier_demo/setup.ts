import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  CatalogProduct,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { resolveStatusEntryIdByValue } from '@open-mercato/core/modules/sales/lib/statusHelpers'
import {
  InventoryBalance,
  Warehouse,
  WarehouseLocation,
} from '@open-mercato/core/modules/wms/data/entities'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SupplierProductionSlot } from './data/entities'

const PRODUCT_NAME = 'Stalowa rama'
const PRODUCT_SKU = 'MAT-42'
const PRODUCT_HANDLE = 'stalowa-rama'
const PRODUCT_UNIT = 'pc'
const TARGET_AVAILABLE_QUANTITY = 1000
const DEMO_WAREHOUSE_CODE = 'SUPPLIER-DEMO'
const DEMO_WAREHOUSE_NAME = 'Supplier Demo Warehouse'
const DEMO_LOCATION_CODE = 'STOCK'
const SYSTEM_ACTOR_ID = '9f6eb96f-b5a1-4df0-9608-1d46426ecf63'
const AUTO_SUPPLY_PROPOSAL_TOGGLE = 'supplier_demo_auto_supply_proposal'
const AUTO_SUPPLY_REPLY_TOGGLE = 'supplier_demo_auto_supply_reply'
const AUTO_NEGOTIATION_TOGGLE = 'supplier_demo_auto_negotiation'
const logger = createLogger('supplier_demo').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

type SeedScope = {
  tenantId: string
  organizationId: string
}

type WarehouseCreateResult = {
  warehouseId: string
}

type LocationCreateResult = {
  locationId: string
}

type CustomerCreateResult = { entityId: string }
type OrderCreateResult = { orderId: string }

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

async function ensureCounterRecoverySchedule(
  container: { resolve: (name: string) => unknown; hasRegistration?: (name: string) => boolean },
  scope: SeedScope,
): Promise<void> {
  if (typeof container.hasRegistration !== 'function' || !container.hasRegistration('schedulerService')) return
  try {
    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    await schedulerService.register({
      id: stableScheduleUuid(`supplier_demo:counter-recovery:${scope.tenantId}:${scope.organizationId}`),
      name: 'Supplier Demo counter negotiation recovery',
      description: 'Recover stale supplier counter negotiation attempts and replay missed agent dispatches.',
      scopeType: 'organization',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      scheduleType: 'interval',
      scheduleValue: '1m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'supplier-demo-counter-recovery',
      targetPayload: scope,
      sourceType: 'module',
      sourceModule: 'supplier_demo',
      isEnabled: true,
    })
  } catch (error) {
    logger.warn('Failed to register supplier counter recovery schedule', { err: error })
  }
}

function nextWednesday(): Date {
  const date = new Date()
  const daysUntilWednesday = (3 - date.getDay() + 7) % 7 || 7
  date.setDate(date.getDate() + daysUntilWednesday)
  date.setHours(12, 0, 0, 0)
  return date
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function calculateStockAdjustment(currentAvailableQuantity: number): number {
  return TARGET_AVAILABLE_QUANTITY - currentAvailableQuantity
}

export function chooseDemoOrderNumber(
  baseOrderNumber: string,
  existingOrderNumbers: string[],
  activeOrderNumbers: string[],
): string {
  const activeDemoOrder = activeOrderNumbers.find((orderNumber) => orderNumber === baseOrderNumber || orderNumber.startsWith(`${baseOrderNumber}-`))
  if (activeDemoOrder) return activeDemoOrder
  if (!existingOrderNumbers.includes(baseOrderNumber)) return baseOrderNumber

  let suffix = 1
  while (existingOrderNumbers.includes(`${baseOrderNumber}-${suffix}`)) suffix += 1
  return `${baseOrderNumber}-${suffix}`
}

// Tenant encryption maps are copied into `encryption_maps` only when a tenant is created, so a tenant that
// existed before supplier_demo was enabled has no rows and encrypted fields would be stored in plaintext.
// Lazy-imported, mirroring the core configs upgrade actions that backfill maps for pre-existing tenants.
export async function ensureSupplierDemoEncryptionMaps(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
): Promise<void> {
  const [{ default: supplierDemoEncryptionMaps }, { upsertEncryptionMapSpecs }] = await Promise.all([
    import('./encryption'),
    import('@open-mercato/core/modules/entities/cli'),
  ])
  await upsertEncryptionMapSpecs(em, tenantId, organizationId, supplierDemoEncryptionMaps)
}

export async function ensureAutoSupplyProposalToggle(em: EntityManager): Promise<void> {
  const existing = await em.findOne(FeatureToggle, { identifier: AUTO_SUPPLY_PROPOSAL_TOGGLE })
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null
      existing.updatedAt = new Date()
      await em.flush()
    }
    return
  }

  em.persist(em.create(FeatureToggle, {
    identifier: AUTO_SUPPLY_PROPOSAL_TOGGLE,
    name: 'Supplier Demo automatic supply proposal',
    description: 'Enables automatic supply case proposal e-mails for the supplier demo.',
    category: 'supplier_demo',
    type: 'boolean',
    defaultValue: true,
  }))
  await em.flush()
}

export async function ensureAutoSupplyReplyToggle(em: EntityManager): Promise<void> {
  const existing = await em.findOne(FeatureToggle, { identifier: AUTO_SUPPLY_REPLY_TOGGLE })
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null
      existing.updatedAt = new Date()
      await em.flush()
    }
    return
  }
  em.persist(em.create(FeatureToggle, {
    identifier: AUTO_SUPPLY_REPLY_TOGGLE,
    name: 'Supplier Demo automatic supply reply',
    description: 'Enables automatic acceptance application and commitment confirmations for the supplier demo.',
    category: 'supplier_demo',
    type: 'boolean',
    defaultValue: true,
  }))
  await em.flush()
}

export async function ensureAutoNegotiationToggle(em: EntityManager): Promise<void> {
  const existing = await em.findOne(FeatureToggle, { identifier: AUTO_NEGOTIATION_TOGGLE })
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null
      existing.updatedAt = new Date()
      await em.flush()
    }
    return
  }
  em.persist(em.create(FeatureToggle, {
    identifier: AUTO_NEGOTIATION_TOGGLE,
    name: 'Supplier Demo automatic counter negotiation',
    description: 'Enables Supplier counter-proposal evaluation and automatic negotiation attempts.',
    category: 'supplier_demo',
    type: 'boolean',
    defaultValue: true,
  }))
  await em.flush()
}

function buildCommandContext(
  container: CommandRuntimeContext['container'],
  scope: SeedScope,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

async function ensureProduct(
  em: EntityManager,
  scope: SeedScope,
): Promise<{ product: CatalogProduct; variant: CatalogProductVariant }> {
  const now = new Date()
  let product = await em.findOne(CatalogProduct, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sku: PRODUCT_SKU,
  })

  if (!product) {
    product = em.create(CatalogProduct, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      handle: PRODUCT_HANDLE,
      productType: 'simple',
      defaultUnit: PRODUCT_UNIT,
      defaultSalesUnit: PRODUCT_UNIT,
      defaultSalesUnitQuantity: '1',
      isConfigurable: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(product)
  } else {
    product.title = PRODUCT_NAME
    product.handle = PRODUCT_HANDLE
    product.productType = 'simple'
    product.defaultUnit = PRODUCT_UNIT
    product.defaultSalesUnit = PRODUCT_UNIT
    product.defaultSalesUnitQuantity = '1'
    product.isConfigurable = false
    product.isActive = true
    product.deletedAt = null
    product.updatedAt = now
  }

  let variant = await em.findOne(CatalogProductVariant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sku: PRODUCT_SKU,
  })

  if (!variant) {
    variant = em.create(CatalogProductVariant, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      product,
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(variant)
  } else {
    variant.product = product
    variant.name = PRODUCT_NAME
    variant.isDefault = true
    variant.isActive = true
    variant.deletedAt = null
    variant.updatedAt = now
  }

  await em.flush()
  return { product, variant }
}

async function ensureWarehouse(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  scope: SeedScope,
): Promise<Warehouse> {
  const activeWarehouse = await em.findOne(
    Warehouse,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { isPrimary: 'desc', createdAt: 'asc' } },
  )
  if (activeWarehouse) return activeWarehouse

  const execution = await commandBus.execute<Record<string, unknown>, WarehouseCreateResult>(
    'wms.warehouses.create',
    {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: DEMO_WAREHOUSE_NAME,
        code: DEMO_WAREHOUSE_CODE,
        isActive: true,
        isPrimary: true,
        metadata: { source: 'supplier_demo_seed' },
      },
      ctx: commandContext,
    },
  )
  const warehouse = await em.findOne(Warehouse, {
    id: execution.result.warehouseId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!warehouse) throw new Error('[internal] Supplier demo warehouse was not created.')
  return warehouse
}

async function ensureLocation(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  scope: SeedScope,
  warehouse: Warehouse,
): Promise<WarehouseLocation> {
  const activeLocation = await em.findOne(
    WarehouseLocation,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      warehouse,
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )
  if (activeLocation) return activeLocation

  const execution = await commandBus.execute<Record<string, unknown>, LocationCreateResult>(
    'wms.locations.create',
    {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        warehouseId: warehouse.id,
        code: DEMO_LOCATION_CODE,
        type: 'bin',
        isActive: true,
        metadata: { source: 'supplier_demo_seed' },
      },
      ctx: commandContext,
    },
  )
  const location = await em.findOne(WarehouseLocation, {
    id: execution.result.locationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!location) throw new Error('[internal] Supplier demo warehouse location was not created.')
  return location
}

async function reconcileStock(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  scope: SeedScope,
  variant: CatalogProductVariant,
  warehouse: Warehouse,
  location: WarehouseLocation,
): Promise<void> {
  const balance = await em.findOne(InventoryBalance, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    warehouse,
    location,
    catalogVariantId: variant.id,
    lot: null,
    serialNumber: null,
    deletedAt: null,
  })
  const currentAvailableQuantity = balance
    ? Number(balance.quantityOnHand) - Number(balance.quantityReserved) - Number(balance.quantityAllocated)
    : 0
  const delta = calculateStockAdjustment(currentAvailableQuantity)
  if (Math.abs(delta) < 0.000001) return

  await commandBus.execute('wms.inventory.adjust', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      warehouseId: warehouse.id,
      locationId: location.id,
      catalogVariantId: variant.id,
      delta,
      reason: 'Supplier demo stock reconciliation',
      reasonCode: 'supplier_demo_seed',
      referenceType: 'manual',
      referenceId: randomUUID(),
      performedBy: SYSTEM_ACTOR_ID,
      metadata: {
        source: 'supplier_demo_seed',
        targetAvailableQuantity: TARGET_AVAILABLE_QUANTITY,
      },
    },
    ctx: commandContext,
  })
}

async function ensureManufacturer(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  scope: SeedScope,
): Promise<{ id: string; displayName: string; primaryEmail: string }> {
  const primaryEmail = process.env.SUPPLIER_DEMO_PARTNER_EMAILS?.split(',')[0]?.trim() || 'manufacturer-a@example.test'
  const customers = await findWithDecryption(em, CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
  const manufacturerRows = customers.filter((customer) => customer.displayName === 'Manufacturer A')
  const existing = manufacturerRows[0]
  for (const duplicate of manufacturerRows.slice(1)) duplicate.deletedAt = new Date()
  if (existing) {
    if (existing.primaryEmail !== primaryEmail) {
      existing.primaryEmail = primaryEmail
    }
    if (existing.updatedAt) existing.updatedAt = new Date()
    await em.flush()
    return { id: existing.id, displayName: existing.displayName, primaryEmail }
  }
  const execution = await commandBus.execute<Record<string, unknown>, CustomerCreateResult>('customers.companies.create', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      displayName: 'Manufacturer A',
      primaryEmail,
      source: 'supplier_demo_seed',
      isActive: true,
    },
    ctx: commandContext,
  })
  return { id: execution.result.entityId, displayName: 'Manufacturer A', primaryEmail }
}

async function ensureDemoOrder(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  scope: SeedScope,
  manufacturer: { id: string; displayName: string; primaryEmail: string },
  variant: CatalogProductVariant,
  baseOrderNumber: string,
  quantity: number,
  expectedDeliveryAt: Date,
): Promise<SalesOrder> {
  const existingOrders = await findWithDecryption(em, SalesOrder, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    orderNumber: { $like: `${baseOrderNumber}%` },
  }, { orderBy: { createdAt: 'desc' } }, scope)
  const activeOrders = existingOrders.filter((order) => !order.deletedAt && !['canceled', 'cancelled'].includes(order.status ?? ''))
  const draftStatusEntryId = await resolveStatusEntryIdByValue(em, { ...scope, value: 'draft' })
  if (!draftStatusEntryId) throw new Error('[internal] Supplier demo draft sales order status is not configured.')
  const activeOrder = activeOrders[0]
  if (activeOrder) {
    const customerSnapshot = {
      customer: {
        id: manufacturer.id,
        displayName: manufacturer.displayName,
        primaryEmail: manufacturer.primaryEmail,
      },
    }
    if (
      activeOrder.statusEntryId !== draftStatusEntryId
      || activeOrder.status !== 'draft'
      || activeOrder.customerEntityId !== manufacturer.id
      || JSON.stringify(activeOrder.customerSnapshot) !== JSON.stringify(customerSnapshot)
    ) {
      await commandBus.execute('sales.orders.update', {
        input: {
          id: activeOrder.id,
          statusEntryId: draftStatusEntryId,
          customerEntityId: manufacturer.id,
          customerSnapshot,
        },
        ctx: commandContext,
      })
    }
    return activeOrder
  }
  const orderNumber = chooseDemoOrderNumber(
    baseOrderNumber,
    existingOrders.map((order) => order.orderNumber),
    activeOrders.map((order) => order.orderNumber),
  )
  const execution = await commandBus.execute<Record<string, unknown>, OrderCreateResult>('sales.orders.create', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      orderNumber,
      customerEntityId: manufacturer.id,
      statusEntryId: draftStatusEntryId,
      customerSnapshot: {
        customer: {
          id: manufacturer.id,
          displayName: manufacturer.displayName,
          primaryEmail: manufacturer.primaryEmail,
        },
      },
      currencyCode: 'PLN',
      expectedDeliveryAt,
      metadata: { source: 'supplier_demo_seed' },
      lines: [{
        kind: 'product',
        productVariantId: variant.id,
        name: variant.name,
        quantity,
        quantityUnit: PRODUCT_UNIT,
        currencyCode: 'PLN',
        unitPriceNet: 1,
        taxRate: 0,
        uomSnapshot: {
          version: 1,
          productId: variant.product.id,
          productVariantId: variant.id,
          baseUnitCode: PRODUCT_UNIT,
          enteredUnitCode: PRODUCT_UNIT,
          enteredQuantity: String(quantity),
          toBaseFactor: '1',
          normalizedQuantity: String(quantity),
          rounding: { mode: 'half_up', scale: 6 },
          source: { conversionId: null, resolvedAt: new Date().toISOString() },
          unitPriceReference: {
            enabled: true,
            referenceUnitCode: PRODUCT_UNIT,
            baseQuantity: '1',
            netPerReference: '1',
            grossPerReference: '1',
          },
        },
      }],
    },
    ctx: commandContext,
  })
  const order = await findOneWithDecryption(em, SalesOrder, {
    id: execution.result.orderId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }, undefined, scope)
  if (!order) throw new Error('[internal] Supplier demo sales order was not created.')
  return order
}

export async function ensureDemoProductionSlots(
  em: EntityManager,
  scope: SeedScope,
  variant: CatalogProductVariant,
  expectedDeliveryAt: Date,
  order442Number: string,
  priority: 'normal' | 'high' = 'normal',
): Promise<void> {
  for (const [days, capacity] of [[0, 450], [2, 400], [3, 100]] as const) {
    const startsAt = addDays(expectedDeliveryAt, days)
    const existing = await em.findOne(SupplierProductionSlot, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      catalogVariantId: variant.id,
      startsAt,
      deletedAt: null,
    })
    const allocations = days === 0
      ? [
          {
            orderNumber: order442Number,
            quantity: 300,
            priority,
            slaDueAt: addDays(expectedDeliveryAt, 2).toISOString(),
            shiftableHours: 4,
            shiftCostPerHour: 30,
          },
          {
            orderNumber: 'SO-443',
            quantity: 50,
            priority: 'high' as const,
            slaDueAt: addDays(expectedDeliveryAt, 2).toISOString(),
            shiftableHours: 6,
            shiftCostPerHour: 30,
          },
        ]
      : []
    if (existing) {
      existing.capacityQuantity = capacity
      existing.allocations = allocations
      existing.deletedAt = null
      existing.updatedAt = new Date()
      continue
    }
    em.persist(em.create(SupplierProductionSlot, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      catalogVariantId: variant.id,
      startsAt,
      capacityQuantity: capacity,
      allocations,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  }
  // Dates are relative to today, so a reset on another day seeds new slot times; retire slots from earlier seeds
  // so the planner and demo:preflight only ever see the three demo slots.
  const expectedStarts = new Set([0, 2, 3].map((days) => addDays(expectedDeliveryAt, days).getTime()))
  const staleSlots = await em.find(SupplierProductionSlot, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    catalogVariantId: variant.id,
    deletedAt: null,
  })
  for (const slot of staleSlots) {
    if (!expectedStarts.has(slot.startsAt.getTime())) {
      slot.deletedAt = new Date()
      slot.updatedAt = new Date()
    }
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['supplier_demo.*'],
    admin: ['supplier_demo.*'],
    employee: ['supplier_demo.supply_cases.view'],
  },

  async seedDefaults({ em, container, tenantId, organizationId }) {
    await ensureAutoSupplyProposalToggle(em)
    await ensureAutoSupplyReplyToggle(em)
    await ensureAutoNegotiationToggle(em)
    await ensureCounterRecoverySchedule(container, { tenantId, organizationId })
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    await ensureAutoSupplyProposalToggle(em)
    await ensureAutoSupplyReplyToggle(em)
    await ensureAutoNegotiationToggle(em)
    await ensureCounterRecoverySchedule(container, { tenantId, organizationId })
    await ensureSupplierDemoEncryptionMaps(em, tenantId, organizationId)
    const scope = { tenantId, organizationId }
    const commandBus = container.resolve('commandBus') as CommandBus
    const commandContext = buildCommandContext(container, scope)
    const { variant } = await ensureProduct(em, scope)
    const warehouse = await ensureWarehouse(em, commandBus, commandContext, scope)
    const location = await ensureLocation(em, commandBus, commandContext, scope, warehouse)
    await reconcileStock(em, commandBus, commandContext, scope, variant, warehouse, location)
    const manufacturer = await ensureManufacturer(em, commandBus, commandContext, scope)
    const expectedDeliveryAt = nextWednesday()
    const order441 = await ensureDemoOrder(em, commandBus, commandContext, scope, manufacturer, variant, 'SO-441', 500, expectedDeliveryAt)
    const order442 = await ensureDemoOrder(em, commandBus, commandContext, scope, manufacturer, variant, 'SO-442', 300, addDays(expectedDeliveryAt, 2))
    await ensureDemoProductionSlots(em, scope, variant, expectedDeliveryAt, order442.orderNumber)
    for (const order of [order441, order442]) {
      await commandBus.execute('wms.sales-order.assign-warehouse', {
        input: {
          tenantId,
          organizationId,
          salesOrderId: order.id,
          warehouseId: warehouse.id,
          metadata: { source: 'supplier_demo_seed' },
        },
        ctx: commandContext,
      })
    }
  },
}

export default setup
