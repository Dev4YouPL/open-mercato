import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ManufacturingScope } from '../domain/manufacturingScope'
import type { ExecutionDocumentListItem, ProductionExecutionListItem } from './validators'
import { ExecutionDocument, ProductionFact, ProductionOrder } from './entities'

function uniqueIds(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export async function attachOrderDetails(
  em: EntityManager,
  items: ProductionExecutionListItem[],
  scope: ManufacturingScope,
): Promise<ProductionExecutionListItem[]> {
  const orderIds = uniqueIds(items.map((item) => item.orderId))

  if (orderIds.length === 0) return items

  const orders = await findWithDecryption(em, ProductionOrder, { ...scope, id: { $in: orderIds } }, undefined, scope)
  const ordersById = new Map(orders.map((order) => [order.id, order]))

  return items.map((item) => {
    const order = item.orderId ? ordersById.get(item.orderId) : undefined

    if (!order) return item

    return {
      ...item,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      plannedQuantity: Number(order.plannedQuantity),
      productVariantId: order.productVariantId,
      sourceLocationId: order.sourceLocationId,
      targetLocationId: order.targetLocationId,
    }
  })
}

export async function attachDocumentDetails(
  em: EntityManager,
  items: ExecutionDocumentListItem[],
  scope: ManufacturingScope,
): Promise<ExecutionDocumentListItem[]> {
  const documentIds = items.map((item) => item.id)

  if (documentIds.length === 0) return items

  const facts = await findWithDecryption(
    em,
    ProductionFact,
    { ...scope, document: { $in: documentIds } },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
    scope,
  )
  const reversals = await findWithDecryption(
    em,
    ExecutionDocument,
    { ...scope, reversesDocumentId: { $in: documentIds } },
    undefined,
    scope,
  )
  const reversedBy = new Map(reversals.map((reversal) => [reversal.reversesDocumentId, reversal.id]))

  return items.map((item) => ({
    ...item,
    reversedByDocumentId: reversedBy.get(item.id) ?? null,
    facts: facts
      .filter((fact) => fact.document.id === item.id)
      .map((fact) => ({
        id: fact.id,
        factKind: fact.factKind,
        variantId: fact.variantId,
        warehouseId: fact.warehouseId ?? null,
        locationId: fact.locationId ?? null,
        quantity: Number(fact.quantity),
        movementId: fact.movementId ?? null,
      })),
  }))
}
