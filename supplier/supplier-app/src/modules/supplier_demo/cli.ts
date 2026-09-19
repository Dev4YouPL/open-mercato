import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { InventoryBalance, InventoryReservation, Warehouse, WarehouseLocation, SalesOrderWarehouseAssignment } from '@open-mercato/core/modules/wms/data/entities'
import { resolveStatusEntryIdByValue } from '@open-mercato/core/modules/sales/lib/statusHelpers'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { SupplyCase, SupplyMessage, SupplierProductionSlot } from './data/entities'
import supplierDemoEncryptionMaps from './encryption'
import { ensureAutoSupplyProposalToggle, ensureDemoProductionSlots, setup } from './setup'
import { sendSupplyMail } from './lib/mailbox'
import { resolveMailboxActor } from './lib/mailbox'
import { resolveSupplyRecipient } from './lib/recipient'
import { isAutoSupplyProposalEnabled, supplierDemoToggleId } from './lib/toggles'

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (!argument?.startsWith('--')) continue
    const [key, inlineValue] = argument.slice(2).split('=', 2)
    const nextValue = inlineValue ?? rest[index + 1]
    if (inlineValue === undefined && nextValue && !nextValue.startsWith('--')) index += 1
    if (nextValue && !nextValue.startsWith('--')) args[key] = nextValue
  }
  return args
}

function parseSo442Priority(args: Record<string, string>): 'normal' | 'high' {
  const priority = args['so442-priority'] ?? 'normal'
  if (priority !== 'normal' && priority !== 'high') {
    throw new Error('[internal] --so442-priority must be normal or high.')
  }
  return priority
}

// Slot allocations live in a jsonb column: Postgres re-orders object keys, so compare field by field instead of
// comparing JSON strings.
function sameAllocations(
  actual: ReadonlyArray<Record<string, unknown>> | null | undefined,
  expected: ReadonlyArray<Record<string, unknown>>,
): boolean {
  const rows = actual ?? []
  if (rows.length !== expected.length) return false
  return expected.every((wanted, index) => {
    const row = rows[index] ?? {}
    const sameDue = new Date(String(row.slaDueAt ?? '')).getTime() === new Date(String(wanted.slaDueAt ?? '')).getTime()
    return row.orderNumber === wanted.orderNumber
      && Number(row.quantity) === Number(wanted.quantity)
      && row.priority === wanted.priority
      && sameDue
      && Number(row.shiftableHours) === Number(wanted.shiftableHours)
      && Number(row.shiftCostPerHour) === Number(wanted.shiftCostPerHour)
  })
}

async function restoreDemoProductionSlots(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  priority: 'normal' | 'high',
): Promise<void> {
  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
  const orders = await findWithDecryption(em, SalesOrder, {
    ...scope,
    deletedAt: null,
    orderNumber: { $like: 'SO-44%' },
  }, { orderBy: { createdAt: 'desc' } }, scope)
  const order441 = orders.find((order) => order.orderNumber.startsWith('SO-441') && !['canceled', 'cancelled'].includes(order.status ?? ''))
  const order442 = orders.find((order) => order.orderNumber.startsWith('SO-442') && !['canceled', 'cancelled'].includes(order.status ?? ''))
  if (!variant || !order441 || !order442 || !order441.expectedDeliveryAt) {
    throw new Error('[internal] Supplier demo production-slot seed requires active SO-441, SO-442 and MAT-42.')
  }
  await ensureDemoProductionSlots(em, scope, variant, order441.expectedDeliveryAt, order442.orderNumber, priority)
}

async function resolveScope(em: EntityManager, args: Record<string, string>): Promise<{ tenantId: string; organizationId: string }> {
  const explicit = {
    tenantId: args['tenant-id'] ?? process.env.SUPPLIER_DEMO_TENANT_ID,
    organizationId: args['organization-id'] ?? process.env.SUPPLIER_DEMO_ORGANIZATION_ID,
  }
  if (explicit.tenantId && explicit.organizationId) return explicit as { tenantId: string; organizationId: string }
  const warehouse = await em.findOne(Warehouse, { deletedAt: null }, { orderBy: { createdAt: 'asc' } })
  if (!warehouse) throw new Error('[internal] Usage requires --tenant-id and --organization-id when no demo warehouse exists.')
  return { tenantId: warehouse.tenantId, organizationId: warehouse.organizationId }
}

