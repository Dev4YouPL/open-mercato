/** @jest-environment node */

import type { PlannedMovement } from '../../domain/movement'
import { executionPermissionsFor } from '../../domain/orderExecutionPermissions'
import type { PositiveQuantity } from '../../domain/quantity'
import type { ReversibleDocument } from '../../domain/reversal'
import type { InventoryGateway, InventoryMovementResultDto } from '../../ports/inventoryGateway'
import type {
  InventoryLocationDto,
  InventoryPolicyReader,
  TrackingPolicyResultDto,
} from '../../ports/inventoryPolicyReader'
import type { ExecutionContext } from '../../domain/executionContext'
import type { ExecutionContextReader } from '../../ports/executionContextReader'
import {
  createProductionInventoryService,
  type MaterialMovementInput,
  type ProductionConfirmationInput,
} from '../productionInventoryService'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const accepted: InventoryMovementResultDto = { status: 'accepted', movementId: 'movement-1' }
const untracked: TrackingPolicyResultDto = {
  status: 'resolved',
  policy: { tracksLot: false, tracksSerial: false, tracksExpiry: false },
}
const lotTracked: TrackingPolicyResultDto = {
  status: 'resolved',
  policy: { tracksLot: true, tracksSerial: false, tracksExpiry: false },
}

const locations: Record<string, InventoryLocationDto> = {
  'issue-location': { id: 'issue-location', warehouseId: 'warehouse-1', code: 'A-1', type: 'bin' },
  'receipt-location': { id: 'receipt-location', warehouseId: 'warehouse-2', code: 'B-1', type: 'bin' },
}

const openOrder: ExecutionContext = {
  executionId: 'execution-1',
  orderId: 'order-1',
  productVariantId: 'product-variant-1',
  sourceLocationId: 'issue-location',
  targetLocationId: 'receipt-location',
  plannedQuantity: 10,
  allowsIssue: true,
  allowsReturn: true,
  allowsConfirmation: true,
}

const closedOrder: ExecutionContext = { ...openOrder, allowsIssue: false, allowsReturn: false, allowsConfirmation: false }

const standalone: ExecutionContext = { ...openOrder, orderId: null, plannedQuantity: null }

const materialInput: MaterialMovementInput = { executionId: 'execution-1', variantId: 'material-variant-1', quantity: 4 }
const confirmationInput: ProductionConfirmationInput = { executionId: 'execution-1', goodQuantity: 8, scrapQuantity: 0 }

const issuedDocument: ReversibleDocument = {
  id: 'document-1',
  executionId: 'execution-1',
  orderId: 'order-1',
  reversedByDocumentId: null,
  facts: [
    {
      factKind: 'material_consumed',
      variantId: 'material-variant-1',
      warehouseId: 'snapshot-warehouse',
      locationId: 'snapshot-location',
      quantity: 4,
      movementId: 'movement-1',
    },
  ],
}

function buildService(context: ExecutionContext | null = openOrder, tracking: TrackingPolicyResultDto = untracked) {
  const postMovement = jest.fn(async () => accepted)
  const getContext = jest.fn(async () => context)
  const getTrackingPolicy = jest.fn(async () => tracking)
  const getActiveLocation = jest.fn(async (locationId: string) => locations[locationId] ?? null)
  const inventoryGateway: InventoryGateway = { postMovement }
  const inventoryPolicyReader: InventoryPolicyReader = {
    getTrackingPolicy,
    getActiveLocation,
    listActiveLocations: jest.fn(async () => []),
  }
  const executionContextReader: ExecutionContextReader = { getContext }
  const service = createProductionInventoryService({ inventoryGateway, inventoryPolicyReader, executionContextReader, scope })
  return { service, postMovement, getContext, getTrackingPolicy, getActiveLocation }
}

