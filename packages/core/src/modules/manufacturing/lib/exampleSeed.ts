import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import type { ProductionOperationResultDto, ProductionOperations } from '../application/productionOperations'
import { ProductionExecution, ProductionOrder } from '../data/entities'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { ProductionOrderStatus } from '../domain/orderExecutionPermissions'
import { toPositiveQuantity } from '../domain/quantity'
import { resolveExampleCatalog, type ExampleProductSpec } from '../ports/exampleCatalog'
import { resolveExecutionHistoryReader } from '../ports/executionHistoryReader'
import { resolveInventoryGatewayFactory } from '../ports/inventoryGateway'
import { resolveInventoryPolicyReader, type InventoryLocationDto } from '../ports/inventoryPolicyReader'
import { resolveProductionExecutionStore } from '../ports/productionExecutionStore'
import { resolveProductionOrderStore } from '../ports/productionOrderStore'
import { buildProductionOperations } from './executionServices'

const logger = createLogger('manufacturing').child({ component: 'example-seed' })

export const EXAMPLE_MATERIAL_LOCATION_CODE = 'B-01-01'
export const EXAMPLE_RECEIPT_LOCATION_CODE = 'STAGE-OUT'
export const EXAMPLE_BOM_REVISION_IDS = {
  table: '00000000-0000-4000-8000-00000000a001',
  bench: '00000000-0000-4000-8000-00000000a002',
} as const

export const EXAMPLE_PRODUCTS: ExampleProductSpec[] = [
  { sku: 'OAK-TABLE-180', title: 'Oak Dining Table 180' },
  { sku: 'OAK-BENCH-140', title: 'Oak Bench 140' },
  { sku: 'OAK-TOP-180', title: 'Oak Table Top 180x90' },
  { sku: 'OAK-LEG-72', title: 'Oak Table Leg 72 cm' },
  { sku: 'OAK-SEAT-140', title: 'Oak Bench Seat 140' },
  { sku: 'OAK-LEG-45', title: 'Oak Bench Leg 45 cm' },
  { sku: 'SCREW-SET-M8', title: 'Assembly Screw Set M8' },
  { sku: 'FINISH-OIL-1L', title: 'Wood Finish Oil 1 L' },
]

export const EXAMPLE_OPENING_STOCK: Array<{ sku: string; quantity: number }> = [
  { sku: 'OAK-TOP-180', quantity: 12 },
  { sku: 'OAK-LEG-72', quantity: 48 },
  { sku: 'OAK-SEAT-140', quantity: 8 },
  { sku: 'OAK-LEG-45', quantity: 32 },
  { sku: 'SCREW-SET-M8', quantity: 40 },
  { sku: 'FINISH-OIL-1L', quantity: 10 },
]

type SeedEnvironment = {
  ctx: CommandRuntimeContext
  scope: ManufacturingScope
  operations: ProductionOperations
  variants: Map<string, string>
  materialLocation: InventoryLocationDto
  receiptLocation: InventoryLocationDto
}

type UserRow = { id: string }

const DAY_MS = 24 * 60 * 60 * 1000

async function findSeedActor(em: EntityManager, scope: ManufacturingScope): Promise<string | null> {
  const rows = await em.execute<UserRow[]>(
    'select id from users where tenant_id = ? and deleted_at is null order by created_at asc limit 1',
    [scope.tenantId],
    'all',
  )

  return rows[0]?.id ?? null
}

