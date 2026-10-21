/** @jest-environment node */

import { buildCreateExecutionPayload, toOrderOptions } from '../executionFormConfig'

describe('execution form config', () => {
  it('drops product and locations when an order is chosen', () => {
    expect(
      buildCreateExecutionPayload({ orderId: 'order-1', productVariantId: 'chair', sourceLocationId: 'a', targetLocationId: 'b' }),
    ).toEqual({ orderId: 'order-1', productVariantId: null, sourceLocationId: null, targetLocationId: null })
  })

  it('keeps product and locations of a standalone execution', () => {
    expect(buildCreateExecutionPayload({ orderId: '', productVariantId: 'chair', sourceLocationId: 'a' })).toEqual({
      orderId: null,
      productVariantId: 'chair',
      sourceLocationId: 'a',
      targetLocationId: null,
    })
  })

  it('maps orders to options by number', () => {
    expect(toOrderOptions({ items: [{ id: 'order-1', orderNumber: 'PO-000001', status: 'draft' }] })).toEqual([
      { value: 'order-1', label: 'PO-000001' },
    ])
    expect(toOrderOptions(null)).toEqual([])
  })
})
