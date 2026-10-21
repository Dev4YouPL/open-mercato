import type { EntityManager } from '@mikro-orm/postgresql'
import { formatOrderNumber, INITIAL_ORDER_STATUS } from '../domain/productionOrder'
import type { ProductionOrderStore } from '../ports/productionOrderStore'
import { ProductionOrder } from './entities'
import { claimSequence } from './sequences'

export type MikroProductionOrderStoreOptions = {
  em: EntityManager
}

export function createMikroProductionOrderStore({ em }: MikroProductionOrderStoreOptions): ProductionOrderStore {
  return {
    async create(order, scope) {
      return em.fork().transactional(async (tx) => {
        const sequence = await claimSequence(tx, 'manufacturing_order_sequences', scope.organizationId, scope.tenantId)
        const row = tx.create(ProductionOrder, {
          ...scope,
          ...order,
          orderNumber: formatOrderNumber(sequence),
          plannedQuantity: String(order.plannedQuantity),
          status: INITIAL_ORDER_STATUS,
        })

        tx.persist(row)
        await tx.flush()

        return { id: row.id, orderNumber: row.orderNumber }
      })
    },
  }
}
