import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ManufacturingScope } from '../domain/manufacturingScope'
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

function toDocument(row: ExecutionDocument, facts: ProductionFactDto[], reversedByDocumentId: string | null): ExecutionDocumentDto {
  return {
    id: row.id,
    documentType: row.documentType,
    orderId: row.orderId,
    operationId: row.operationId,
    postedBy: row.postedBy,
    postedAt: row.postedAt,
    reversesDocumentId: row.reversesDocumentId ?? null,
    reversedByDocumentId,
    facts,
  }
}

async function readFacts(em: EntityManager, documentIds: string[], scope: ManufacturingScope): Promise<ProductionFact[]> {
  return findWithDecryption(
    em,
    ProductionFact,
    { ...scope, document: { $in: documentIds } },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
    scope,
  )
}

function factsOf(facts: ProductionFact[], documentId: string): ProductionFactDto[] {
  return facts.filter((fact) => fact.document.id === documentId).map(toFact)
}

async function listForOrder(em: EntityManager, orderId: string, scope: ManufacturingScope): Promise<ExecutionDocumentDto[]> {
  const documents = await findWithDecryption(
    em,
    ExecutionDocument,
    { ...scope, orderId },
    { orderBy: { postedAt: 'asc', id: 'asc' } },
    scope,
  )

  if (documents.length === 0) return []

  const facts = await readFacts(em, documents.map((document) => document.id), scope)
  const reversedBy = new Map(
    documents
      .filter((document) => document.reversesDocumentId)
      .map((document) => [document.reversesDocumentId, document.id]),
  )

  return documents.map((document) =>
    toDocument(document, factsOf(facts, document.id), reversedBy.get(document.id) ?? null),
  )
}

async function getDocument(em: EntityManager, documentId: string, scope: ManufacturingScope): Promise<ExecutionDocumentDto | null> {
  const document = await findOneWithDecryption(em, ExecutionDocument, { ...scope, id: documentId }, undefined, scope)

  if (!document) return null

  const facts = await readFacts(em, [document.id], scope)
  const reversal = await findOneWithDecryption(em, ExecutionDocument, { ...scope, reversesDocumentId: document.id }, undefined, scope)

  return toDocument(document, factsOf(facts, document.id), reversal?.id ?? null)
}

export function createMikroExecutionHistoryReader({ em }: MikroExecutionHistoryReaderOptions): ExecutionHistoryReader {
  return {
    listForOrder: (orderId, scope) => listForOrder(em.fork(), orderId, scope),
    getDocument: (documentId, scope) => getDocument(em.fork(), documentId, scope),
  }
}
