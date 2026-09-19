import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { test, expect } from '@playwright/test'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProductVariant, type CatalogProductVariant as CatalogProductVariantType } from '@open-mercato/core/modules/catalog/data/entities'
import { Warehouse } from '@open-mercato/core/modules/wms/data/entities'
import { SupplyCase, SupplyMessage, SupplierProductionSlot } from '../data/entities'
import '../../../bootstrap-common'

type CliResult = {
  code: number
  stdout: string
  stderr: string
}

function runSupplierDemoReset(): Promise<CliResult> {
  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['mercato', 'supplier_demo', 'demo:reset'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPPLIER_DEMO_PARTNER_EMAILS: process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? 'manufacturer-a@example.test',
        SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS: process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ?? 'supplier-demo@example.test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
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

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

test('TEST-003 opens a real seeded shortfall through the query engine', async () => {
  test.setTimeout(120_000)
  process.env.SUPPLIER_DEMO_PARTNER_EMAILS ??= 'manufacturer-a@example.test'
  process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ??= 'supplier-demo@example.test'
  const reset = await runSupplierDemoReset()
  expect(reset.code, reset.stderr).toBe(0)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus
  const warehouse = await em.findOne(Warehouse, { deletedAt: null }, { orderBy: { createdAt: 'asc' } })
  expect(warehouse).toBeTruthy()
  if (!warehouse) return
  const scope = { tenantId: warehouse.tenantId, organizationId: warehouse.organizationId }
  const order = (await findWithDecryption(em, SalesOrder, {
    ...scope,
    deletedAt: null,
    orderNumber: { $like: 'SO-441%' },
  }, { orderBy: { createdAt: 'desc' } }, scope)).find((candidate) => !['canceled', 'cancelled'].includes(candidate.status ?? ''))
  expect(order).toBeTruthy()
  if (!order) return

  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null }) as CatalogProductVariantType | null
  expect(variant).toBeTruthy()
  if (!variant) return

  const execution = await commandBus.execute('supplier_demo.supply_case.open_from_shortfall', {
    input: {
      salesOrderId: order.id,
      orderNumber: order.orderNumber,
      shortfalls: [{
        catalogVariantId: variant.id,
        requiredQuantity: 500,
        reservedQuantity: 300,
        shortfallQuantity: 200,
      }],
      trigger: 'wms_shortfall',
    },
    ctx: buildContext(container, scope),
  })

  expect((execution.result as { status?: string }).status).toBe('proposal_ready')
  const supplyCase = await findOneWithDecryption(em, SupplyCase, {
    ...scope,
    salesOrderId: order.id,
    deletedAt: null,
  }, undefined, scope)
  expect(supplyCase?.status).toBe('proposal_ready')
  if (!supplyCase) return
  const supplyMessage = await findOneWithDecryption(em, SupplyMessage, {
    ...scope,
    supplyCaseId: supplyCase?.id,
    deletedAt: null,
  }, undefined, scope)
  expect(supplyMessage?.deliveryStatus).toBe('pending')
  expect(supplyMessage?.supplyCaseId).toBe(supplyCase?.id)
  expect(supplyMessage?.recipientEmail).toBe((process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? 'manufacturer-a@example.test').split(',')[0]?.trim())
  expect(supplyMessage?.senderEmail).toBeTruthy()
  expect(supplyCase?.baselineCommitment).toEqual([
    { quantity: 300, date: isoDate(order.expectedDeliveryAt as Date) },
    { quantity: 200, date: isoDate(new Date(new Date(order.expectedDeliveryAt as Date).setDate((order.expectedDeliveryAt as Date).getDate() + 2))) },
  ])
  expect(supplyCase?.currentCommitment).toEqual([
    { quantity: 400, date: isoDate(order.expectedDeliveryAt as Date) },
    { quantity: 100, date: isoDate(new Date(new Date(order.expectedDeliveryAt as Date).setDate((order.expectedDeliveryAt as Date).getDate() + 2))) },
  ])
  expect(supplyCase?.policyDecision).toBe('auto_approved')
  expect(supplyCase?.additionalCost).toBe('120')
  expect(supplyCase?.planSummary).toEqual({
    movedAllocations: [{ orderNumber: 'SO-442', shiftHours: 4 }],
    incrementalCost: 120,
    currency: 'PLN',
    slaProtected: true,
  })
  const slots = await em.find(SupplierProductionSlot, { ...scope, catalogVariantId: variant.id, deletedAt: null }, { orderBy: { startsAt: 'asc' } })
  expect(slots[0]?.allocations).toEqual([])
  expect(slots[1]?.allocations).toEqual([expect.objectContaining({ orderNumber: 'SO-442', priority: 'normal' })])
  expect(supplyCase?.recipientEmail).toBe((process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? 'manufacturer-a@example.test').split(',')[0]?.trim())
  const decryptedSnapshot = supplyCase?.customerSnapshot as { customer?: { primaryEmail?: string } } | null | undefined
  expect(decryptedSnapshot?.customer?.primaryEmail).toBe(supplyCase?.recipientEmail)
  const [rawCase] = await em.getConnection().execute<{ snapshot_type: string; snapshot_text: string }[]>(
    `select jsonb_typeof(customer_snapshot) as snapshot_type, customer_snapshot::text as snapshot_text
       from supplier_demo_supply_cases where id = ?`,
    [supplyCase.id],
  )
  expect(rawCase?.snapshot_type).toBe('string')
  expect(rawCase?.snapshot_text).not.toContain(String(supplyCase?.recipientEmail))

  const secondVariantId = randomUUID()
  const multiSkuOrder = (await findWithDecryption(em, SalesOrder, {
    ...scope,
    deletedAt: null,
    orderNumber: 'SO-442',
  }, undefined, scope))[0]
  expect(multiSkuOrder).toBeTruthy()
  if (!multiSkuOrder) return
  const multiSkuExecution = await commandBus.execute('supplier_demo.supply_case.open_from_shortfall', {
    input: {
      salesOrderId: multiSkuOrder.id,
      orderNumber: multiSkuOrder.orderNumber,
      shortfalls: [
        { catalogVariantId: variant.id, requiredQuantity: 300, reservedQuantity: 100, shortfallQuantity: 200 },
        { catalogVariantId: secondVariantId, requiredQuantity: 10, reservedQuantity: 0, shortfallQuantity: 10 },
      ],
      trigger: 'wms_shortfall',
    },
    ctx: buildContext(container, scope),
  })
  expect((multiSkuExecution.result as { status?: string }).status).toBe('escalated')
  const multiSkuCase = await findOneWithDecryption(em, SupplyCase, {
    ...scope,
    salesOrderId: multiSkuOrder.id,
    deletedAt: null,
  }, undefined, scope)
  expect(multiSkuCase?.statusReason).toBe('multi_sku')
  const multiSkuMessage = await findOneWithDecryption(em, SupplyMessage, {
    ...scope,
    supplyCaseId: multiSkuCase?.id,
    deletedAt: null,
  }, undefined, scope)
  expect(multiSkuMessage?.deliveryStatus).toBe('pending')

  const missingOrderId = randomUUID()
  const missingExecution = await commandBus.execute('supplier_demo.supply_case.open_from_shortfall', {
    input: {
      salesOrderId: missingOrderId,
      orderNumber: 'SO-MISSING',
      shortfalls: [{
        catalogVariantId: variant.id,
        requiredQuantity: 500,
        reservedQuantity: 300,
        shortfallQuantity: 200,
      }],
      trigger: 'wms_shortfall',
    },
    ctx: buildContext(container, scope),
  })
  expect((missingExecution.result as { status?: string }).status).toBe('escalated')
  const missingCase = await findOneWithDecryption(em, SupplyCase, {
    ...scope,
    salesOrderId: missingOrderId,
    deletedAt: null,
  }, undefined, scope)
  expect(missingCase?.status).toBe('escalated')
  expect(missingCase?.statusReason).toBe('order_not_found')
})

