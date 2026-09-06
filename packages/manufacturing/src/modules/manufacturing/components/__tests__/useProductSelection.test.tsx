/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'

const loadProductDefaultUnitCode = jest.fn()

jest.mock('../catalogLookups', () => ({
  loadProductDefaultUnitCode: (...args: unknown[]) => loadProductDefaultUnitCode(...args),
  loadProductOptions: jest.fn(),
  loadVariantOptions: jest.fn(),
  loadProductUnitOptions: jest.fn(),
  resolveProductLabel: jest.fn(),
  resolveVariantLabel: jest.fn(),
}))

import { useProductSelection } from '../BomCatalogPickers'

const FIELDS = { variant: 'variantId', unit: 'unitCode' }

function harness() {
  const setFormValue = jest.fn()
  let api: ReturnType<typeof useProductSelection> | null = null
  function Probe() {
    api = useProductSelection()
    return null
  }
  const view = render(<Probe />)
  return { setFormValue, get: () => api!, view }
}

beforeEach(() => {
  loadProductDefaultUnitCode.mockReset()
})

it('does not clear the variant/unit when the product id is unchanged', () => {
  loadProductDefaultUnitCode.mockResolvedValue('kg')
  const { setFormValue, get } = harness()

  act(() => { get().selectProduct('product-1', 'product-1', setFormValue, FIELDS) })

  expect(setFormValue).not.toHaveBeenCalled()
  expect(loadProductDefaultUnitCode).not.toHaveBeenCalled()
})

it('clears the variant/unit and seeds the base unit when the product changes', async () => {
  loadProductDefaultUnitCode.mockResolvedValue('kg')
  const { setFormValue, get } = harness()

  await act(async () => {
    get().selectProduct('product-2', 'product-1', setFormValue, FIELDS)
  })

  expect(setFormValue).toHaveBeenCalledWith('variantId', null)
  expect(setFormValue).toHaveBeenCalledWith('unitCode', null)
  expect(setFormValue).toHaveBeenCalledWith('unitCode', 'kg')
})

it('ignores a stale default-unit response after a newer selection', async () => {
  let resolveFirst: (code: string) => void = () => {}
  loadProductDefaultUnitCode
    .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce('newer-unit')
  const { setFormValue, get } = harness()

  await act(async () => { get().selectProduct('product-2', 'product-1', setFormValue, FIELDS) })
  await act(async () => { get().selectProduct('product-3', 'product-2', setFormValue, FIELDS) })
  await act(async () => { resolveFirst('stale-unit') })

  expect(setFormValue).not.toHaveBeenCalledWith('unitCode', 'stale-unit')
  expect(setFormValue).toHaveBeenCalledWith('unitCode', 'newer-unit')
})

it('drops the pending default-unit write once the user picks a unit by hand', async () => {
  let resolvePending: (code: string) => void = () => {}
  loadProductDefaultUnitCode.mockImplementationOnce(
    () => new Promise<string>((resolve) => { resolvePending = resolve }),
  )
  const { setFormValue, get } = harness()

  await act(async () => { get().selectProduct('product-2', 'product-1', setFormValue, FIELDS) })
  act(() => { get().cancelDefault() })
  await act(async () => { resolvePending('base-unit') })

  expect(setFormValue).not.toHaveBeenCalledWith('unitCode', 'base-unit')
})
