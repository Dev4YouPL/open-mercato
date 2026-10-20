import type { EntityManager } from '@mikro-orm/postgresql'
import { formatOrderNumber, INITIAL_ORDER_STATUS } from '../domain/productionOrder'
import type { ProductionOrderStore } from '../ports/productionOrderStore'
import { ProductionOrder } from './entities'

export type MikroProductionOrderStoreOptions = {
  em: EntityManager
}

type SequenceRow = { sequence: number | string }

const CLAIM_ORDER_SEQUENCE_SQL = `
  insert into manufacturing_order_sequences (id, organization_id, tenant_id, next_number, created_at, updated_at)
  values (gen_random_uuid(), ?, ?, 2, now(), now())
  on conflict (tenant_id, organization_id)
  do update set next_number = manufacturing_order_sequences.next_number + 1, updated_at = now()
  returning next_number - 1 as sequence
`

async function claimOrderSequence(em: EntityManager, organizationId: string, tenantId: string): Promise<number> {
  const rows = await em.execute<SequenceRow[]>(CLAIM_ORDER_SEQUENCE_SQL, [organizationId, tenantId], 'all')
  const sequence = Number(rows[0]?.sequence)

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`[internal] manufacturing order sequence returned ${String(rows[0]?.sequence)}`)
  }

  return sequence
}

export function createMikroProductionOrderStore({ em }: MikroProductionOrderStoreOptions): ProductionOrderStore {
  return {
    async create(order, scope) {
      return em.fork().transactional(async (tx) => {
        const sequence = await claimOrderSequence(tx, scope.organizationId, scope.tenantId)
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