function buildCommandContext(container: InitSetupContext['container'], scope: ManufacturingScope, userId: string): CommandRuntimeContext {
  return {
    container,
    auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

function variant(env: SeedEnvironment, sku: string): string {
  const variantId = env.variants.get(sku)

  if (!variantId) throw new Error(`[internal] example variant ${sku} is missing`)

  return variantId
}

async function expectPosted(label: string, result: Promise<ProductionOperationResultDto>): Promise<void> {
  const outcome = await result

  if (outcome.status !== 'accepted') logger.warn('Example execution step was not posted', { label, outcome: outcome.status })
}

async function seedOpeningStock(env: SeedEnvironment): Promise<void> {
  const gateway = resolveInventoryGatewayFactory(env.ctx.container)(env.ctx, env.scope.organizationId)

  for (const stock of EXAMPLE_OPENING_STOCK) {
    const quantity = toPositiveQuantity(stock.quantity)

    if (!quantity) continue

    await gateway.postMovement({
      operationId: randomUUID(),
      kind: 'receiveOutput',
      warehouseId: env.materialLocation.warehouseId,
      locationId: env.materialLocation.id,
      variantId: variant(env, stock.sku),
      quantity,
    })
  }
}

async function createOrder(
  env: SeedEnvironment,
  em: EntityManager,
  input: { sku: string; bomRevisionId: string; plannedQuantity: number; dueInDays: number; status: ProductionOrderStatus },
): Promise<string> {
  const created = await resolveProductionOrderStore(env.ctx.container).create(
    {
      productVariantId: variant(env, input.sku),
      bomRevisionId: input.bomRevisionId,
      plannedQuantity: input.plannedQuantity,
      sourceLocationId: env.materialLocation.id,
      targetLocationId: env.receiptLocation.id,
      dueAt: new Date(Date.now() + input.dueInDays * DAY_MS),
    },
    env.scope,
  )

  await em.nativeUpdate(ProductionOrder, { ...env.scope, id: created.id }, { status: input.status })

  return created.id
}

async function createExecution(env: SeedEnvironment, orderId: string | null, productSku: string | null, userId: string): Promise<string> {
  const created = await resolveProductionExecutionStore(env.ctx.container).create(
    {
      orderId,
      productVariantId: orderId || !productSku ? null : variant(env, productSku),
      sourceLocationId: orderId ? null : env.materialLocation.id,
      targetLocationId: orderId ? null : env.receiptLocation.id,
      createdBy: userId,
    },
    env.scope,
  )

  return created.id
}

async function documentOf(env: SeedEnvironment, executionId: string, operationId: string): Promise<string> {
  const documents = await resolveExecutionHistoryReader(env.ctx.container).listForExecution(executionId, env.scope)
  const document = documents.find((candidate) => candidate.operationId === operationId)

  if (!document) throw new Error(`[internal] example operation ${operationId} posted no document`)

  return document.id
}

async function issue(env: SeedEnvironment, executionId: string, sku: string, quantity: number): Promise<string> {
  const operationId = randomUUID()
  await expectPosted(`issue ${sku}`, env.operations.issueMaterial({ operationId, executionId, variantId: variant(env, sku), quantity }))
  return operationId
}

async function confirm(env: SeedEnvironment, executionId: string, goodQuantity: number, scrapQuantity: number): Promise<string> {
  const operationId = randomUUID()
  await expectPosted('confirm production', env.operations.confirmProduction({ operationId, executionId, goodQuantity, scrapQuantity }))
  return operationId
}

async function reverse(env: SeedEnvironment, executionId: string, operationId: string): Promise<string> {
  const documentId = await documentOf(env, executionId, operationId)
  const reversalOperationId = randomUUID()
  await expectPosted('reverse document', env.operations.reverseDocument({ operationId: reversalOperationId, documentId }))
  return reversalOperationId
}

async function seedFirstShift(env: SeedEnvironment, executionId: string): Promise<void> {
  await issue(env, executionId, 'OAK-TOP-180', 4)
  await issue(env, executionId, 'OAK-LEG-72', 16)
  await issue(env, executionId, 'SCREW-SET-M8', 4)
  await issue(env, executionId, 'FINISH-OIL-1L', 1)
  await expectPosted(
    'return spare leg',
    env.operations.returnMaterial({ operationId: randomUUID(), executionId, variantId: variant(env, 'OAK-LEG-72'), quantity: 1 }),
  )
  await confirm(env, executionId, 3, 1)
}

async function seedSecondShift(env: SeedEnvironment, executionId: string): Promise<void> {
  const wrongIssue = await issue(env, executionId, 'OAK-TOP-180', 3)
  await reverse(env, executionId, wrongIssue)
  await issue(env, executionId, 'OAK-TOP-180', 2)
  await issue(env, executionId, 'OAK-LEG-72', 8)
  await issue(env, executionId, 'SCREW-SET-M8', 2)
  const confirmation = await confirm(env, executionId, 2, 0)
  const mistakenReversal = await reverse(env, executionId, confirmation)
  await reverse(env, executionId, mistakenReversal)
}

async function seedRework(env: SeedEnvironment, executionId: string): Promise<void> {
  await issue(env, executionId, 'FINISH-OIL-1L', 1)
  await confirm(env, executionId, 0, 1)
}

async function prepareEnvironment(ctx: InitSetupContext, scope: ManufacturingScope, userId: string): Promise<SeedEnvironment | null> {
  const commandContext = buildCommandContext(ctx.container, scope, userId)
  const locations = await resolveInventoryPolicyReader(ctx.container).listActiveLocations(scope)
  const materialLocation = locations.find((location) => location.code === EXAMPLE_MATERIAL_LOCATION_CODE)
  const receiptLocation = locations.find((location) => location.code === EXAMPLE_RECEIPT_LOCATION_CODE)

  if (!materialLocation || !receiptLocation) {
    logger.info('Skipping manufacturing example data: WMS example locations are missing')
    return null
  }

  const variants = await resolveExampleCatalog(ctx.container).ensureVariants(EXAMPLE_PRODUCTS, commandContext, scope)
  const operations = buildProductionOperations(commandContext, { scope, userId })

  return { ctx: commandContext, scope, operations, variants, materialLocation, receiptLocation }
}

export async function seedManufacturingExamples(ctx: InitSetupContext): Promise<void> {
  const scope: ManufacturingScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  const em = ctx.em.fork()

  if ((await em.count(ProductionExecution, { ...scope })) > 0) return

  const userId = await findSeedActor(em, scope)

  if (!userId) return

  const env = await prepareEnvironment(ctx, scope, userId)

  if (!env) return

  await seedOpeningStock(env)

  const tableOrderId = await createOrder(env, em, {
    sku: 'OAK-TABLE-180',
    bomRevisionId: EXAMPLE_BOM_REVISION_IDS.table,
    plannedQuantity: 10,
    dueInDays: 7,
    status: 'in_progress',
  })
  await createOrder(env, em, {
    sku: 'OAK-BENCH-140',
    bomRevisionId: EXAMPLE_BOM_REVISION_IDS.bench,
    plannedQuantity: 4,
    dueInDays: 14,
    status: 'released',
  })

  await seedFirstShift(env, await createExecution(env, tableOrderId, null, userId))
  await seedSecondShift(env, await createExecution(env, tableOrderId, null, userId))
  await seedRework(env, await createExecution(env, null, 'OAK-TABLE-180', userId))
}
