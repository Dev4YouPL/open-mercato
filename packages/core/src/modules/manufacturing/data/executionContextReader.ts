import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { orderExecutionContext, standaloneExecutionContext } from '../domain/executionContext'
import type { ExecutionContextReader } from '../ports/executionContextReader'
import type { ProductionOrderReader } from '../ports/productionOrderReader'
import { ProductionExecution } from './entities'

export type MikroExecutionContextReaderOptions = {
  em: EntityManager
  productionOrderReader: ProductionOrderReader
}

export function createMikroExecutionContextReader({
  em,
  productionOrderReader,
}: MikroExecutionContextReaderOptions): ExecutionContextReader {
  return {
    async getContext(executionId, scope) {
      const execution = await findOneWithDecryption(
        em.fork(),
        ProductionExecution,
        { ...scope, id: executionId, deletedAt: null },
        undefined,
        scope,
      )

      if (!execution) return null

      if (!execution.orderId) {
        return standaloneExecutionContext({
          id: execution.id,
          productVariantId: execution.productVariantId ?? null,
          sourceLocationId: execution.sourceLocationId ?? null,
          targetLocationId: execution.targetLocationId ?? null,
        })
      }

      const order = await productionOrderReader.getForExecution(execution.orderId, scope)

      if (!order) throw new Error(`[internal] production execution ${execution.id} points at missing order ${execution.orderId}`)

      return orderExecutionContext(execution.id, order)
    },
  }
}
