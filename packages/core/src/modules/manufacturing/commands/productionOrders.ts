import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createProductionOrder, type ProductionOrderCreationResultDto } from '../application/productionOrderCreation'
import { ProductionOrder } from '../data/entities'
import { createProductionOrderSchema } from '../data/validators'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import { resolveManufacturingScope } from '../lib/manufacturingScope'
import { resolveBomRevisionReader } from '../ports/bomRevisionReader'
import { resolveInventoryPolicyReader } from '../ports/inventoryPolicyReader'
import { resolveProductionOrderStore } from '../ports/productionOrderStore'

export const CREATE_PRODUCTION_ORDER_COMMAND_ID = 'manufacturing.production_orders.create'
export const PRODUCTION_ORDER_RESOURCE_KIND = 'manufacturing.production_order'

export type CreateProductionOrderResult = {
  orderId: string
  orderNumber: string
}

type Rejection = Extract<ProductionOrderCreationResultDto, { status: 'rejected' }>

async function toHttpError(rejection: Rejection): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  const message = translate(`manufacturing.orders.errors.${rejection.code}`, rejection.message)

  return new CrudHttpError(422, {
    error: message,
    code: rejection.code,
    ...(rejection.field ? { fieldErrors: { [rejection.field]: message } } : {}),
  })
}

async function emitOrderCreated(ctx: CommandRuntimeContext, orderId: string, scope: ManufacturingScope): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const order = await findOneWithDecryption(em, ProductionOrder, { ...scope, id: orderId }, undefined, scope)

  if (!order) throw new Error(`[internal] production order ${orderId} disappeared right after it was created`)

  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'created',
    entity: order,
    identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
    actorUserId: ctx.auth?.sub ?? null,
    indexer: { entityType: E.manufacturing.production_order },
  })
}

export const createProductionOrderCommand: CommandHandler<unknown, CreateProductionOrderResult> = {
  id: CREATE_PRODUCTION_ORDER_COMMAND_ID,

  async execute(rawInput, ctx) {
    const { translate } = await resolveTranslations()
    const input = createProductionOrderSchema.parse(rawInput)
    const scope = resolveManufacturingScope(ctx, translate('manufacturing.errors.scopeRequired', 'Select an organization.'))
    const result = await createProductionOrder(
      {
        bomRevisionReader: resolveBomRevisionReader(ctx.container),
        inventoryPolicyReader: resolveInventoryPolicyReader(ctx.container),
        productionOrderStore: resolveProductionOrderStore(ctx.container),
        scope,
      },
      input,
    )

    if (result.status === 'rejected') throw await toHttpError(result)

    await emitOrderCreated(ctx, result.orderId, scope)

    return { orderId: result.orderId, orderNumber: result.orderNumber }
  },

  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()

    return {
      actionLabel: translate('manufacturing.audit.orders.create', 'Create production order'),
      resourceKind: PRODUCTION_ORDER_RESOURCE_KIND,
      resourceId: result.orderId,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createProductionOrderCommand)
