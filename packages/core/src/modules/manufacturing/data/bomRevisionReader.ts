import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { roundQuantity } from '../domain/quantity'
import type { BomRevisionReader } from '../ports/bomRevisionReader'
import { isBomSelectableForNewOrder, isBomStatusUsableInOrder } from './bomStatus'
import { ManufacturingBom, ManufacturingBomItem } from './entities'

export type MikroBomRevisionReaderOptions = {
  em: EntityManager
}

export function createMikroBomRevisionReader({ em }: MikroBomRevisionReaderOptions): BomRevisionReader {
  return {
    async getForOrder(revisionId, scope) {
      const reader = em.fork()
      const bom = await findOneWithDecryption(
        reader,
        ManufacturingBom,
        { ...scope, id: revisionId, deletedAt: null },
        undefined,
        scope,
      )

      if (!bom) return null

      const items = await findWithDecryption(
        reader,
        ManufacturingBomItem,
        { ...scope, bom: bom.id, deletedAt: null },
        { orderBy: { position: 'asc' } },
        scope,
      )
      const baseQuantity = Number(bom.baseQuantity)

      return {
        id: bom.id,
        productVariantId: bom.outputVariantId,
        isReleased: isBomStatusUsableInOrder(bom.status),
        isAvailable: isBomSelectableForNewOrder(bom),
        components: items.map((item) => ({
          variantId: item.componentVariantId,
          quantity: roundQuantity(Number(item.quantity) / baseQuantity),
        })),
      }
    },
  }
}
