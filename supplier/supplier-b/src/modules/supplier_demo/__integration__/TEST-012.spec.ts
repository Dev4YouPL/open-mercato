import { spawn } from 'node:child_process'
import type { EntityManager } from '@mikro-orm/postgresql'
import { test, expect } from '@playwright/test'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { Warehouse } from '@open-mercato/core/modules/wms/data/entities'
import { SupplyCase, SupplyMessage, SupplierProductionSlot } from '../data/entities'
import '../../../bootstrap-common'

type CliResult = { code: number; stdout: string; stderr: string }

function runSupplierDemoReset(priority: 'normal' | 'high'): Promise<CliResult> {
  const executable = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['mercato', 'supplier_demo', 'demo:reset', '--so442-priority', priority], {
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

test('TEST-012 high-priority slot escalates without sending', async () => {
  test.setTimeout(120_000)
  const reset = await runSupplierDemoReset('high')
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
  const variant = await em.findOne(CatalogProductVariant, { ...scope, sku: 'MAT-42', deletedAt: null })
  expect(order).toBeTruthy()
  expect(variant).toBeTruthy()
  if (!order || !variant) return

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

  expect((execution.result as { status?: string }).status).toBe('escalated')
  const supplyCase = await findOneWithDecryption(em, SupplyCase, { ...scope, salesOrderId: order.id, deletedAt: null }, undefined, scope)
  expect(supplyCase?.status).toBe('escalated')
  expect(supplyCase?.statusReason).toBe('policy_human_required')
  expect(supplyCase?.policyDecision).toBe('human_required')
  expect(supplyCase?.currentCommitment).toEqual([
    { quantity: 300, date: (order.expectedDeliveryAt as Date).toISOString().slice(0, 10) },
    { quantity: 200, date: new Date(new Date(order.expectedDeliveryAt as Date).setDate((order.expectedDeliveryAt as Date).getDate() + 2)).toISOString().slice(0, 10) },
  ])
  if (!supplyCase) return
  const supplyMessage = await findOneWithDecryption(em, SupplyMessage, { ...scope, supplyCaseId: supplyCase.id, deletedAt: null }, undefined, scope)
  expect(supplyMessage?.deliveryStatus).toBe('pending')
  const slots = await em.find(SupplierProductionSlot, { ...scope, catalogVariantId: variant.id, deletedAt: null }, { orderBy: { startsAt: 'asc' } })
  expect(slots[0]?.allocations).toEqual([
    expect.objectContaining({ orderNumber: 'SO-442', priority: 'high' }),
    expect.objectContaining({ orderNumber: 'SO-443', priority: 'high' }),
  ])
  expect(slots[1]?.allocations).toEqual([])
  expect(slots[2]?.allocations).toEqual([])
})
