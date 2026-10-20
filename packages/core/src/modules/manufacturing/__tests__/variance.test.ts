/** @jest-environment node */

import {
  computeMaterialVariances,
  computeOutputVariance,
  hasMaterialVariance,
  type RecordedFact,
} from '../domain/variance'

function fact(factKind: RecordedFact['factKind'], variantId: string, quantity: number): RecordedFact {
  return { factKind, variantId, quantity }
}

describe('material variances', () => {
  it('reports no variance when the net issue matches the plan', () => {
    const [variance] = computeMaterialVariances([{ variantId: 'leg', plannedQuantity: 4 }], [fact('material_consumed', 'leg', 4)])

    expect(variance).toEqual({ variantId: 'leg', inPlan: true, plannedQuantity: 4, issuedQuantity: 4, difference: 0 })
    expect(hasMaterialVariance(variance)).toBe(false)
  })

  it('nets returns and reversals against issues', () => {
    const [variance] = computeMaterialVariances(
      [{ variantId: 'leg', plannedQuantity: 4 }],
      [
        fact('material_consumed', 'leg', 6),
        fact('material_returned', 'leg', 1),
        fact('material_consumed', 'leg', 2),
        fact('material_returned', 'leg', 2),
      ],
    )

    expect(variance).toMatchObject({ issuedQuantity: 5, difference: 1 })
    expect(hasMaterialVariance(variance)).toBe(true)
  })

  it('shows planned materials that were not issued yet as a negative difference', () => {
    expect(computeMaterialVariances([{ variantId: 'screw', plannedQuantity: 16 }], [])).toEqual([
      { variantId: 'screw', inPlan: true, plannedQuantity: 16, issuedQuantity: 0, difference: -16 },
    ])
  })

  it('shows a material outside the plan as a variance without blocking anything', () => {
    const variances = computeMaterialVariances([{ variantId: 'leg', plannedQuantity: 4 }], [fact('material_consumed', 'glue', 0.5)])

    expect(variances[1]).toEqual({ variantId: 'glue', inPlan: false, plannedQuantity: 0, issuedQuantity: 0.5, difference: 0.5 })
    expect(hasMaterialVariance(variances[1])).toBe(true)
  })

  it('sums a component repeated on several plan lines', () => {
    const [variance] = computeMaterialVariances(
      [
        { variantId: 'screw', plannedQuantity: 8 },
        { variantId: 'screw', plannedQuantity: 4 },
      ],
      [fact('material_consumed', 'screw', 12)],
    )

    expect(variance).toMatchObject({ plannedQuantity: 12, difference: 0 })
  })

  it('ignores output and scrap facts and keeps four-decimal results', () => {
    const [variance] = computeMaterialVariances(
      [{ variantId: 'board', plannedQuantity: 0.3 }],
      [fact('material_consumed', 'board', 0.1), fact('material_consumed', 'board', 0.2), fact('output_received', 'board', 9)],
    )

    expect(variance).toMatchObject({ issuedQuantity: 0.3, difference: 0 })
  })
})

describe('output variance', () => {
  it('compares net good output with the planned quantity and reports scrap separately', () => {
    expect(
      computeOutputVariance(10, [
        fact('output_received', 'table', 6),
        fact('scrap_recorded', 'table', 1),
        fact('output_received', 'table', 6),
        fact('output_reversed', 'table', 6),
        fact('scrap_reversed', 'table', 1),
        fact('scrap_recorded', 'table', 2),
        fact('material_consumed', 'leg', 4),
      ]),
    ).toEqual({ plannedQuantity: 10, goodQuantity: 6, scrapQuantity: 2, difference: -4 })
  })

  it('allows the good output to exceed the plan', () => {
    expect(computeOutputVariance(2, [fact('output_received', 'table', 3)])).toMatchObject({ difference: 1 })
  })
})
