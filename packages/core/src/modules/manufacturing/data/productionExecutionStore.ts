import type { EntityManager } from '@mikro-orm/postgresql'
import { formatExecutionNumber } from '../domain/productionExecution'
import type { ProductionExecutionStore } from '../ports/productionExecutionStore'
import { ProductionExecution } from './entities'
import { claimSequence } from './sequences'

export type MikroProductionExecutionStoreOptions = {
  em: EntityManager
}

export function createMikroProductionExecutionStore({ em }: MikroProductionExecutionStoreOptions): ProductionExecutionStore {
  return {
    async create(execution, scope) {
      return em.fork().transactional(async (tx) => {
        const sequence = await claimSequence(tx, 'manufacturing_execution_sequences', scope.organizationId, scope.tenantId)
        const row = tx.create(ProductionExecution, { ...scope, ...execution, executionNumber: formatExecutionNumber(sequence) })

        tx.persist(row)
        await tx.flush()

        return { id: row.id, executionNumber: row.executionNumber }
      })
    },
  }
}