test('TEST-003b retry re-evaluates a recipient blocked by the partner allowlist', async () => {
  test.setTimeout(120_000)
  const partnerEmails = process.env.SUPPLIER_DEMO_PARTNER_EMAILS ?? 'manufacturer-a@example.test'
  process.env.SUPPLIER_DEMO_PARTNER_EMAILS = partnerEmails
  process.env.SUPPLIER_DEMO_MAILBOX_FROM_ADDRESS ??= 'supplier-demo@example.test'
  const reset = await runSupplierDemoReset()
  expect(reset.code, reset.stderr).toBe(0)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus
  const warehouse = await em.findOne(Warehouse, { deletedAt: null }, { orderBy: { createdAt: 'asc' } })
  if (!warehouse) throw new Error('demo warehouse missing')
  const scope = { tenantId: warehouse.tenantId, organizationId: warehouse.organizationId }
  const order = (await findWithDecryption(em, SalesOrder, {
    ...scope,
    deletedAt: null,
    orderNumber: { $like: 'SO-441%' },
  }, { orderBy: { createdAt: 'desc' } }, scope)).find((candidate) => !['canceled', 'cancelled'].includes(candidate.status ?? ''))
  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
  if (!order || !variant) throw new Error('demo order or variant missing')

  try {
    process.env.SUPPLIER_DEMO_PARTNER_EMAILS = 'not-the-partner@example.test'
    const opened = await commandBus.execute('supplier_demo.supply_case.open_from_shortfall', {
      input: {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        shortfalls: [{ catalogVariantId: variant.id, requiredQuantity: 500, reservedQuantity: 300, shortfallQuantity: 200 }],
        trigger: 'wms_shortfall',
      },
      ctx: buildContext(container, scope),
    })
    expect((opened.result as { status?: string }).status).toBe('blocked_recipient')
  } finally {
    process.env.SUPPLIER_DEMO_PARTNER_EMAILS = partnerEmails
  }

  const readCase = () => findOneWithDecryption(em.fork(), SupplyCase, { ...scope, salesOrderId: order.id, deletedAt: null }, undefined, scope)
  const blocked = await readCase()
  expect(blocked?.status).toBe('blocked_recipient')
  expect(blocked?.recipientEmail ?? null).toBeNull()
  if (!blocked) return

  const retried = await commandBus.execute('supplier_demo.supply_case.retry', {
    input: { caseId: blocked.id, updatedAt: blocked.updatedAt },
    ctx: buildContext(container, scope),
  })
  expect((retried.result as { status?: string }).status).toBe('proposal_ready')
  const recovered = await readCase()
  expect(recovered?.recipientEmail).toBe(partnerEmails.split(',')[0]?.trim())
})
