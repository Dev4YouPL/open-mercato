import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

import { ManufacturingBom } from '../../data/entities'
import { loadFreshCatalogVariantSummary } from '../catalogVariants'
import { requireBomForNewOrder } from '../bomOrderSelection'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../catalogVariants', () => ({
  loadFreshCatalogVariantSummary: jest.fn(),
}))

const findBom = jest.mocked(findOneWithDecryption)
const loadVariant = jest.mocked(loadFreshCatalogVariantSummary)
const em = {} as EntityManager
const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const bomId = '33333333-3333-4333-8333-333333333333'
const variantId = '44444444-4444-4444-8444-444444444444'
const translate = (key: string) => key

function createBom(status: 'draft' | 'released', isAvailableForNewOrders = true) {
  const bom = new ManufacturingBom()
  bom.id = bomId
  bom.tenantId = scope.tenantId
  bom.organizationId = scope.organizationId
  bom.outputVariantId = variantId
  bom.status = status
  bom.isAvailableForNewOrders = isAvailableForNewOrders
  return bom
}

describe('requireBomForNewOrder', () => {
  beforeEach(() => {
    findBom.mockReset()
    loadVariant.mockReset()
  })

  it('returns a released, available revision after a fresh scoped read', async () => {
    const bom = createBom('released')
    findBom.mockResolvedValue(bom)
    loadVariant.mockResolvedValue({ id: variantId, name: 'Output', sku: 'OUT', isActive: true, isDeleted: false })
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).resolves.toBe(bom)
    expect(findBom).toHaveBeenCalledWith(em, ManufacturingBom, {
      id: bomId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }, { lockMode: LockMode.PESSIMISTIC_READ, refresh: true }, scope)
  })

  it('rejects a withdrawn revision with its reason', async () => {
    findBom.mockResolvedValue(createBom('released', false))
    loadVariant.mockResolvedValue({ id: variantId, name: 'Output', sku: 'OUT', isActive: true, isDeleted: false })
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).rejects.toMatchObject({
      status: 422,
      body: { code: 'manufacturing.bom.unavailable_for_new_orders', reason: 'withdrawn' },
    })
  })

  it('rejects a draft with reason draft', async () => {
    findBom.mockResolvedValue(createBom('draft'))
    loadVariant.mockResolvedValue({ id: variantId, name: 'Output', sku: 'OUT', isActive: true, isDeleted: false })
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).rejects.toMatchObject({
      status: 422,
      body: { reason: 'draft' },
    })
  })

  it('reports an inactive catalog variant as unavailable', async () => {
    findBom.mockResolvedValue(createBom('released'))
    loadVariant.mockResolvedValue({ id: variantId, name: 'Output', sku: 'OUT', isActive: false, isDeleted: false })
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).rejects.toMatchObject({
      status: 422,
      body: { reason: 'variantInactive' },
    })
  })

  it('reports a missing catalog variant as unavailable', async () => {
    findBom.mockResolvedValue(createBom('released'))
    loadVariant.mockResolvedValue(null)
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).rejects.toMatchObject({
      status: 422,
      body: { reason: 'variantMissing' },
    })
  })

  it('returns not found when the BOM is outside the current scope or missing', async () => {
    findBom.mockResolvedValue(null)
    await expect(requireBomForNewOrder(em, bomId, scope, translate)).rejects.toMatchObject({ status: 404 })
    expect(loadVariant).not.toHaveBeenCalled()
  })
})
