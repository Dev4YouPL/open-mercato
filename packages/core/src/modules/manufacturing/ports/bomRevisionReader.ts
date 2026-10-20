import type { AwilixContainer } from 'awilix'
import type { ManufacturingScope } from '../domain/manufacturingScope'

export const BOM_REVISION_READER_DI_KEY = 'manufacturingBomRevisionReader'

export type BomComponentDto = {
  variantId: string
  quantity: number
}

export type BomRevisionForOrderDto = {
  id: string
  productVariantId: string
  isReleased: boolean
  isAvailable: boolean
  components: BomComponentDto[]
}

export interface BomRevisionReader {
  getForOrder(revisionId: string, scope: ManufacturingScope): Promise<BomRevisionForOrderDto | null>
}

export function resolveBomRevisionReader(container: AwilixContainer): BomRevisionReader {
  return container.resolve<BomRevisionReader>(BOM_REVISION_READER_DI_KEY)
}
