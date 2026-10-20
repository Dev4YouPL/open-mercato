import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createProductionOrder, type ProductionOrderCreationResultDto } from '../application/productionOrderCreation'
import { createProductionOrderSchema } from '../data/validators'
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
