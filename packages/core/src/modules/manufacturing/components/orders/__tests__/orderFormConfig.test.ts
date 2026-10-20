/** @jest-environment node */

import { buildCreateOrderPayload, toBomRevisionOptions, toLocationOptions, type BomRevisionOption } from '../orderFormConfig'

const revisions: BomRevisionOption[] = [{ value: 'revision-1', label: 'R1 · table', productVariantId: 'table' }]

describe('production order form config', () => {
  it('maps released BOM revisions to options that remember the product variant', () => {
    expect(toBomRevisionOptions({ items: [{ id: 'revision-1', outputVariantId: 'table', revision: 'R1', status: 'released' }] })).toEqual(
      revisions,
    )
  })

  it('maps WMS locations to warehouse and location labels', () => {
    expect(
      toLocationOptions({
        items: [
          { id: 'location-1', code: 'A-1', warehouse_code: 'WH1' },
          { id: 'location-2', code: 'B-1', warehouse_code: null, warehouse_name: null },
        ],
      }),
    ).toEqual([
      { value: 'location-1', label: 'WH1 / A-1' },
      { value: 'location-2', label: 'B-1' },
    ])
  })

  it('returns no options for an unexpected response', () => {
    expect(toBomRevisionOptions({ data: [] })).toEqual([])
    expect(toLocationOptions(null)).toEqual([])
  })

  it('builds the payload with the product variant taken from the selected revision', () => {
    expect(
      buildCreateOrderPayload(
        {
          bomRevisionId: 'revision-1',
          plannedQuantity: '12,5',
          sourceLocationId: 'location-1',
          targetLocationId: 'location-2',
          dueAt: '2026-11-30',
        },
        revisions,
        'pl',
      ),
    ).toEqual({
      status: 'valid',
      payload: {
        productVariantId: 'table',
        bomRevisionId: 'revision-1',
        plannedQuantity: 12.5,
        sourceLocationId: 'location-1',
        targetLocationId: 'location-2',
        dueAt: new Date('2026-11-30'),
      },
    })
  })

  it('leaves the due date empty when it is not set', () => {
    const built = buildCreateOrderPayload(
      { bomRevisionId: 'revision-1', plannedQuantity: '1', sourceLocationId: 'a', targetLocationId: 'b' },
      revisions,
    )

    expect(built.status === 'valid' && built.payload.dueAt).toBeNull()
  })

  it('reports every missing field and an unparsable quantity', () => {
    expect(buildCreateOrderPayload({ plannedQuantity: 'abc' }, revisions)).toEqual({
      status: 'invalid',
      fieldErrors: {
        bomRevisionId: 'required',
        plannedQuantity: 'invalidQuantity',
        sourceLocationId: 'required',
        targetLocationId: 'required',
      },
    })
  })
})