function buildContext(container: CommandRuntimeContext['container'], scope: { tenantId: string; organizationId: string }): CommandRuntimeContext {
  return {
    container,
    auth: { tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
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

const demoReset: ModuleCli = {
  command: 'demo:reset',
  async run(rest) {
    const args = parseArgs(rest)
    const so442Priority = parseSo442Priority(args)
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scope = await resolveScope(em, args)
    const commandBus = container.resolve('commandBus') as CommandBus
    const context = buildContext(container, scope)
    await ensureAutoSupplyProposalToggle(em)
    const cases = await em.find(SupplyCase, { ...scope, deletedAt: null })
    const messages = await em.find(SupplyMessage, { ...scope, deletedAt: null })
    for (const supplyCase of cases) supplyCase.deletedAt = new Date()
    for (const message of messages) message.deletedAt = new Date()
    const demoOrders = await findWithDecryption(em, SalesOrder, {
      ...scope,
      deletedAt: null,
      orderNumber: { $like: 'SO-441%' },
    }, { orderBy: { createdAt: 'desc' } }, scope)
    const cancelledStatusEntryId = await resolveStatusEntryIdByValue(em, { ...scope, value: 'canceled' })
    const activeDemoOrders = demoOrders.filter((order) => !['canceled', 'cancelled'].includes(order.status ?? ''))
    if (activeDemoOrders.length && !cancelledStatusEntryId) {
      throw new Error('[internal] The sales canceled status is unavailable.')
    }
    for (const order of activeDemoOrders) {
      await commandBus.execute('sales.orders.update', {
        input: { id: order.id, statusEntryId: cancelledStatusEntryId },
        ctx: context,
      })
    }
    const activeReservations = activeDemoOrders.length
      ? await em.find(InventoryReservation, {
        ...scope,
        sourceType: 'order',
        sourceId: { $in: activeDemoOrders.map((order) => order.id) },
        status: 'active',
        deletedAt: null,
      })
      : []
    for (const reservation of activeReservations) {
      await commandBus.execute('wms.inventory.release', {
        input: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: reservation.id,
          reason: 'supplier_demo_reset',
          metadata: { source: 'supplier_demo_reset' },
        },
        ctx: context,
      })
    }
    await em.flush()
    if (!setup.seedExamples) throw new Error('[internal] Supplier demo setup seed is unavailable.')
    await setup.seedExamples({ em, container, tenantId: scope.tenantId, organizationId: scope.organizationId })
    await restoreDemoProductionSlots(em, scope, so442Priority)
    console.log(`[internal] Supplier demo reset completed for ${scope.tenantId}/${scope.organizationId} (SO-442 priority: ${so442Priority}).`)
  },
}

const demoPreflight: ModuleCli = {
  command: 'demo:preflight',
  async run(rest) {
    const args = parseArgs(rest)
    const so442Priority = parseSo442Priority(args)
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scope = await resolveScope(em, args)
    const failures: Array<{ item: string; remediation: string }> = []
    const fail = (item: string, remediation: string) => failures.push({ item, remediation })
    const featureToggles = container.resolve('featureTogglesService') as { getBoolConfig: (id: string, tenantId: string) => Promise<{ ok: boolean; value?: boolean }> }
    const supplierToggle = await isAutoSupplyProposalEnabled(container, scope.tenantId)
    const wmsToggle = await featureToggles.getBoolConfig('wms_integration_sales_order_inventory', scope.tenantId)
    if (!supplierToggle) fail(supplierDemoToggleId, 'run yarn mercato supplier_demo demo:reset')
    if (!wmsToggle.ok || wmsToggle.value !== true) {
      fail('wms_integration_sales_order_inventory', 'enable the WMS reservation toggle, then run demo:reset')
    }
    try {
      await resolveMailboxActor({ em, expectedScope: scope })
    } catch (error) {
      fail(`mailbox:${error instanceof Error ? error.message : 'not_configured'}`, 'configure SUPPLIER_DEMO_MAILBOX_CHANNEL_ID and SUPPLIER_DEMO_MAILBOX_USER_ID, then reconnect the mailbox')
    }
    const manufacturers = (await findWithDecryption(em, CustomerEntity, { ...scope, deletedAt: null }, undefined, scope))
      .filter((customer) => customer.displayName === 'Manufacturer A')
    const manufacturer = manufacturers[0]
    if (!manufacturer) fail('Manufacturer A', 'run yarn mercato supplier_demo demo:reset')
    else if (!resolveSupplyRecipient({ customer: { primaryEmail: manufacturer.primaryEmail } }).ok) {
      fail('partner_allowlist', 'set SUPPLIER_DEMO_PARTNER_EMAILS in .env, then run demo:reset')
    }
    if (manufacturers.length > 1) fail('duplicate Manufacturer A rows', 'run yarn mercato supplier_demo demo:reset to soft-delete duplicate demo customers')
    const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
    const warehouse = await em.findOne(Warehouse, { ...scope, code: 'SUPPLIER-DEMO', deletedAt: null })
    const location = warehouse ? await em.findOne(WarehouseLocation, { ...scope, warehouse, code: 'STOCK', deletedAt: null }) : null
    const balance = variant && warehouse && location
      ? await em.findOne(InventoryBalance, { ...scope, catalogVariantId: variant.id, warehouse, location, lot: null, serialNumber: null, deletedAt: null })
      : null
    if (!variant) fail('MAT-42', 'run yarn mercato supplier_demo demo:reset')
    if (!warehouse || !location) fail('SUPPLIER-DEMO warehouse/location', 'run yarn mercato supplier_demo demo:reset')
    const activeReservations = variant
      ? await em.find(InventoryReservation, { ...scope, catalogVariantId: variant.id, status: 'active', deletedAt: null })
      : []
    if (!balance || Number(balance.quantityOnHand) !== 1000 || Number(balance.quantityReserved) !== 0 || Number(balance.quantityAllocated) !== 0) {
      fail('MAT-42 on-hand=1000 and reserved=0', 'run yarn mercato supplier_demo demo:reset')
    }
    if (activeReservations.length) {
      fail('MAT-42 has no active reservations', 'run yarn mercato supplier_demo demo:reset')
    }
    const demoOrders = await findWithDecryption(em, SalesOrder, { ...scope, deletedAt: null, orderNumber: { $like: 'SO-441%' } }, { orderBy: { createdAt: 'desc' } }, scope)
    const order = demoOrders.find((candidate) => !['canceled', 'cancelled'].includes(candidate.status ?? ''))
    if (!order || order.status !== 'draft') fail('draft SO-441', 'run yarn mercato supplier_demo demo:reset')
    if (order && warehouse) {
      const assignment = await em.findOne(SalesOrderWarehouseAssignment, { ...scope, salesOrderId: order.id, warehouse })
      if (!assignment) fail('SO-441 warehouse assignment', 'run yarn mercato supplier_demo demo:reset')
      const activeCase = await em.findOne(SupplyCase, { ...scope, salesOrderId: order.id, deletedAt: null })
      if (activeCase) fail('SO-441 has no active SupplyCase', 'soft-delete the demo case with demo:reset')
    }
    const slotOrderRows = await findWithDecryption(em, SalesOrder, {
      ...scope,
      deletedAt: null,
      orderNumber: { $like: 'SO-442%' },
    }, { orderBy: { createdAt: 'desc' } }, scope)
    const order442 = slotOrderRows.find((candidate) => !['canceled', 'cancelled'].includes(candidate.status ?? ''))
    const slots = variant && order?.expectedDeliveryAt
      ? await em.find(SupplierProductionSlot, {
        ...scope,
        catalogVariantId: variant.id,
        deletedAt: null,
      }, { orderBy: { startsAt: 'asc' } })
      : []
    const expectedStarts = order?.expectedDeliveryAt ? [order.expectedDeliveryAt, new Date(order.expectedDeliveryAt.getTime() + 2 * 24 * 60 * 60 * 1000)] : []
    const expectedSlotAllocations = [
      [{
        orderNumber: order442?.orderNumber ?? 'SO-442',
        quantity: 300,
        priority: so442Priority,
        slaDueAt: expectedStarts[1]?.toISOString(),
        shiftableHours: 4,
        shiftCostPerHour: 30,
      }],
      [],
    ]
    if (slots.length !== 2 || slots.some((slot, index) => {
      const expectedStart = expectedStarts[index]
      return !expectedStart
        || slot.startsAt.getTime() !== expectedStart.getTime()
        || slot.capacityQuantity !== 400
        || !sameAllocations(slot.allocations, expectedSlotAllocations[index] ?? [])
    })) {
      fail('production slot allocations match the seed', `run yarn mercato supplier_demo demo:reset --so442-priority ${so442Priority}`)
    }
    if (slots.some((slot) => slot.startsAt < new Date())) {
      fail('production slot dates are not in the past', 'run yarn mercato supplier_demo demo:reset')
    }
    for (const map of supplierDemoEncryptionMaps) {
      const row = await em.findOne(EncryptionMap, {
        entityId: map.entityId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isActive: true,
        deletedAt: null,
      })
      const configured = new Set((row?.fieldsJson ?? []).map((field) => field.field))
      if (!map.fields.every((field) => configured.has(field.field))) {
        fail(`encryption map ${map.entityId}`, 'run yarn mercato supplier_demo demo:reset, then restart yarn dev')
      }
    }
    console.log(`[internal] queue strategy: ${process.env.QUEUE_STRATEGY ?? process.env.OM_QUEUE_STRATEGY ?? 'configured by app'}`)
    if (failures.length) {
      for (const failure of failures) console.error(`[internal] Preflight failed: ${failure.item}. Remediation: ${failure.remediation}.`)
      throw new Error('[internal] Supplier demo preflight failed.')
    }
    console.log('[internal] Supplier demo preflight passed. Run workers if the queue strategy is asynchronous.')
  },
}

const mailSmoke: ModuleCli = {
  command: 'mail:smoke',
  async run(rest) {
    const args = parseArgs(rest)
    const parsed = z.object({ to: z.string().email() }).safeParse({ to: args.to })
    if (!parsed.success) {
      throw new Error('[internal] Usage: yarn mercato supplier_demo mail:smoke --to <addr>')
    }

    const container = await createRequestContainer()
    const result = await sendSupplyMail(container, {
      to: parsed.data.to,
      subject: 'Supplier mailbox smoke test',
      body: 'Supplier mailbox smoke test: the Communication Channels outbound path is active.',
    })
    console.log(`Supplier mailbox smoke message queued: ${result.messageId}`)
  },
}

const cliCommands = [mailSmoke, demoReset, demoPreflight]

export default cliCommands
