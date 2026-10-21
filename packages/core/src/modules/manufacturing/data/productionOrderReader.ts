import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { executionPermissionsFor } from '../domain/orderExecutionPermissions'
import type { ProductionOrderReader } from '../ports/productionOrderReader'
import { ProductionOrder } from './entities'

export type MikroProductionOrderReaderOptions = {
  em: EntityManager
}

export function createMikroProductionOrderReader({ em }: MikroProductionOrderReaderOptions): ProductionOrderReader {
  return {
    async getForExecution(orderId, scope) {
      const order = await findOneWithDecryption(
        em.fork(),
        ProductionOrder,
        { ...scope, id: orderId, deletedAt: null },
        undefined,
        scope,
      )

      if (!order) return null

      return {
        id: order.id,
        tenantId: order.tenantId,
        organizationId: order.organizationId,
        productVariantId: order.productVariantId,
        sourceLocationId: order.sourceLocationId,
        targetLocationId: order.targetLocationId,
        plannedQuantity: Number(order.plannedQuantity),
        ...executionPermissionsFor(order.status),
      }
    },
  }
}