describe('production inventory service', () => {
  describe('material issue and return', () => {
    it.each([
      ['planIssueMaterial', 'issue', 'consume', 'material_consumed'],
      ['planReturnMaterial', 'return', 'restock', 'material_returned'],
    ] as const)('%s plans a %s document with a %s movement at the order issue location', async (action, documentType, kind, factKind) => {
      const { service } = buildService()
      const snapshot = { variantId: 'material-variant-1', warehouseId: 'warehouse-1', locationId: 'issue-location', quantity: 4 }

      expect(await service[action](materialInput)).toEqual({
        status: 'planned',
        plan: {
          documentType,
          orderId: 'order-1',
          movement: { kind, ...snapshot },
          facts: [{ factKind, ...snapshot, moves: true }],
        },
      })
    })

    it('reads the order and the location within the service scope', async () => {
      const { service, getContext, getActiveLocation } = buildService()
      await service.planIssueMaterial(materialInput)

      expect(getContext).toHaveBeenCalledWith('execution-1', scope)
      expect(getActiveLocation).toHaveBeenCalledWith('issue-location', scope)
    })

    it.each(['planIssueMaterial', 'planReturnMaterial'] as const)('refuses %s when the order does not allow it', async (action) => {
      const { service } = buildService(closedOrder)

      expect(await service[action](materialInput)).toMatchObject({ status: 'rejected', code: 'action_not_allowed' })
    })

    it('refuses when the order does not exist', async () => {
      const { service } = buildService(null)

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({ status: 'rejected', code: 'execution_not_found' })
    })

    it('allows a return on a cancelled order while refusing a new issue and confirmation', async () => {
      const { service } = buildService({ ...openOrder, ...executionPermissionsFor('cancelled') })

      expect(await service.planReturnMaterial(materialInput)).toMatchObject({
        status: 'planned',
        plan: { documentType: 'return', movement: { kind: 'restock', locationId: 'issue-location' } },
      })
      expect(await service.planIssueMaterial(materialInput)).toMatchObject({ code: 'action_not_allowed' })
      expect(await service.planConfirmProduction(confirmationInput)).toMatchObject({ code: 'action_not_allowed' })
    })

    it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('refuses quantity %p before reading the order', async (quantity) => {
      const { service, getContext } = buildService()
      const result = await service.planReturnMaterial({ ...materialInput, quantity })

      expect(getContext).not.toHaveBeenCalled()
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid_quantity' })
    })

    it('refuses a quantity with more than four decimal places before reading the order', async () => {
      const { service, getContext } = buildService()

      expect(await service.planIssueMaterial({ ...materialInput, quantity: 1.23456 })).toEqual({
        status: 'rejected',
        code: 'quantity_too_precise',
        message: 'Quantities may have at most 4 decimal places.',
      })
      expect(getContext).not.toHaveBeenCalled()
    })

    it('accepts a quantity with exactly four decimal places', async () => {
      const { service } = buildService()

      expect(await service.planIssueMaterial({ ...materialInput, quantity: 1.2345 })).toMatchObject({ status: 'planned' })
    })

    it('refuses when the order has no issue location', async () => {
      const { service } = buildService({ ...openOrder, sourceLocationId: null })

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({ status: 'rejected', code: 'location_missing' })
    })

    it('refuses when the order location is missing or inactive in WMS', async () => {
      const { service } = buildService({ ...openOrder, sourceLocationId: 'deleted-location' })

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({
        status: 'rejected',
        code: 'location_unavailable',
      })
    })

    it.each([
      ['lot', { tracksLot: true, tracksSerial: false, tracksExpiry: false }],
      ['serial number', { tracksLot: false, tracksSerial: true, tracksExpiry: false }],
      ['expiry date', { tracksLot: false, tracksSerial: false, tracksExpiry: true }],
    ])('refuses a material tracked by %s', async (_label, policy) => {
      const { service, getTrackingPolicy } = buildService(openOrder, { status: 'resolved', policy })

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({
        status: 'rejected',
        code: 'tracking_not_supported',
      })
      expect(getTrackingPolicy).toHaveBeenCalledWith('material-variant-1', scope)
    })

    it('refuses when the inventory policy is unavailable', async () => {
      const { service } = buildService(openOrder, { status: 'unavailable' })

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({
        status: 'rejected',
        code: 'inventory_unavailable',
      })
    })
  })

  describe('production confirmation', () => {
    const receipt = { variantId: 'product-variant-1', warehouseId: 'warehouse-2', locationId: 'receipt-location' }

    it('plans a receipt of the good quantity of the order product at the order receipt location', async () => {
      const { service } = buildService()

      expect(await service.planConfirmProduction(confirmationInput)).toEqual({
        status: 'planned',
        plan: {
          documentType: 'confirmation',
          orderId: 'order-1',
          movement: { kind: 'receiveOutput', ...receipt, quantity: 8 },
          facts: [{ factKind: 'output_received', ...receipt, quantity: 8, moves: true }],
        },
      })
    })

    it('records scrap next to the receipt without moving it into stock', async () => {
      const { service } = buildService()

      expect(await service.planConfirmProduction({ ...confirmationInput, scrapQuantity: 2 })).toEqual({
        status: 'planned',
        plan: {
          documentType: 'confirmation',
          orderId: 'order-1',
          movement: { kind: 'receiveOutput', ...receipt, quantity: 8 },
          facts: [
            { factKind: 'output_received', ...receipt, quantity: 8, moves: true },
            {
              factKind: 'scrap_recorded',
              variantId: 'product-variant-1',
              warehouseId: null,
              locationId: null,
              quantity: 2,
              moves: false,
            },
          ],
        },
      })
    })

    it('plans a scrap-only confirmation without any movement, location or WMS policy lookup', async () => {
      const { service, getActiveLocation, getTrackingPolicy } = buildService({ ...openOrder, targetLocationId: null })

      expect(await service.planConfirmProduction({ ...confirmationInput, goodQuantity: 0, scrapQuantity: 3 })).toEqual({
        status: 'planned',
        plan: {
          documentType: 'confirmation',
          orderId: 'order-1',
          movement: null,
          facts: [
            {
              factKind: 'scrap_recorded',
              variantId: 'product-variant-1',
              warehouseId: null,
              locationId: null,
              quantity: 3,
              moves: false,
            },
          ],
        },
      })
      expect(getActiveLocation).not.toHaveBeenCalled()
      expect(getTrackingPolicy).not.toHaveBeenCalled()
    })

    it.each([
      ['both quantities are zero', 0, 0],
      ['the good quantity is negative', -1, 2],
      ['the scrap quantity is negative', 2, -1],
      ['the good quantity is not a number', Number.NaN, 0],
    ])('refuses when %s', async (_label, goodQuantity, scrapQuantity) => {
      const { service, getContext } = buildService()

      expect(await service.planConfirmProduction({ executionId: 'execution-1', goodQuantity, scrapQuantity })).toMatchObject({
        status: 'rejected',
        code: 'invalid_quantity',
      })
      expect(getContext).not.toHaveBeenCalled()
    })

    it.each([
      ['good', { goodQuantity: 1.00001, scrapQuantity: 0 }],
      ['scrap', { goodQuantity: 1, scrapQuantity: 0.00001 }],
    ])('refuses a %s quantity with more than four decimal places', async (_label, quantities) => {
      const { service } = buildService()

      expect(await service.planConfirmProduction({ executionId: 'execution-1', ...quantities })).toMatchObject({
        status: 'rejected',
        code: 'quantity_too_precise',
      })
    })

    it('refuses when the order does not allow confirmation, even for scrap only', async () => {
      const { service } = buildService(closedOrder)

      expect(await service.planConfirmProduction({ ...confirmationInput, goodQuantity: 0, scrapQuantity: 1 })).toMatchObject({
        status: 'rejected',
        code: 'action_not_allowed',
      })
    })

    it('refuses a good quantity of a tracked product', async () => {
      const { service, getTrackingPolicy } = buildService(openOrder, lotTracked)

      expect(await service.planConfirmProduction(confirmationInput)).toMatchObject({
        status: 'rejected',
        code: 'tracking_not_supported',
      })
      expect(getTrackingPolicy).toHaveBeenCalledWith('product-variant-1', scope)
    })

    it('refuses a good quantity when the order has no receipt location', async () => {
      const { service } = buildService({ ...openOrder, targetLocationId: null })

      expect(await service.planConfirmProduction(confirmationInput)).toMatchObject({
        status: 'rejected',
        code: 'location_missing',
      })
    })
  })

  describe('standalone execution', () => {
    it('plans material and output at the execution locations without an order', async () => {
      const { service } = buildService(standalone)

      expect(await service.planIssueMaterial(materialInput)).toMatchObject({
        status: 'planned',
        plan: { orderId: null, movement: { locationId: 'issue-location' } },
      })
      expect(await service.planConfirmProduction(confirmationInput)).toMatchObject({
        status: 'planned',
        plan: { orderId: null, movement: { variantId: 'product-variant-1', locationId: 'receipt-location' } },
      })
    })

    it('refuses to confirm production on an execution without a product variant', async () => {
      const { service } = buildService({ ...standalone, productVariantId: null })

      expect(await service.planConfirmProduction(confirmationInput)).toMatchObject({
        status: 'rejected',
        code: 'product_variant_missing',
      })
      expect(await service.planIssueMaterial(materialInput)).toMatchObject({ status: 'planned' })
    })

    it('refuses material actions on an execution without an issue location', async () => {
      const { service } = buildService({ ...standalone, sourceLocationId: null })

      expect(await service.planReturnMaterial(materialInput)).toMatchObject({ status: 'rejected', code: 'location_missing' })
    })
  })

  describe('document reversal', () => {
    it('plans the opposite document from the snapshot regardless of order flags and current locations', async () => {
      const { service, getActiveLocation, getTrackingPolicy } = buildService(closedOrder)
      const snapshot = { variantId: 'material-variant-1', warehouseId: 'snapshot-warehouse', locationId: 'snapshot-location', quantity: 4 }

      expect(await service.planReverseDocument(issuedDocument)).toEqual({
        status: 'planned',
        plan: {
          documentType: 'reversal',
          orderId: 'order-1',
          movement: { kind: 'restock', ...snapshot },
          facts: [{ factKind: 'material_returned', ...snapshot, moves: true }],
        },
      })
      expect(getActiveLocation).not.toHaveBeenCalled()
      expect(getTrackingPolicy).not.toHaveBeenCalled()
    })

    it('refuses when the order does not exist', async () => {
      const { service } = buildService(null)

      expect(await service.planReverseDocument(issuedDocument)).toMatchObject({ status: 'rejected', code: 'execution_not_found' })
    })

    it('refuses to reverse a document twice', async () => {
      const { service } = buildService()

      expect(await service.planReverseDocument({ ...issuedDocument, reversedByDocumentId: 'document-2' })).toMatchObject({
        status: 'rejected',
        code: 'document_already_reversed',
      })
    })

    it('refuses to reverse a document that the one-movement profile cannot mirror', async () => {
      const { service } = buildService()
      const [fact] = issuedDocument.facts

      expect(await service.planReverseDocument({ ...issuedDocument, facts: [fact, fact] })).toMatchObject({
        status: 'rejected',
        code: 'reversal_not_supported',
      })
    })
  })

  it('never posts while planning', async () => {
    const { service, postMovement } = buildService()
    await service.planIssueMaterial(materialInput)
    await service.planConfirmProduction(confirmationInput)
    await service.planReverseDocument(issuedDocument)

    expect(postMovement).not.toHaveBeenCalled()
  })

  it('posts a planned movement under the operation id and passes the gateway result through', async () => {
    const { service, postMovement } = buildService()
    const movement: PlannedMovement = {
      kind: 'consume',
      variantId: 'material-variant-1',
      warehouseId: 'warehouse-1',
      locationId: 'issue-location',
      quantity: 4 as PositiveQuantity,
    }
    const unknown: InventoryMovementResultDto = { status: 'unknown', cause: new Error('timeout') }
    postMovement.mockResolvedValueOnce(unknown)

    expect(await service.postMovement('operation-1', movement)).toBe(unknown)
    expect(postMovement).toHaveBeenCalledWith({ operationId: 'operation-1', ...movement })
  })
})
