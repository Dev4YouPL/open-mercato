import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ExecutionDocumentDto, ExecutionHistoryReader, ProductionFactDto } from '../ports/executionHistoryReader'
import { ExecutionDocument, ProductionFact } from './entities'

export type MikroExecutionHistoryReaderOptions = {
  em: EntityManager
}

function toFact(row: ProductionFact): ProductionFactDto {
  return {
    id: row.id,
    factKind: row.factKind,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    quantity: Number(row.quantity),
    movementId: row.movementId ?? null,
  }
}

function toDocument(row: ExecutionDocument, facts: ProductionFactDto[]): ExecutionDocumentDto {
  return {
    id: row.id,
    documentType: row.documentType,
    orderId: row.orderId,
    operationId: row.operationId,
    postedBy: row.postedBy,
    postedAt: row.postedAt,
    facts,
  }
}

export function createMikroExecutionHistoryReader({ em }: MikroExecutionHistoryReaderOptions): ExecutionHistoryReader {
  return {
    async listForOrder(orderId, scope) {
      const fork = em.fork()
      const documents = await findWithDecryption(
        fork,
        ExecutionDocument,
        { ...scope, orderId },
        { orderBy: { postedAt: 'asc', id: 'asc' } },
        scope,
      )

      if (documents.length === 0) return []

      const facts = await findWithDecryption(
        fork,
        ProductionFact,
        { ...scope, document: { $in: documents.map((document) => document.id) } },
        { orderBy: { createdAt: 'asc', id: 'asc' } },
        scope,
      )

      return documents.map((document) =>
        toDocument(
          document,
          facts.filter((fact) => fact.document.id === document.id).map(toFact),
        ),
      )
    },
  }
}
