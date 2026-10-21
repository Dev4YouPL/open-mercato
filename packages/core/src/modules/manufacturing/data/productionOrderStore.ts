import type { EntityManager } from '@mikro-orm/postgresql'
import { formatOrderNumber, INITIAL_ORDER_STATUS } from '../domain/productionOrder'
import type { ProductionOrderStore } from '../ports/productionOrderStore'
import { ProductionOrder } from './entities'
import { ManufacturingBom } from './entities'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assertReadCommitted, lockBomFamily } from './bomUsageReader'
import { isBomSelectableForNewOrder } from './bomStatus'
import { claimSequence } from './sequences'

export type MikroProductionOrderStoreOptions = {
  em: EntityManager
}

export function createMikroProductionOrderStore({ em }: MikroProductionOrderStoreOptions): ProductionOrderStore {
  return {
    async create(order, scope) {
      return em.fork().transactional(async (tx) => {
        await assertReadCommitted(tx)
        await lockBomFamily(tx, scope, order.productVariantId)
        const revision = await findOneWithDecryption(tx, ManufacturingBom, {
          id: order.bomRevisionId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_READ, refresh: true }, scope)
        if (!revision || revision.outputVariantId !== order.productVariantId || !isBomSelectableForNewOrder(revision)) {
          return { status: 'revision_unavailable' } as const
        }
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

        return { status: 'created', id: row.id, orderNumber: row.orderNumber } as const
      })
    },
  }
}
